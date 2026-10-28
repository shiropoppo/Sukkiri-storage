// 手元（パソコン・スマホ）の写真や動画の読み方。端末によってできることが違う:
//   ServerSource  Windows（「はじめる」から起動）  … 調べる・保存・ゴミ箱へ移動 まで全部できる
//   DirSource     Android の Chrome               … フォルダを選んで、調べる・保存・削除ができる
//   PickSource    iPhone やその他のブラウザ        … 選んだ写真を調べる・保存できる（削除は「写真」アプリで）
//   DemoSource    デモ（?demo=1）                  … 本物のファイルには一切さわらない

import { HttpError, sleep } from './util.js';

const IMAGE_EXT = /\.(jpe?g|jpe|png|gif|heic|heif|webp|bmp|tiff?|dng|raw|cr2|cr3|nef|arw|orf|rw2|raf|srw|pef|avif|jxl)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|avi|wmv|mkv|3gp|3g2|mts|m2ts|mpe?g|webm|hevc|vob|flv)$/i;
const PREVIEW_EXT = /\.(jpe?g|jpe|png|gif|webp|bmp|avif)$/i;

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', png: 'image/png', gif: 'image/gif', heic: 'image/heic',
  heif: 'image/heif', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', avif: 'image/avif',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv',
  mkv: 'video/x-matroska', '3gp': 'video/3gpp', webm: 'video/webm', mpg: 'video/mpeg', mpeg: 'video/mpeg',
};

