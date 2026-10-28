// ローカルサーバーの動作確認: サーバー起動後に
//   node tests/server-api.test.mjs <テスト用フォルダ>
// テスト用フォルダの中に作ったファイルだけを使う（ゴミ箱へ移動するのも、ここで作ったコピーだけ）。
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, utimesSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { hashItem } from '../app/js/hash.js';

const BASE = 'http://localhost:8765';
const dir = process.argv[2];
if (!dir) throw new Error('テスト用フォルダを指定してください');

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'OK ' : 'NG '} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};

const html = await (await fetch(`${BASE}/`)).text();
const token = html.match(/name="local-token" content="([0-9a-f]+)"/)?.[1];
check('画面に合言葉が埋め込まれている', token?.length === 64);

const call = async (path, body) => {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Token': token, Origin: BASE },
    body: JSON.stringify(body || {}),
  });
  return r.json();
};
const source = {
  read: async (item, s, e) => {
    const r = await fetch(`${BASE}/api/file?id=${item.id}`, { headers: { 'X-Token': token, Range: `bytes=${s}-${e - 1}` } });
    if (r.status !== 206) throw new Error(`status ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  },
};

// 1) 一覧と、読み出した中身のハッシュが実ファイルと一致するか
let scan = await call('/api/scan', { path: dir });
check('スキャンできる', Array.isArray(scan.items), `${scan.items?.length} 件`);
check('写真・動画以外（.txt）は入らない', !scan.items.some((i) => i.name.endsWith('.txt')));
check('サブフォルダ（日本語名）も入る', scan.items.some((i) => i.rel.includes('2024年 旅行\\')));
for (const it of scan.items) {
  // rel の先頭は「場所の名前」なので外して実際の場所を組み立てる
  const real = createHash('md5').update(readFileSync(join(dir, ...it.rel.split('\\').slice(1)))).digest('hex');
  const got = await hashItem(source, it, ['md5']);
  check(`MD5 一致 ${it.rel}`, got.md5 === real);
}

// 2) 範囲外や不正な ID
const r416 = await fetch(`${BASE}/api/file?id=0`, { headers: { 'X-Token': token, Range: 'bytes=999999999-' } });
check('範囲外の読み出しは 416', r416.status === 416);
const rBad = await fetch(`${BASE}/api/file?id=abc`, { headers: { 'X-Token': token } });
check('不正な ID は 404', rBad.status === 404);
const rNoTok = await fetch(`${BASE}/api/file?id=0`);
check('合言葉なしの読み出しは 403', rNoTok.status === 403);

// 2b) 複数の場所をまとめてしらべる
const nested = await call('/api/scan', { paths: [dir, join(dir, '2024年 旅行')] });
check('入れ子の場所は重ねてしらべない', nested.items?.length === scan.items.length && nested.roots?.length === 1, `${nested.items?.length} 件`);
check('場所の名前が先頭に付く', nested.items?.every((i) => i.rel.split('\\')[0] === dir.split('\\').pop()));
if (process.env.OneDrive) {
  const mixed = await call('/api/scan', { paths: [dir, join(process.env.OneDrive, '画像')] });
  check('同期フォルダは外し、残りはしらべる', mixed.items?.length === scan.items.length && mixed.blocked?.length === 1 && mixed.blocked[0].reason === 'synced');
}
const awake = await call('/api/keepawake', { on: true });
const sleepOk = await call('/api/keepawake', { on: false });
check('スリープ防止の切りかえ', awake.ok === true && sleepOk.ok === true);

// 3) 同期フォルダは扱わない
const od = process.env.OneDrive;
if (od) {
  const blocked = await call('/api/scan', { path: join(od, '画像') });
  check('OneDrive 内はスキャンを断る', blocked.folder?.blocked === true && blocked.folder?.reason === 'synced', blocked.folder?.service);
}
for (const name of ['Dropbox', 'マイドライブ']) {
  const p = join(dir, name);
  if (!existsSync(p)) mkdirSync(p);
  writeFileSync(join(p, 'IMG_9999.jpg'), 'x'.repeat(100));
  const b = await call('/api/scan', { path: p });
  check(`「${name}」という名前のフォルダは断る`, b.folder?.blocked === true);
}
scan = await call('/api/scan', { path: dir });
check('同期フォルダ名のサブフォルダは飛ばす', !scan.items.some((i) => i.name === 'IMG_9999.jpg'), `skippedSynced=${scan.skippedSynced}`);

// 4) ゴミ箱へ移動（テスト用のコピーで）
const victimDir = join(dir, 'ゴミ箱テスト');
if (!existsSync(victimDir)) mkdirSync(victimDir);
writeFileSync(join(victimDir, 'del_ok.jpg'), Buffer.from('delete me ' + Date.now()));
writeFileSync(join(victimDir, 'del_changed.jpg'), Buffer.from('changed ' + Date.now()));
scan = await call('/api/scan', { path: victimDir });
const ok = scan.items.find((i) => i.name === 'del_ok.jpg');
const changed = scan.items.find((i) => i.name === 'del_changed.jpg');

const st = await call('/api/stat', { id: ok.id });
check('stat が一覧と同じ', st.size === ok.size && st.mtime === ok.mtime);

const wrong = await call('/api/recycle', { id: ok.id, size: ok.size + 1, mtime: ok.mtime, log: {} });
check('大きさが違えば消さない', wrong.ok === false && wrong.reason === 'changed' && existsSync(join(victimDir, 'del_ok.jpg')));

utimesSync(join(victimDir, 'del_changed.jpg'), new Date(), new Date(Date.now() + 5000));
const ch = await call('/api/recycle', { id: changed.id, size: changed.size, mtime: changed.mtime, log: {} });
check('更新日時が変わっていれば消さない', ch.ok === false && ch.reason === 'changed' && existsSync(join(victimDir, 'del_changed.jpg')));

const rec = await call('/api/recycle', { id: ok.id, size: ok.size, mtime: ok.mtime, log: { cloud: 'テスト', cloudPath: '/テスト/del_ok.jpg', check: 'テスト' } });
check('条件がそろえばゴミ箱へ移動', rec.ok === true && !existsSync(join(victimDir, 'del_ok.jpg')));

const logDir = join(process.cwd(), '記録');
const logs = existsSync(logDir) ? readdirSync(logDir).filter((f) => f.startsWith('削除記録_')) : [];
check('削除記録の CSV ができる', logs.length > 0, logs.join(','));
if (logs.length) {
  const csv = readFileSync(join(logDir, logs[0]));
  check('CSV は BOM 付き UTF-8', csv[0] === 0xef && csv[1] === 0xbb && csv[2] === 0xbf);
  check('CSV に記録がある', csv.toString('utf8').includes('del_ok.jpg'));
}

console.log(failed ? `${failed} 件の問題があります` : 'すべて問題ありません');
process.exit(failed ? 1 : 0);
