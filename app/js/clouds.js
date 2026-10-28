// クラウド（Google ドライブ / OneDrive）とのやりとり
// どのクラウドも同じ形で使えるようにしている:
//   connect()            ログイン（公式のログイン画面を表示）
//   account()            アカウント名と空き容量
//   listAll()            クラウド上の全ファイルの「大きさ・ハッシュ・場所」の一覧
//   ensureFolder()       保存（アップロード）先フォルダの用意
//   upload()             1 ファイルを保存し、クラウド側の値と一致するか確かめる

import { MD5, QuickXorHash, hashItem, sameHash } from './hash.js';
import { AuthError, HttpError, fetchRetry, loadScript, randomString, sha256base64url, sleep } from './util.js';

export const BACKUP_FOLDER = '容量すっきり_バックアップ';
const UPLOAD_CHUNK = 10 * 1024 * 1024; // Google(256KiB) と OneDrive(320KiB) の両方の倍数

export function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

// クラウドの一覧を「大きさ → 候補」「ID → 項目」の 2 通りで引けるようにする
function buildIndex(entries) {
  const bySize = new Map();
  const byId = new Map();
  for (const e of entries) {
    byId.set(e.id, e);
    const list = bySize.get(e.size);
    if (list) list.push(e); else bySize.set(e.size, [e]);
  }
  return { bySize, byId, count: entries.length };
}

// 親フォルダをたどって「/フォルダ/ファイル名」を作る。
// たどった先がそのアカウントのドライブの一番上に着かないもの（パソコン同期の領域など）は underRoot=false
function makeResolver(rootId, folders) {
  const memo = new Map();
  const resolve = (id, depth = 0) => {
    if (!id) return { path: '', underRoot: false };
    if (id === rootId) return { path: '', underRoot: true };
    if (memo.has(id)) return memo.get(id);
    const f = folders.get(id);
    let out;
    if (!f || depth > 200) out = { path: '', underRoot: false };
    else {
      const up = resolve(f.parent, depth + 1);
      out = { path: `${up.path}/${f.name}`, underRoot: up.underRoot };
    }
    memo.set(id, out);
    return out;
  };
  return resolve;
}

function excludedReason(path, patterns) {
  for (const p of patterns || []) if (p.test(path)) return 'sync-app';
  return null;
}

// ======================= Google ドライブ =======================
const G_FOLDER = 'application/vnd.google-apps.folder';
const G_SCOPE_READ = 'https://www.googleapis.com/auth/drive.metadata.readonly';
const G_SCOPE_FILE = 'https://www.googleapis.com/auth/drive.file';
const G_API = 'https://www.googleapis.com/drive/v3';

export class GoogleDrive {
  constructor(clientId) {
    this.id = 'google';
    this.label = 'Google ドライブ';
    this.algo = 'md5';
    this.clientId = clientId;
    this.tokenClient = null;
    this.pending = null;
    const saved = JSON.parse(sessionStorage.getItem('g_token') || 'null');
    this.token = saved?.token || null;
    this.exp = saved?.exp || 0;
    this.canUpload = saved?.canUpload ?? false;
  }

  get connected() {
    return !!this.token && Date.now() < this.exp - 60_000;
  }