function describe(name, extra) {
  const ext = (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
  return {
    ...extra,
    name,
    kind: VIDEO_EXT.test(name) ? 'video' : 'image',
    mime: MIME[ext] || 'application/octet-stream',
    previewable: PREVIEW_EXT.test(name),
    status: 'pending',
    keep: false,
  };
}

export const isMedia = (name, type = '') => IMAGE_EXT.test(name) || VIDEO_EXT.test(name) || /^(image|video)\//.test(type);

// ---------------- Windows: ローカルサーバー経由 ----------------
export class ServerSource {
  constructor(token) {
    this.kind = 'server';
    this.token = token;
    this.canDelete = true;
    this.recycle = true;
  }

  static async detect(token) {
    if (!token) return false;
    try {
      const r = await fetch('/api/hello', { cache: 'no-store' });
      return r.ok && (await r.json()).app === 'sukkiri';
    } catch {
      return false;
    }
  }

  async call(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': this.token },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) throw new HttpError(res.status, await res.text());
    return res.json();
  }

  info() { return this.call('/api/info'); }
  heartbeat() { return this.call('/api/heartbeat'); }
  keepAwake(on) { return this.call('/api/keepawake', { on }); }
  open(what) { return this.call('/api/open', { what }); }
  async folders() { return (await this.call('/api/folders')).folders || []; }

  async pickFolder(title) {
    const r = await this.call('/api/folder/pick', { title });
    return r.cancelled ? null : r.folder;
  }

  // 選んだ場所をまとめてしらべる（同期フォルダなどは裏方が外し、blocked で知らせる）
  async scan(folders) {
    const r = await this.call('/api/scan', { paths: folders.map((f) => f.path) });
    const blocked = r.blocked || (r.folder ? [r.folder] : []);
    if (!r.items) return { items: [], blocked, skippedSynced: 0, skippedErrors: 0 };
    this.recycle = folders.every((f) => f.recycle !== false);
    const roots = r.roots || [];
    const items = r.items.map((x) => describe(x.name, {
      id: `s${x.id}`, sid: x.id, rel: x.rel, rootPath: roots[x.root] || '', size: x.size, mtime: x.mtime,
    }));
    return { items, blocked, skippedSynced: r.skippedSynced, skippedErrors: r.skippedErrors };
  }

  async read(item, start, end) {
    const res = await fetch(`/api/file?id=${item.sid}`, {
      headers: { 'X-Token': this.token, Range: `bytes=${start}-${end - 1}` },
      cache: 'no-store',
    });
    if (res.status !== 206) throw new HttpError(res.status, 'read');
    return new Uint8Array(await res.arrayBuffer());
  }

  thumbUrl(item) {
    return item.previewable ? `/api/file?id=${item.sid}&t=${this.token}` : null;
  }

  async stat(item) {
    const r = await this.call('/api/stat', { id: item.sid });
    return r.exists ? { size: r.size, mtime: r.mtime } : null;
  }

  remove(item, log) {
    return this.call('/api/recycle', { id: item.sid, size: item.size, mtime: item.mtime, log });
  }

  logUpload(item, cloud, cloudPath) {
    return this.call('/api/log-upload', { id: item.sid, size: item.size, cloud, cloudPath }).catch(() => {});
  }
}

// ---------------- Android: フォルダを選んで直接扱う ----------------
export class DirSource {
  constructor() {
    this.kind = 'dir';
    this.canDelete = true;
    this.recycle = false;
    this.urls = new Map();
    this.roots = [];
  }

  static supported() {
    return typeof window.showDirectoryPicker === 'function';
  }

  get folders() {
    return this.roots.map((r) => ({ key: 'picked', name: r.name, path: r.name }));
  }

  // フォルダを1つ追加する。すでに選んだフォルダの中なら追加しない。
  // 逆に、すでに選んだフォルダを含む大きなフォルダなら、そちらに置きかえる。
  async addFolder() {
    let handle;
    try {
      handle = await window.showDirectoryPicker({ id: 'sukkiri-photos', mode: 'readwrite', startIn: 'pictures' });
    } catch (e) {
      if (e?.name === 'AbortError') return null;
      throw e;
    }
    for (const r of this.roots) {
      if ((await r.handle.isSameEntry(handle)) || (await r.handle.resolve(handle))) return { duplicate: true, name: handle.name };
    }
    const kept = [];
    for (const r of this.roots) if (!(await handle.resolve(r.handle))) kept.push(r);
    this.roots = [...kept, { handle, name: handle.name }];
    return { name: handle.name };
  }

  removeFolder(i) {
    this.roots.splice(i, 1);
  }

  async scan(_folders, { onCount, signal } = {}) {
    const items = [];
    const walk = async (dir, prefix, rootPath) => {
      for await (const [name, handle] of dir.entries()) {
        if (signal?.aborted) throw new DOMException('中止しました', 'AbortError');
        // 「.」で始まるもの（Android のゴミ箱 .trashed-… やサムネイル）は扱わない
        if (name.startsWith('.')) continue;
        if (handle.kind === 'directory') {
          await walk(handle, `${prefix}${name}/`, rootPath);
        } else if (isMedia(name)) {
          const f = await handle.getFile();
          items.push(describe(name, { id: `d${items.length}`, rel: prefix + name, rootPath, size: f.size, mtime: f.lastModified, handle, parent: dir }));
          if (items.length % 50 === 0) onCount?.(items.length);
        }
      }
    };
    for (const r of this.roots) await walk(r.handle, `${r.name}/`, r.name);
    return { items, skippedSynced: 0, skippedErrors: 0 };
  }

  async file(item, fresh = false) {
    if (fresh || !item.file) item.file = await item.handle.getFile();
    return item.file;
  }

  async read(item, start, end) {
    const f = await this.file(item);
    return new Uint8Array(await f.slice(start, end).arrayBuffer());
  }

  async thumbUrl(item) {
    if (!item.previewable) return null;
    if (!this.urls.has(item.id)) this.urls.set(item.id, URL.createObjectURL(await this.file(item)));
    return this.urls.get(item.id);
  }

  async stat(item) {
    try {
      const f = await this.file(item, true);
      return { size: f.size, mtime: f.lastModified };
    } catch {
      return null;
    }
  }

  async remove(item) {
    try {
      await item.parent.removeEntry(item.name);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e?.name === 'NotFoundError' ? 'missing' : 'error' };
    }
  }
}

// ---------------- iPhone など: 写真を選んでもらう ----------------
export class PickSource {
  constructor() {
    this.kind = 'pick';
    this.canDelete = false;
    this.recycle = false;
    this.urls = new Map();
  }

  // <input type="file"> の選択結果から一覧を作る
  setFiles(fileList) {
    this.items = Array.from(fileList)
      .filter((f) => isMedia(f.name, f.type) && f.size > 0)
      .map((f, i) => describe(f.name, { id: `p${i}`, rel: f.name, size: f.size, mtime: f.lastModified, file: f }));
  }

  async scan() {
    return { items: this.items || [], skippedSynced: 0, skippedErrors: 0 };
  }

  async read(item, start, end) {
    return new Uint8Array(await item.file.slice(start, end).arrayBuffer());
  }

  thumbUrl(item) {
    if (!item.previewable && !/^image\/(jpeg|png|gif|webp)/.test(item.file.type)) return null;
    if (!this.urls.has(item.id)) this.urls.set(item.id, URL.createObjectURL(item.file));
    return this.urls.get(item.id);
  }

  async stat(item) {
    return { size: item.file.size, mtime: item.file.lastModified };
  }
}

