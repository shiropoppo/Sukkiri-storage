// ハッシュ実装の検証: node tests/hash.test.mjs
// 1) MD5 の既知の値  2) ランダムなファイルで Node の MD5 と一致
// 3) QuickXorHash を Microsoft 公開の C# 実装（tests/hash-check.ps1）と比較
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MD5, QuickXorHash, hashItem, isValidHash, sameHash } from '../app/js/hash.js';

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (label, actual, expected) => {
  if (actual === expected) return;
  failed++;
  console.error(`NG ${label}\n   actual:   ${actual}\n   expected: ${expected}`);
};

const md5Of = (buf, step = buf.length || 1) => {
  const m = new MD5();
  for (let i = 0; i < buf.length; i += step) m.update(buf.subarray(i, i + step));
  return m.digestHex();
};

const vectors = {
  '': 'd41d8cd98f00b204e9800998ecf8427e',
  a: '0cc175b9c0f1b6a831c399e269772661',
  abc: '900150983cd24fb0d6963f7d28e17f72',
  'message digest': 'f96b697d7cb7938d525a2f31aaf161d0',
  'The quick brown fox jumps over the lazy dog': '9e107d9d372bb6826bd81d3542a419d6',
  '12345678901234567890123456789012345678901234567890123456789012345678901234567890': '57edf4a22be3c955ac49da2e2107b67a',
};
for (const [text, hex] of Object.entries(vectors)) check(`md5("${text}")`, md5Of(new TextEncoder().encode(text)), hex);

// 境界（55/56/63/64/65 バイトなど）と、半端な区切りでの投入
const sizes = [1, 55, 56, 57, 63, 64, 65, 127, 128, 129, 159, 160, 161, 319, 320, 1000, 65536, 1_000_003, 9_000_001];
const dir = mkdtempSync(join(tmpdir(), 'hashtest-'));
const files = {};
try {
  for (const n of sizes) {
    const buf = randomBytes(n);
    files[`f${n}.bin`] = buf;
    writeFileSync(join(dir, `f${n}.bin`), buf);
    const ref = createHash('md5').update(buf).digest('hex');
    for (const step of [1, 7, 64, 1000, n]) {
      if (step === 1 && n > 100000) continue;
      check(`md5 random n=${n} step=${step}`, md5Of(buf, step), ref);
    }
  }
  files['empty.bin'] = Buffer.alloc(0);
  writeFileSync(join(dir, 'empty.bin'), Buffer.alloc(0));

  const refJson = execFileSync('pwsh', ['-NoProfile', '-File', join(here, 'hash-check.ps1'), dir], { encoding: 'utf8' });
  const ref = JSON.parse(refJson);
  for (const [name, buf] of Object.entries(files)) {
    for (const step of [1, 13, 160, 4096, buf.length || 1]) {
      if (step === 1 && buf.length > 100000) continue;
      const q = new QuickXorHash();
      for (let i = 0; i < buf.length; i += step) q.update(buf.subarray(i, i + step));
      check(`qxh ${name} step=${step}`, q.digestBase64(), ref[name].qxh);
    }
    check(`md5 vs Get-FileHash ${name}`, md5Of(buf), ref[name].md5);
  }

  // hashItem（実際のツールと同じ読み込み経路）
  const big = files['f9000001.bin'];
  const src = { read: async (_item, s, e) => new Uint8Array(big.subarray(s, e)) };
  const both = await hashItem(src, { size: big.length }, ['md5', 'qxh']);
  check('hashItem md5', both.md5, ref['f9000001.bin'].md5);
  check('hashItem qxh', both.qxh, ref['f9000001.bin'].qxh);

  // 途中までしか読めない場合はエラーになること
  const shortSrc = { read: async (_item, s, e) => new Uint8Array(big.subarray(s, Math.max(s, e - 1))) };
  let threw = false;
  try { await hashItem(shortSrc, { size: big.length }, ['md5']); } catch { threw = true; }
  check('hashItem short read throws', threw, true);

  // 形式チェック
  check('valid md5', isValidHash('md5', ref['f1.bin'].md5), true);
  check('valid qxh', isValidHash('qxh', ref['f1.bin'].qxh), true);
  check('empty never matches', sameHash('md5', '', ''), false);
  check('undefined never matches', sameHash('qxh', undefined, undefined), false);
  check('uppercase md5 rejected', isValidHash('md5', 'D41D8CD98F00B204E9800998ECF8427E'), false);

  // 速度の目安
  const perf = randomBytes(64 * 1024 * 1024);
  let t = performance.now();
  new MD5().update(perf);
  const md5Speed = 64 / ((performance.now() - t) / 1000);
  t = performance.now();
  new QuickXorHash().update(perf);
  const qxhSpeed = 64 / ((performance.now() - t) / 1000);
  console.log(`speed: md5 ${md5Speed.toFixed(0)} MB/s, qxh ${qxhSpeed.toFixed(0)} MB/s`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? `${failed} 件の不一致があります` : 'すべて一致しました');
process.exit(failed ? 1 : 0);