  // ログインボタンを押した瞬間にポップアップを開けるよう、部品を先に読み込んでおく
  async prepare() {
    if (this.tokenClient) return;
    await loadScript('https://accounts.google.com/gsi/client');
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: `${G_SCOPE_READ} ${G_SCOPE_FILE}`,
      callback: (resp) => this.onToken(resp),
      error_callback: (err) => this.finish(null, err?.type === 'popup_closed' ? 'cancelled' : (err?.type || 'error')),
    });
  }

  get ready() {
    return !!this.tokenClient;
  }

  // ボタンのクリック処理の中から「同期的に」呼ぶこと（ポップアップがブロックされないように）
  connect({ switchAccount = false } = {}) {
    if (!this.tokenClient) return Promise.reject(new Error('Google のログイン部品を読み込み中です。少し待ってからもう一度押してください。'));
    const p = new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
    this.tokenClient.requestAccessToken({ prompt: switchAccount ? 'select_account' : '' });
    return p;
  }

  onToken(resp) {
    if (resp.error) return this.finish(null, resp.error === 'access_denied' ? 'cancelled' : resp.error);
    if (!google.accounts.oauth2.hasGrantedAllScopes(resp, G_SCOPE_READ)) return this.finish(null, 'scope');
    this.token = resp.access_token;
    this.exp = Date.now() + Number(resp.expires_in || 3600) * 1000;
    this.canUpload = google.accounts.oauth2.hasGrantedAllScopes(resp, G_SCOPE_FILE);
    sessionStorage.setItem('g_token', JSON.stringify({ token: this.token, exp: this.exp, canUpload: this.canUpload }));
    this.finish(true);
  }

  finish(ok, reason) {
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    if (ok) p.resolve(); else p.reject(Object.assign(new Error(reason), { code: reason }));
  }

  disconnect() {
    if (this.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(this.token, () => {});
    this.token = null;
    this.exp = 0;
    sessionStorage.removeItem('g_token');
  }

  async api(url, opts = {}) {
    if (!this.connected) throw new AuthError(this.id);
    const res = await fetchRetry(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${this.token}` } });
    if (res.status === 401) {
      this.token = null;
      sessionStorage.removeItem('g_token');
      throw new AuthError(this.id);
    }
    if (!res.ok) throw new HttpError(res.status, await res.text());
    return res;
  }

  json(url, opts) {
    return this.api(url, opts).then((r) => r.json());
  }

  async account() {
    const r = await this.json(`${G_API}/about?fields=user(emailAddress,displayName),storageQuota`);
    const q = r.storageQuota || {};
    const total = q.limit ? Number(q.limit) : Infinity;
    const used = Number(q.usage || 0);
    this.email = r.user?.emailAddress || r.user?.displayName || '';
    this.quota = { total, used, free: Math.max(0, total - used) };
    return { email: this.email, quota: this.quota };
  }

  async listAll({ onProgress, signal, exclude } = {}) {
    const root = await this.json(`${G_API}/files/root?fields=id`);
    const folders = new Map();
    const files = [];
    let pageToken = '';
    do {
      if (signal?.aborted) throw new DOMException('中止しました', 'AbortError');
      const p = new URLSearchParams({
        q: "trashed = false and 'me' in owners",
        fields: 'nextPageToken,files(id,name,mimeType,size,md5Checksum,parents)',
        pageSize: '1000',
        spaces: 'drive',
        corpora: 'user',
      });
      if (pageToken) p.set('pageToken', pageToken);
      const r = await this.json(`${G_API}/files?${p}`);
      for (const f of r.files || []) {
        if (f.mimeType === G_FOLDER) folders.set(f.id, { name: f.name, parent: f.parents?.[0] });
        else if (f.md5Checksum && Number(f.size) > 0) files.push(f);
      }
      onProgress?.(files.length);
      pageToken = r.nextPageToken;
    } while (pageToken);

    const resolve = makeResolver(root.id, folders);
    const entries = files.map((f) => {
      const loc = resolve(f.parents?.[0]);
      const path = `${loc.path}/${f.name}`;
      const reason = loc.underRoot ? excludedReason(path, exclude) : 'outside';
      return {
        service: this.id, algo: this.algo, id: f.id, name: f.name, size: Number(f.size),
        hash: f.md5Checksum, path, eligible: !reason, reason,
      };
    });
    return buildIndex(entries);
  }

  async findFolder(q) {
    const p = new URLSearchParams({ q, fields: 'files(id,name)', spaces: 'drive', pageSize: '10' });
    const r = await this.json(`${G_API}/files?${p}`);
    return r.files?.[0]?.id || null;
  }

  async createFolder(name, parent, marker) {
    const r = await this.json(`${G_API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, mimeType: G_FOLDER, parents: [parent], appProperties: { sukkiriTool: marker } }),
    });
    return r.id;
  }

  async ensureFolder(dayName) {
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    let rootId = await this.findFolder(`appProperties has { key='sukkiriTool' and value='root' } and trashed = false and mimeType = '${G_FOLDER}'`);
    if (!rootId) rootId = await this.createFolder(BACKUP_FOLDER, 'root', 'root');
    let dayId = await this.findFolder(`'${rootId}' in parents and name = '${esc(dayName)}' and trashed = false and mimeType = '${G_FOLDER}'`);
    if (!dayId) dayId = await this.createFolder(dayName, rootId, 'day');
    this.uploadFolder = { id: dayId, path: `/${BACKUP_FOLDER}/${dayName}` };
  }

  async upload(source, item, { onBytes, signal } = {}) {
    const init = await this.api(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,md5Checksum`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': item.mime || 'application/octet-stream',
        'X-Upload-Content-Length': String(item.size),
      },
      body: JSON.stringify({ name: item.name, parents: [this.uploadFolder.id], modifiedTime: new Date(item.mtime).toISOString() }),
      signal,
    });
    const url = init.headers.get('Location');
    if (!url) throw new Error('保存の準備ができませんでした');

    const md5 = new MD5();
    let off = 0;
    let result = null;
    while (off < item.size) {
      const end = Math.min(item.size, off + UPLOAD_CHUNK);
      const chunk = await source.read(item, off, end);
      if (chunk.length !== end - off) throw new Error('ファイルを最後まで読めませんでした');
      md5.update(chunk);
      const res = await this.putChunk(url, chunk, off, item.size, signal);
      if (res.status !== 308) result = await res.json();
      off = end;
      onBytes?.(chunk.length);
    }
    const local = md5.digestHex();
    const verified = !!result && Number(result.size) === item.size && sameHash('md5', result.md5Checksum, local);
    return {
      verified, id: result?.id, hash: local, name: result?.name || item.name,
      path: `${this.uploadFolder.path}/${result?.name || item.name}`,
    };
  }

  async putChunk(url, chunk, off, total, signal) {
    let start = off;
    let body = chunk;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Range': `bytes ${start}-${start + body.length - 1}/${total}` },
          body,
          signal,
        });
        if (res.status === 308 || res.ok) return res;
        if (res.status === 404 || res.status === 410) throw new HttpError(res.status, '保存の受付が切れました');
        if (res.status < 500 && res.status !== 429) throw new HttpError(res.status, await res.text());
      } catch (e) {
        if (e instanceof HttpError || e?.name === 'AbortError') throw e;
      }
      await sleep(1000 * 2 ** attempt);
      // どこまで届いたかを問い合わせ、続きから送り直す
      try {
        const st = await fetch(url, { method: 'PUT', headers: { 'Content-Range': `bytes */${total}` }, signal });
        if (st.ok) return st;
        const range = st.status === 308 ? st.headers.get('Range') : null;
        const received = range ? Number(range.split('-')[1]) + 1 : null;
        if (received != null && received > start && received <= off + chunk.length) {
          body = chunk.subarray(received - off);
          start = received;
          if (!body.length) return st;
        }
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
      }
    }
    throw new Error('通信が不安定なため保存できませんでした');
  }
}

// ======================= OneDrive =======================
const MS_SCOPES = 'offline_access Files.ReadWrite User.Read';
const GRAPH = 'https://graph.microsoft.com/v1.0';

export class OneDrive {
  constructor(clientId, tenant) {
    this.id = 'onedrive';
    this.label = 'OneDrive';
    this.algo = 'qxh';
    this.clientId = clientId;
    this.tenant = tenant || 'consumers';
    this.canUpload = true;
    const saved = JSON.parse(sessionStorage.getItem('ms_token') || 'null');
    this.token = saved?.token || null;
    this.exp = saved?.exp || 0;
    this.refresh = saved?.refresh || null;
  }

  get authority() {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0`;
  }

  get connected() {
    return !!this.token && (Date.now() < this.exp - 60_000 || !!this.refresh);
  }

  get ready() {
    return true;
  }

  async prepare() {}

  // Microsoft の公式ログイン画面へ移動する（戻ってきたら handleRedirect で受け取る）
  async connect({ switchAccount = false } = {}) {
    const verifier = randomString(48);
    const state = randomString(16);
    sessionStorage.setItem('ms_pkce', JSON.stringify({ verifier, state }));
    const p = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: redirectUri(),
      response_mode: 'query',
      scope: MS_SCOPES,
      state,
      code_challenge: await sha256base64url(verifier),
      code_challenge_method: 'S256',
    });
    if (switchAccount) p.set('prompt', 'select_account');
    location.assign(`${this.authority}/authorize?${p}`);
    return new Promise(() => {});
  }

  async handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return null;
    const saved = JSON.parse(sessionStorage.getItem('ms_pkce') || 'null');
    sessionStorage.removeItem('ms_pkce');
    history.replaceState(null, '', redirectUri());
    if (q.has('error')) return { error: q.get('error') === 'access_denied' ? 'cancelled' : q.get('error') };
    if (!saved || saved.state !== q.get('state')) return { error: 'state' };
    const res = await fetch(`${this.authority}/token`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: this.clientId,
        grant_type: 'authorization_code',
        code: q.get('code'),
        redirect_uri: redirectUri(),
        code_verifier: saved.verifier,
        scope: MS_SCOPES,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) return { error: j.error || 'token' };
    this.setTokens(j);
    return { ok: true };
  }

  setTokens(j) {
    this.token = j.access_token;
    this.exp = Date.now() + Number(j.expires_in || 3600) * 1000;
    if (j.refresh_token) this.refresh = j.refresh_token;
    sessionStorage.setItem('ms_token', JSON.stringify({ token: this.token, exp: this.exp, refresh: this.refresh }));
  }

  disconnect() {
    this.token = null;
    this.refresh = null;
    this.exp = 0;
    sessionStorage.removeItem('ms_token');
  }

  async ensureToken(force = false) {
    if (!force && this.token && Date.now() < this.exp - 120_000) return;
    if (!this.refresh) throw new AuthError(this.id);
    const res = await fetch(`${this.authority}/token`, {
      method: 'POST',
      body: new URLSearchParams({ client_id: this.clientId, grant_type: 'refresh_token', refresh_token: this.refresh, scope: MS_SCOPES }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) {
      this.disconnect();
      throw new AuthError(this.id);
    }
    this.setTokens(j);
  }

  async api(url, opts = {}, retried = false) {
    await this.ensureToken();
    const full = url.startsWith('http') ? url : GRAPH + url;
    const res = await fetchRetry(full, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${this.token}` } });
    if (res.status === 401 && !retried) {
      await this.ensureToken(true);
      return this.api(url, opts, true);
    }
    if (res.status === 401) throw new AuthError(this.id);
    if (!res.ok) throw new HttpError(res.status, await res.text());
    return res;
  }

  json(url, opts) {
    return this.api(url, opts).then((r) => r.json());
  }

  async account() {
    const [me, drive] = await Promise.all([
      this.json('/me?$select=displayName,userPrincipalName,mail'),
      this.json('/me/drive?$select=quota,driveType'),
    ]);
    const q = drive.quota || {};
    this.email = me.mail || me.userPrincipalName || me.displayName || '';
    const total = Number(q.total || 0) || Infinity;
    const used = Number(q.used || 0);
    this.quota = { total, used, free: q.remaining != null ? Number(q.remaining) : Math.max(0, total - used) };
    return { email: this.email, quota: this.quota };
  }

  async listAll({ onProgress, signal, exclude } = {}) {
    const root = await this.json('/me/drive/root?$select=id');
    const folders = new Map();
    const files = [];
    let url = '/me/drive/root/delta?$select=id,name,size,file,folder,parentReference,deleted,remoteItem,package';
    while (url) {
      if (signal?.aborted) throw new DOMException('中止しました', 'AbortError');
      const r = await this.json(url);
      for (const it of r.value || []) {
        if (it.deleted || it.remoteItem || it.package) continue;
        if (it.folder) folders.set(it.id, { name: it.name, parent: it.parentReference?.id });
        else if (it.file?.hashes?.quickXorHash && it.size > 0) files.push(it);
      }
      onProgress?.(files.length);
      url = r['@odata.nextLink'] || null;
    }
    const resolve = makeResolver(root.id, folders);
    const entries = files.map((f) => {
      const loc = resolve(f.parentReference?.id);
      const path = `${loc.path}/${f.name}`;
      const reason = loc.underRoot ? excludedReason(path, exclude) : 'outside';
      return {
        service: this.id, algo: this.algo, id: f.id, name: f.name, size: Number(f.size),
        hash: f.file.hashes.quickXorHash, path, eligible: !reason, reason,
      };
    });
    return buildIndex(entries);
  }

  async ensureFolder(dayName) {
    // パスを指定して保存すると、足りないフォルダは自動で作られる
    this.uploadFolder = { path: `/${BACKUP_FOLDER}/${dayName}` };
  }

  async upload(source, item, { onBytes, signal } = {}) {
    const segs = `${this.uploadFolder.path}/${item.name}`.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    const session = await this.json(`/me/drive/root:/${segs}:/createUploadSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item: {
          '@microsoft.graph.conflictBehavior': 'rename',
          fileSystemInfo: { lastModifiedDateTime: new Date(item.mtime).toISOString() },
        },
      }),
      signal,
    });
    const qxh = new QuickXorHash();
    let off = 0;
    let result = null;
    while (off < item.size) {
      const end = Math.min(item.size, off + UPLOAD_CHUNK);
      const chunk = await source.read(item, off, end);
      if (chunk.length !== end - off) throw new Error('ファイルを最後まで読めませんでした');
      qxh.update(chunk);
      const res = await this.putChunk(session.uploadUrl, chunk, off, item.size, signal);
      if (res.status === 200 || res.status === 201) result = await res.json();
      off = end;
      onBytes?.(chunk.length);
    }
    const local = qxh.digestBase64();
    let remote = result?.file?.hashes?.quickXorHash;
    if (result?.id && !remote) {
      const again = await this.json(`/me/drive/items/${result.id}?$select=id,size,file`);
      remote = again.file?.hashes?.quickXorHash;
    }
    const verified = !!result && Number(result.size) === item.size && sameHash('qxh', remote, local);
    return {
      verified, id: result?.id, hash: local, name: result?.name || item.name,
      path: `${this.uploadFolder.path}/${result?.name || item.name}`,
    };
  }

  async putChunk(url, chunk, off, total, signal) {
    let start = off;
    let body = chunk;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        // 受付用 URL には認証情報を付けない（Microsoft の指定）
        const res = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Range': `bytes ${start}-${start + body.length - 1}/${total}` },
          body,
          signal,
        });
        if (res.ok) return res;
        if (res.status === 404 || res.status === 410) throw new HttpError(res.status, '保存の受付が切れました');
        if (res.status < 500 && res.status !== 429) throw new HttpError(res.status, await res.text());
      } catch (e) {
        if (e instanceof HttpError || e?.name === 'AbortError') throw e;
      }
      await sleep(1000 * 2 ** attempt);
      try {
        const st = await fetch(url, { signal });
        const next = st.ok ? (await st.json()).nextExpectedRanges?.[0] : null;
        const received = next ? Number(next.split('-')[0]) : null;
        if (received != null && received > start && received <= off + chunk.length) {
          body = chunk.subarray(received - off);
          start = received;
        }
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
      }
    }
    throw new Error('通信が不安定なため保存できませんでした');
  }
}