// ---------------- デモ ----------------
// それらしい名前の小さなファイルを作り、その一部を「クラウドにある」ことにする。
// 中身のバイト列は毎回同じものを作るので、本物と同じ手順でハッシュを計算して照合できる。
export class DemoSource {
  constructor() {
    this.kind = 'demo';
    this.canDelete = true;
    this.recycle = true;
    this.cache = new Map();
    this.deleted = new Set();
    const colors = ['#F8C8A8', '#BFE3D0', '#C9DDF2', '#F5E1A4', '#E7C9E9', '#F6B9B0', '#CDE7B0', '#B8D8E8'];
    this.items = [];
    const now = Date.now();
    for (let i = 0; i < 64; i++) {
      const video = i % 9 === 4;
      const mtime = now - i * 6.3 * 86400000;
      const d = new Date(mtime);
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(100000 + i * 731).slice(-6)}`;
      const name = video ? `VID_${stamp}.mp4` : `IMG_${stamp}.jpg`;
      const size = video ? 900_000 + ((i * 7919) % 1_400_000) : 60_000 + ((i * 104729) % 520_000);
      // 7 割ほどはクラウドに保存ずみ、一部は「同期アプリの場所」にあるので削除しない、という設定
      const r = (i * 37) % 10;
      const demoCloud = r < 5 ? 'google' : r < 7 ? 'onedrive' : null;
      this.items.push(describe(name, {
        id: `demo${i}`, rel: `カメラ/${name}`, size, mtime, seed: i + 1, color: colors[i % colors.length],
        demoCloud, demoSynced: i === 3 || i === 23,
      }));
    }
    // 名前はちがうが中身が同じファイル（コピーや、LINE などで保存しなおしたもの）
    const copies = [
      [1, (n) => n.replace('.jpg', ' (1).jpg'), 'カメラ/'],
      [1, (n) => `LINE_ALBUM_${n.slice(4)}`, 'LINE/'],
      [7, (n) => `${n.replace('.jpg', '')} - コピー.jpg`, 'カメラ/'],
      [0, (n) => `写真 ${n.slice(4, 12)}.jpg`, 'デスクトップから移動/'],
    ];
    copies.forEach(([src, rename, folder], k) => {
      const o = this.items[src];
      const name = rename(o.name);
      this.items.push(describe(name, {
        id: `demo-copy${k}`, rel: folder + name, size: o.size, mtime: o.mtime + 3600000 * (k + 1), seed: o.seed,
        color: o.color, demoCloud: null, demoSynced: false,
      }));
    });
  }

  allItems() {
    return this.items;
  }

  bytes(item) {
    if (!this.cache.has(item.id)) {
      const out = new Uint8Array(item.size);
      let x = item.seed * 2654435761 >>> 0 || 1;
      for (let i = 0; i < out.length; i++) {
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        out[i] = x & 255;
      }
      this.cache.set(item.id, out);
    }
    return this.cache.get(item.id);
  }

  async folders() {
    await sleep(300);
    return [
      { key: 'pictures', name: 'ピクチャ', path: 'C:\\Users\\demo\\Pictures', exists: true, blocked: false, recycle: true },
      { key: 'videos', name: 'ビデオ', path: 'C:\\Users\\demo\\OneDrive\\ビデオ', exists: true, blocked: true, reason: 'synced', service: 'OneDrive' },
      { key: 'downloads', name: 'ダウンロード', path: 'C:\\Users\\demo\\Downloads', exists: true, blocked: false, recycle: true },
    ];
  }

  async pickFolder() {
    await sleep(400);
    return { key: 'picked', name: 'カメラ', path: 'C:\\Users\\demo\\Pictures\\カメラ', exists: true, blocked: false, recycle: true };
  }

  async scan(folders) {
    await sleep(500);
    const items = this.items.filter((i) => !this.deleted.has(i.id)).map((i) => ({ ...i, status: 'pending', keep: false, match: null, hashes: null }));
    return { items, skippedSynced: folders.some((f) => f.key === 'pictures') ? 3 : 0, skippedErrors: 0 };
  }

  async read(item, start, end) {
    await sleep(2);
    return this.bytes(item).subarray(start, end);
  }

  thumbUrl(item) {
    if (item.kind === 'video') return null;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="${item.color}"/>`
      + `<circle cx="${30 + (item.seed * 13) % 60}" cy="34" r="13" fill="#fff" opacity=".85"/>`
      + `<path d="M0 120 L${20 + (item.seed * 7) % 30} 70 L60 100 L${80 + (item.seed * 5) % 20} 60 L120 110 V120Z" fill="#fff" opacity=".55"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  async stat(item) {
    return this.deleted.has(item.id) ? null : { size: item.size, mtime: item.mtime };
  }

  async remove(item) {
    await sleep(80);
    this.deleted.add(item.id);
    return { ok: true };
  }

  open() {}
  logUpload() {}
}
