// 中身が「完全に同じ」かを確かめるためのハッシュ計算。
// Google ドライブは MD5、OneDrive は QuickXorHash をファイルごとに持っているので、
// 手元のファイルから同じ値を計算して突き合わせる。
// どちらも少しずつ読み込みながら計算できるので、大きな動画でもメモリを使いすぎない。

export const HASH_CHUNK = 8 * 1024 * 1024;

// ---------- MD5 ----------
const K = new Int32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
const S = new Uint8Array([7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]);

export class MD5 {
  constructor() {
    this.h = new Int32Array([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476]);
    this.x = new Int32Array(16);
    this.buf = new Uint8Array(64);
    this.bufLen = 0;
    this.total = 0;
  }

  update(data) {
    const n = data.length;
    let i = 0;
    this.total += n;
    if (this.bufLen > 0) {
      const need = 64 - this.bufLen;
      if (n < need) {
        this.buf.set(data, this.bufLen);
        this.bufLen += n;
        return;
      }
      this.buf.set(data.subarray(0, need), this.bufLen);
      this.block(this.buf, 0);
      this.bufLen = 0;
      i = need;
    }
    for (; i + 64 <= n; i += 64) this.block(data, i);
    if (i < n) {
      this.buf.set(data.subarray(i), 0);
      this.bufLen = n - i;
    }
  }

  block(d, o) {
    const x = this.x, h = this.h;
    for (let j = 0; j < 16; j++, o += 4) {
      x[j] = d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24);
    }
    let a = h[0], b = h[1], c = h[2], d0 = h[3], f, t, s;
    for (let i = 0; i < 16; i++) {
      f = (a + ((b & c) | (~b & d0)) + K[i] + x[i]) | 0;
      s = S[i & 3];
      t = d0; d0 = c; c = b;
      b = (b + ((f << s) | (f >>> (32 - s)))) | 0;
      a = t;
    }
    for (let i = 16; i < 32; i++) {
      f = (a + ((d0 & b) | (~d0 & c)) + K[i] + x[(5 * i + 1) & 15]) | 0;
      s = S[4 + (i & 3)];
      t = d0; d0 = c; c = b;
      b = (b + ((f << s) | (f >>> (32 - s)))) | 0;
      a = t;
    }
    for (let i = 32; i < 48; i++) {
      f = (a + (b ^ c ^ d0) + K[i] + x[(3 * i + 5) & 15]) | 0;
      s = S[8 + (i & 3)];
      t = d0; d0 = c; c = b;
      b = (b + ((f << s) | (f >>> (32 - s)))) | 0;
      a = t;
    }
    for (let i = 48; i < 64; i++) {
      f = (a + (c ^ (b | ~d0)) + K[i] + x[(7 * i) & 15]) | 0;
      s = S[12 + (i & 3)];
      t = d0; d0 = c; c = b;
      b = (b + ((f << s) | (f >>> (32 - s)))) | 0;
      a = t;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d0) | 0;
  }

  digestHex() {
    const bits = this.total * 8;
    const tail = new Uint8Array(this.bufLen < 56 ? 64 - this.bufLen : 128 - this.bufLen);
    tail[0] = 0x80;
    const lo = bits >>> 0;
    const hi = Math.floor(bits / 4294967296) >>> 0;
    const p = tail.length - 8;
    for (let i = 0; i < 4; i++) {
      tail[p + i] = (lo >>> (8 * i)) & 255;
      tail[p + 4 + i] = (hi >>> (8 * i)) & 255;
    }
    const total = this.total;
    this.update(tail);
    this.total = total;
    let hex = '';
    for (let i = 0; i < 4; i++) {
      const v = this.h[i];
      for (let j = 0; j < 4; j++) hex += ((v >>> (8 * j)) & 255).toString(16).padStart(2, '0');
    }
    return hex;
  }
}

// ---------- QuickXorHash (OneDrive) ----------
// 各バイトを 160 ビットの円環上の (位置 × 11) ビット目に XOR していく方式。
// 位置が 160 バイトずれると同じビット位置に戻るので、先に 160 バイトの箱へ
// XOR で畳み込んでおき、最後に 1 回だけ配置する（Microsoft 公開の実装と同じ結果になる）。
export class QuickXorHash {
  constructor() {
    this.acc = new Uint8Array(160);
    this.pos = 0;
    this.total = 0;
  }

  update(data) {
    const acc = this.acc;
    const n = data.length;
    let p = this.pos;
    for (let i = 0; i < n; i++) {
      acc[p] ^= data[i];
      if (++p === 160) p = 0;
    }
    this.pos = p;
    this.total += n;
  }

  digestBase64() {
    const st = new Uint32Array(5);
    for (let r = 0; r < 160; r++) {
      const b = this.acc[r];
      if (!b) continue;
      const bit = (r * 11) % 160;
      const w = bit >>> 5, o = bit & 31;
      st[w] ^= b << o;
      if (o > 24) st[(w + 1) % 5] ^= b >>> (32 - o);
    }
    const out = new Uint8Array(20);
    for (let w = 0; w < 5; w++) {
      for (let j = 0; j < 4; j++) out[w * 4 + j] = (st[w] >>> (8 * j)) & 255;
    }
    let len = this.total;
    for (let i = 0; i < 8; i++) {
      out[12 + i] ^= len % 256;
      len = Math.floor(len / 256);
    }
    let bin = '';
    for (const b of out) bin += String.fromCharCode(b);
    return btoa(bin);
  }
}

// ---------- 形式チェック ----------
// 計算に失敗して空文字などになったものを「一致」と誤判定しないよう、必ず形式を確かめる。
const FORMATS = {
  md5: /^[0-9a-f]{32}$/,
  qxh: /^[A-Za-z0-9+/]{27}=$/,
};

export function isValidHash(algo, value) {
  return typeof value === 'string' && !!FORMATS[algo] && FORMATS[algo].test(value);
}

export function sameHash(algo, a, b) {
  return isValidHash(algo, a) && isValidHash(algo, b) && a === b;
}

// ファイル全体を読み、指定されたアルゴリズムのハッシュをまとめて計算する。
// 読めたバイト数がファイルサイズと一致しない場合はエラーにする（途中までの値で判定しない）。
// 次の区切りの読み込みを先に始めておき、計算している間に読み込みも進める（大きな動画で効く）。
export async function hashItem(source, item, algos, { onBytes, signal } = {}) {
  const md5 = algos.includes('md5') ? new MD5() : null;
  const qxh = algos.includes('qxh') ? new QuickXorHash() : null;
  const readAt = (start) => {
    const p = source.read(item, start, Math.min(item.size, start + HASH_CHUNK));
    p.catch(() => {}); // 途中で止めたときに、使わなかった読み込みのエラーを出さない
    return p;
  };
  let off = 0;
  let next = item.size > 0 ? readAt(0) : null;
  while (off < item.size) {
    if (signal?.aborted) throw new DOMException('中止しました', 'AbortError');
    const end = Math.min(item.size, off + HASH_CHUNK);
    const chunk = await next;
    next = end < item.size ? readAt(end) : null;
    if (chunk.length !== end - off) throw new Error('ファイルを最後まで読めませんでした');
    md5?.update(chunk);
    qxh?.update(chunk);
    off = end;
    onBytes?.(chunk.length);
  }
  const out = {};
  if (md5) out.md5 = md5.digestHex();
  if (qxh) out.qxh = qxh.digestBase64();
  return out;
}