// ======================= デモ用（?demo=1） =======================
// 本物のクラウドの代わりに、手元のデモ用ファイルの一部を「クラウドにある」ことにして動きを試せる。
export class DemoCloud {
  constructor(id, label, algo, source) {
    this.id = id;
    this.label = label;
    this.algo = algo;
    this.source = source;
    this.canUpload = true;
    this.connected = sessionStorage.getItem(`demo_${id}`) === '1';
    this.uploaded = new Map();
    this.ready = true;
  }

  async prepare() {}

  async connect() {
    await sleep(700);
    this.connected = true;
    sessionStorage.setItem(`demo_${this.id}`, '1');
  }

  disconnect() {
    this.connected = false;
    sessionStorage.removeItem(`demo_${this.id}`);
  }

  async account() {
    await sleep(200);
    this.email = this.id === 'google' ? 'demo.taro@gmail.com' : 'demo.hanako@outlook.jp';
    const total = 15 * 1024 ** 3;
    const used = (this.id === 'google' ? 9.4 : 3.1) * 1024 ** 3 + [...this.uploaded.values()].reduce((a, b) => a + b.size, 0);
    this.quota = { total, used, free: total - used };
    return { email: this.email, quota: this.quota };
  }

  async listAll({ onProgress, signal } = {}) {
    const entries = [];
    for (const item of this.source.allItems?.() || []) {
      if (signal?.aborted) throw new DOMException('中止しました', 'AbortError');
      if (item.demoCloud !== this.id) continue;
      const h = await hashItem(this.source, item, [this.algo]);
      entries.push({
        service: this.id, algo: this.algo, id: `${this.id}-${item.id}`, name: item.name, size: item.size,
        hash: h[this.algo], path: `/写真/${item.name}`, eligible: !item.demoSynced, reason: item.demoSynced ? 'outside' : null,
      });
    }
    for (const u of this.uploaded.values()) entries.push(u);
    await sleep(600);
    onProgress?.(entries.length);
    return buildIndex(entries);
  }

  async ensureFolder(dayName) {
    this.uploadFolder = { path: `/${BACKUP_FOLDER}/${dayName}` };
  }

  async upload(source, item, { onBytes } = {}) {
    const h = await hashItem(source, item, [this.algo]);
    for (let sent = 0; sent < item.size; sent += 64 * 1024) {
      await sleep(25);
      onBytes?.(Math.min(64 * 1024, item.size - sent));
    }
    const entry = {
      service: this.id, algo: this.algo, id: `${this.id}-up-${item.id}`, name: item.name, size: item.size,
      hash: h[this.algo], path: `${this.uploadFolder.path}/${item.name}`, eligible: true, reason: null,
    };
    this.uploaded.set(entry.id, entry);
    return { verified: true, id: entry.id, hash: entry.hash, name: item.name, path: entry.path };
  }
}
