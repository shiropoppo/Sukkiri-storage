// 一度しらべたファイルの「中身の指紋」を覚えておく（ブラウザの中にだけ保存）。
// 途中で止まっても、次にしらべるときは覚えている分を飛ばせるので早く終わる。
// 「場所・大きさ・更新日時」が同じときだけ使う。削除の直前は必ず計算し直すので、
// ここで覚えた値だけを根拠に消すことはない。

const DB_NAME = 'sukkiri-hash-cache';
const STORE = 'hashes';

export class HashCache {
  static async open() {
    try {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return new HashCache(db);
    } catch {
      return null; // 保存できない環境では覚えずに進める
    }
  }

  constructor(db) {
    this.db = db;
  }

  static key(mode, item) {
    return [mode, item.rootPath || '', item.rel || item.name, item.size, item.mtime].join('|');
  }

  get(key) {
    return new Promise((resolve) => {
      try {
        const req = this.db.transaction(STORE).objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  put(key, hashes) {
    try {
      this.db.transaction(STORE, 'readwrite').objectStore(STORE).put({ ...hashes, t: Date.now() }, key);
    } catch { /* 覚えられなくても作業は続ける */ }
  }
}
