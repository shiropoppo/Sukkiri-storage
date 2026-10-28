// 小さな共通部品

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(status, body) {
    super(`通信エラー（${status}）`);
    this.status = status;
    this.body = body;
  }
}

// ログインの有効期限切れなど、もう一度ログインが必要なとき
export class AuthError extends Error {
  constructor(cloudId) {
    super('もう一度ログインが必要です');
    this.cloudId = cloudId;
  }
}

export const isAbort = (e) => e?.name === 'AbortError';

// 混雑（429）や一時的な不調（5xx）、通信の途切れは、少し待ってやり直す
export async function fetchRetry(url, opts = {}, retries = 5) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      if (isAbort(e) || attempt >= retries) throw e;
      await sleep(backoff(attempt));
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const ra = Number(res.headers.get('Retry-After'));
      await sleep(ra > 0 ? Math.min(ra, 60) * 1000 : backoff(attempt));
      continue;
    }
    return res;
  }
}

const backoff = (attempt) => Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500;

export function randomString(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return base64url(a);
}

export function base64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256base64url(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return base64url(new Uint8Array(digest));
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '無制限';
  const GB = 1024 ** 3, MB = 1024 ** 2, KB = 1024;
  if (n >= 100 * GB) return `${Math.round(n / GB).toLocaleString('ja-JP')} GB`;
  if (n >= GB) return `${(n / GB).toFixed(1)} GB`;
  if (n >= 10 * MB) return `${Math.round(n / MB)} MB`;
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  if (n >= KB) return `${Math.round(n / KB)} KB`;
  return `${n} バイト`;
}

export const formatCount = (n) => `${n.toLocaleString('ja-JP')}件`;

export function monthLabel(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

export function dateLabel(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function todayKey() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`${src} を読み込めませんでした`));
    document.head.appendChild(s);
  });
}

// 端末の種類（画面の説明文や、保存先フォルダ名に使う）
export function deviceKind() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  return 'other';
}

export function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 保存できない環境では覚えない */ }
}
