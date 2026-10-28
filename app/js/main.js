// 画面の流れ: ①クラウドにつなぐ → ②場所を選んでしらべる → ③結果を見て、すっきり（削除）/ 保存
// 削除は「クラウドに中身がまったく同じファイルがある」ものだけ。削除の直前にもう一度確かめる。

import { $, $$, AuthError, HttpError, deviceKind, escapeHtml, formatBytes, formatCount, isAbort, monthLabel, dateLabel, storageGet, storageSet, todayKey } from './util.js';
import { HASH_CHUNK, hashItem, sameHash } from './hash.js';
import { BACKUP_FOLDER, DemoCloud, GoogleDrive, OneDrive, redirectUri } from './clouds.js';
import { DemoSource, DirSource, PickSource, ServerSource } from './sources.js';
import { HashCache } from './cache.js';
import { PowerGuard, getBattery } from './power.js';

const cfg = window.APP_CONFIG || {};

const S = {
  mode: null,
  source: null,
  clouds: [],
  folders: [],
  folderChoices: [],
  chargerSkipped: false,
  items: [],
  stats: null,
  busy: false,
  abort: null,
  device: deviceKind(),
  computer: '',
  lastResult: null,
};

// ---------------- アイコン ----------------
const ICON_PATHS = {
  cloud: '<path d="M7.5 19h9.25a4.25 4.25 0 0 0 .5-8.47A6 6 0 0 0 5.6 9.4 4.8 4.8 0 0 0 7.5 19z"/>',
  cloudCheck: '<path d="M7.5 19h9.25a4.25 4.25 0 0 0 .5-8.47A6 6 0 0 0 5.6 9.4 4.8 4.8 0 0 0 7.5 19z"/><path d="m9.3 14.2 2 2 3.6-4"/>',
  cloudUp: '<path d="M7.5 19h9.25a4.25 4.25 0 0 0 .5-8.47A6 6 0 0 0 5.6 9.4 4.8 4.8 0 0 0 7.5 19z"/><path d="M12 16.5v-5m-2.2 2.2L12 11.5l2.2 2.2"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.4l2 2h8.6A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-8 8"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>',
  shield: '<path d="M12 3 5 6v5.5c0 4.3 3 7.6 7 9.5 4-1.9 7-5.2 7-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  sparkle: '<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.9L12 18.5l-1.8-5.8L4.5 10.8 10.2 9z"/><path d="M19 3v3M17.5 4.5h3"/>',
  back: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  plug: '<path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21"/>',
  battery: '<rect x="3" y="7" width="16" height="10" rx="2.5"/><path d="M21 10.5v3M6.5 10v4"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  star: '<path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"/>',
};

function icon(name, cls = '') {
  return `<span class="ico ${cls}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg></span>`;
}

// ---------------- 画面の切りかえ ----------------
function show(name, step) {
  for (const s of $$('.screen')) s.hidden = s.id !== `screen-${name}`;
  const steps = $('#steps');
  steps.hidden = !step;
  for (const li of $$('li', steps)) {
    const n = Number(li.dataset.step);
    li.classList.toggle('current', n === step);
    li.classList.toggle('done', n < step);
    if (n === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0 });
  $(`#screen-${name} h1`)?.focus({ preventScroll: true });
}

const cloudById = (id) => S.clouds.find((c) => c.id === id);
const sumSize = (arr) => arr.reduce((a, b) => a + b.size, 0);
const deviceWord = () => (S.mode === 'dir' ? 'このスマホ' : S.mode === 'pick' ? 'この端末' : 'このパソコン');
const excludePatterns = () => (S.mode === 'dir' ? [/\/Samsung Gallery(\/|$)/i] : []);

// ---------------- お知らせダイアログ ----------------
// onOk はボタンを押した瞬間に（同期的に）呼ばれる。Google のログイン画面を開くのに必要。
let closeOpenMessage = null;
function message({ title, body, ok = 'わかりました', cancel = null, tone = 'info', onOk = null }) {
  closeOpenMessage?.(false);
  const dlg = $('#dlg-message');
  $('#msg-icon').innerHTML = icon(tone === 'warn' ? 'alert' : tone === 'good' ? 'check' : 'sparkle');
  $('#msg-icon').className = `msg-icon ${tone}`;
  $('#msg-title').textContent = title;
  $('#msg-body').innerHTML = body;
  const okBtn = $('#msg-ok');
  const cancelBtn = $('#msg-cancel');
  okBtn.textContent = ok;
  cancelBtn.textContent = cancel || '';
  cancelBtn.hidden = !cancel;
  return new Promise((resolve) => {
    const done = (v) => {
      closeOpenMessage = null;
      okBtn.onclick = cancelBtn.onclick = dlg.oncancel = null;
      if (dlg.open) dlg.close();
      resolve(v);
    };
    closeOpenMessage = done;
    okBtn.onclick = () => {
      let r = true;
      if (onOk) {
        try { r = onOk(); } catch (e) { r = Promise.reject(e); }
      }
      done(r);
    };
    cancelBtn.onclick = () => done(false);
    dlg.oncancel = (e) => {
      if (!cancel) e.preventDefault(); else done(false);
    };
    dlg.showModal();
    okBtn.focus();
  });
}

function errorText(e) {
  if (e instanceof AuthError) return 'ログインの有効期限が切れました。もう一度つないでください。';
  if (e instanceof HttpError) {
    if (e.status === 403 && /storageQuotaExceeded|quotaLimitReached|insufficientStorage/i.test(e.body || '')) return 'クラウドの空き容量が足りません。';
    if (e.status === 403 && /insufficient|SCOPE/i.test(e.body || '')) return '許可が足りません。最初の画面でクラウドをつなぎ直し、許可の画面で2つともチェックを入れてください。';
    if (e.status === 403) return 'クラウドへの操作が許可されていません。つなぐときの許可をご確認ください。';
    return `クラウドとの通信でエラーが起きました（${e.status}）。少し時間をおいてお試しください。`;
  }
  if (e instanceof TypeError || /network|fetch/i.test(e?.message || '')) return 'インターネットにつながっているか確かめて、もう一度お試しください。';
  return e?.message || 'うまくいきませんでした。';
}

function showError(e, title = 'うまくいきませんでした') {
  console.error(e);
  return message({ title, body: escapeHtml(errorText(e)), tone: 'warn' });
}

// ---------------- 進み具合の画面 ----------------
const progress = {
  open({ title, phases, cancelLabel, note, onCancel }) {
    $('#progress-title').textContent = title;
    $('#progress-note').textContent = note || '';
    $('#phase-list').innerHTML = phases.map((p) => `<li>${icon('check')}<span>${escapeHtml(p)}</span></li>`).join('');
    const btn = $('#btn-cancel');
    btn.textContent = cancelLabel;
    btn.disabled = false;
    btn.onclick = () => {
      btn.disabled = true;
      (onCancel || (() => S.abort?.abort()))();
    };
    this.start = null;
    this.set(null, '準備しています…', '');
  },
  phase(i) {
    $$('#phase-list li').forEach((li, n) => {
      li.classList.toggle('done', n < i);
      li.classList.toggle('current', n === i);
    });
    this.start = null;
    this.set(null, '', '');
  },
  // 進み方の速さから、残り時間の目安を出す（始めて数秒は出さない）
  eta(frac) {
    if (frac == null || frac <= 0) return '';
    if (frac >= 0.995) return 'まもなく終わります';
    const now = performance.now();
    if (!this.start) this.start = { t: now, f: frac };
    const dt = now - this.start.t;
    const df = frac - this.start.f;
    if (dt < 5000 || df < 0.01) return '残り時間を計算しています…';
    const min = ((1 - frac) * dt) / df / 60000;
    if (min < 1) return 'まもなく終わります';
    if (min < 60) return `あと 約 ${Math.ceil(min)} 分`;
    const h = Math.floor(min / 60);
    return `あと 約 ${h} 時間${Math.round(min % 60) >= 10 ? ` ${Math.round(min % 60)} 分` : ''}`;
  },
  set(frac, main, sub) {
    this.next = { frac, main, sub, eta: this.eta(frac) };
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const { frac: f, main: m, sub: s, eta } = this.next;
      $('#progress-eta').textContent = eta;
      const bar = $('#progress-bar');
      bar.classList.toggle('indeterminate', f == null);
      const pct = f == null ? 0 : Math.max(0, Math.min(100, Math.floor(f * 100)));
      $('#progress-fill').style.width = f == null ? '' : `${pct}%`;
      $('#progress-pct').textContent = f == null ? '' : `${pct}%`;
      bar.setAttribute('aria-valuenow', String(pct));
      if (m != null) $('#progress-main').textContent = m;
      if (s != null) $('#progress-sub').textContent = s;
    });
  },
};

// ---------------- 電源まわり ----------------
// 充電していないときだけ「充電器をつないでください」と案内する。
// つなぐと自動で始まるので、押すボタンは増やさない。
async function ensureCharger() {
  const b = await getBattery();
  if (!b || b.charging || (S.chargerSkipped && b.level > 0.3)) return true;
  const dlg = $('#dlg-power');
  const status = $('#power-status');
  const skip = $('#power-skip');
  return new Promise((resolve) => {
    let timer = 0;
    const paint = () => {
      const pct = `${Math.round(b.level * 100)}%`;
      if (b.charging) {
        status.innerHTML = `${icon('check')}<span>充電がはじまりました（電池 ${pct}）。まもなくはじめます。</span>`;
        status.classList.add('ok');
        if (!timer) timer = setTimeout(() => finish(true), 1500);
      } else {
        status.innerHTML = `${icon('battery')}<span>いまの電池：<b>${pct}</b>（充電していません）</span>`;
        status.classList.remove('ok');
      }
    };
    const finish = (go) => {
      clearTimeout(timer);
      b.removeEventListener('chargingchange', paint);
      b.removeEventListener('levelchange', paint);
      skip.onclick = dlg.oncancel = null;
      if (dlg.open) dlg.close();
      resolve(go);
    };
    b.addEventListener('chargingchange', paint);
    b.addEventListener('levelchange', paint);
    skip.onclick = () => {
      S.chargerSkipped = true;
      finish(true);
    };
    dlg.oncancel = (e) => {
      e.preventDefault();
      finish(false);
    };
    paint();
    dlg.showModal();
  });
}

// 長い作業のあいだ、画面・パソコンが眠らないようにし、電池を見守る
function guardPower(onCritical) {
  const guard = new PowerGuard({
    server: S.mode === 'server' ? S.source : null,
    onLow: (low, b) => {
      const el = $('#progress-power');
      el.hidden = !low;
      if (low) el.innerHTML = `${icon('plug')}<span>電池が少なくなっています（${Math.round(b.level * 100)}%）。充電器をつないでください。</span>`;
    },
    onCritical: () => {
      guard.stoppedForBattery = true;
      onCritical();
    },
  });
  guard.start();
  return guard;
}

const BATTERY_STOP_TEXT = '電池がなくなりそうなので、安全なところで止めました。<br>充電器をつないでから、もう一度はじめてください。';

// ---------------- 起動 ----------------
async function init() {
  applyTextSize(storageGet('textSize') === 'large');
  $('#btn-textsize').onclick = () => applyTextSize(!document.documentElement.classList.contains('large'), true);
  window.addEventListener('beforeunload', (e) => {
    if (S.busy) { e.preventDefault(); e.returnValue = ''; }
  });

  const params = new URLSearchParams(location.search);
  const token = $('meta[name="local-token"]')?.content || '';

  if (params.has('demo')) {
    // ?demo=local は設定する方向けの動作確認用: クラウドは見本、パソコンのファイルは本物を扱う
    const local = params.get('demo') === 'local' && await ServerSource.detect(token);
    S.mode = local ? 'server' : 'demo';
    S.source = local ? new ServerSource(token) : new DemoSource();
    S.clouds = [
      new DemoCloud('google', 'Google ドライブ', 'md5', S.source),
      new DemoCloud('onedrive', 'OneDrive', 'qxh', S.source),
    ];
    if (local) {
      startHeartbeat();
      $('#demo-banner').textContent = '動作確認モード：クラウドは見本ですが、パソコンのファイルは本当にゴミ箱へ移します。';
    }
    $('#demo-banner').hidden = false;
  } else {
    if (await ServerSource.detect(token)) {
      S.mode = 'server';
      S.source = new ServerSource(token);
      startHeartbeat();
      S.source.info().then((i) => { S.computer = i.computer || ''; }).catch(() => {});
    } else if (S.device === 'android' && DirSource.supported()) {
      S.mode = 'dir';
      S.source = new DirSource();
    } else {
      S.mode = 'pick';
      S.source = new PickSource();
    }
    if (cfg.googleClientId) S.clouds.push(new GoogleDrive(cfg.googleClientId));
    if (cfg.microsoftClientId) S.clouds.push(new OneDrive(cfg.microsoftClientId, cfg.microsoftTenant));
  }

  if (!S.clouds.length) return showSetup();
  if (!window.isSecureContext) {
    show('setup');
    $('#setup-body').innerHTML = '<p class="lead">このツールは https:// で始まるアドレス、またはパソコンの「はじめる」ファイルから開いてください。</p>';
    return;
  }

  const od = S.clouds.find((c) => c.handleRedirect);
  const back = od ? await od.handleRedirect() : null;

  show('connect', 1);
  renderConnect();
  for (const c of S.clouds) c.prepare().then(renderConnect).catch(() => renderConnect());
  await Promise.all(S.clouds.filter((c) => c.connected).map(refreshAccount));
  renderConnect();
  if (back?.error) loginError(od, back.error);
  else if (back?.ok) await refreshAccount(od).then(renderConnect);
}

function applyTextSize(large, remember = false) {
  document.documentElement.classList.toggle('large', large);
  const btn = $('#btn-textsize');
  btn.textContent = large ? '文字をふつうに' : '文字を大きく';
  btn.setAttribute('aria-pressed', String(large));
  if (remember) storageSet('textSize', large ? 'large' : 'normal');
}

function startHeartbeat() {
  let fails = 0;
  setInterval(async () => {
    try {
      await S.source.heartbeat();
      fails = 0;
      $('#offline-banner').hidden = true;
    } catch {
      if (++fails >= 2) $('#offline-banner').hidden = false;
    }
  }, 30000);
}

function showSetup() {
  show('setup');
  $('#setup-body').innerHTML = `
    <p class="lead">このツールを配る方（設定する方）向けの画面です。<br>使う方は、設定してくれた方にこの画面が出たことをお伝えください。</p>
    <div class="card">
      <h2>設定に必要なこと</h2>
      <ol class="setup-steps">
        <li>Google Cloud で「OAuth クライアント ID」を作る（Google ドライブを使う場合）</li>
        <li>Microsoft Entra で「アプリの登録」をする（OneDrive を使う場合）</li>
        <li><code>app/config.js</code> に ID を書き込む</li>
      </ol>
      <h3>登録するときに入力する値</h3>
      <dl class="setup-values">
        <dt>Google：承認済みの JavaScript 生成元</dt><dd><code>${escapeHtml(location.origin)}</code></dd>
        <dt>Microsoft：リダイレクト URI（シングルページ アプリケーション）</dt><dd><code>${escapeHtml(redirectUri())}</code></dd>
      </dl>
      <p>くわしい手順は、ツールのフォルダにある <b>README.md</b> に書いてあります。</p>
    </div>
    <a class="btn secondary" href="?demo=1">${icon('sparkle')}デモで動きを試す</a>`;
}

// ---------------- ① クラウドにつなぐ ----------------
async function refreshAccount(c) {
  try {
    await c.account();
    c.accountError = false;
  } catch (e) {
    if (e instanceof AuthError) c.disconnect();
    else c.accountError = true;
  }
}

function renderConnect() {
  const list = $('#cloud-list');
  list.innerHTML = S.clouds.map((c) => {
    let status;
    if (c.connecting) status = 'つないでいます…';
    else if (c.connected) {
      status = '<b class="ok-text">つながっています</b>';
      if (c.email) status += `<small>${escapeHtml(c.email)}</small>`;
      if (c.quota) status += `<small>クラウドの空き ${formatBytes(c.quota.free)}</small>`;
    } else status = c.ready ? 'ここを押してつなぐ' : '準備しています…';
    return `<button type="button" class="cloud-card ${c.connected ? 'connected' : ''}" data-cloud="${c.id}" ${c.connecting ? 'disabled' : ''}>
      <span class="cloud-logo ${c.id}">${icon(c.connected ? 'cloudCheck' : 'cloud')}</span>
      <span class="cloud-text"><span class="cloud-name">${escapeHtml(c.label)}</span><span class="cloud-status">${status}</span></span>
      <span class="cloud-go">${c.connected ? icon('check') : icon('arrow')}</span>
    </button>`;
  }).join('');
  for (const btn of $$('.cloud-card', list)) btn.onclick = () => onCloudClick(cloudById(btn.dataset.cloud));
  $('#btn-connect-next').disabled = !S.clouds.some((c) => c.connected);
  $('#connect-hint').hidden = S.clouds.some((c) => c.connected);
  renderPhotoServices();
}

// ---------------- Google フォト・iCloud 写真（公式の機能を案内する） ----------------
// どちらも外部のツールからは中身を確かめられないため、それぞれの公式機能
// （バックアップずみのものだけを、サービス自身が確かめて端末から消す）へ案内する。
const GPHOTOS_ANDROID = 'intent://photos.google.com/#Intent;scheme=https;package=com.google.android.apps.photos;'
  + 'S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.google.android.apps.photos;end';

function renderPhotoServices() {
  const services = [{ id: 'gphotos', name: 'Google フォト', sub: '「空き容量を増やす」で、保存ずみの写真をスマホから消す', ico: 'photo' }];
  if (S.device !== 'android') services.push({ id: 'icloud', name: 'iCloud 写真（iPhone）', sub: '「iPhone のストレージを最適化」で容量を空ける', ico: 'phone' });
  const el = $('#photo-service-list');
  el.innerHTML = services.map((s) => `<button type="button" class="cloud-card" data-guide="${s.id}">
      <span class="cloud-logo ${s.id}">${icon(s.ico)}</span>
      <span class="cloud-text"><span class="cloud-name">${s.name}</span><span class="cloud-status">${s.sub}</span></span>
      <span class="cloud-go">${icon('arrow')}</span>
    </button>`).join('');
  for (const b of $$('[data-guide]', el)) b.onclick = () => showGuide(b.dataset.guide, 'connect');
}

function guideSteps(steps) {
  return `<ol class="guide-steps">${steps.map(([head, note, extra]) => `<li><span class="guide-num" aria-hidden="true"></span><div>
    <b>${head}</b>${note ? `<small>${note}</small>` : ''}${extra || ''}</div></li>`).join('')}</ol>`;
}

function showGuide(kind, from) {
  S.guideFrom = from;
  show('guide');
  const body = $('#guide-body');
  const phone = S.device === 'android' || S.device === 'ios';
  if (kind === 'gphotos') {
    $('#guide-title').textContent = 'Google フォトで容量を空ける';
    const open = S.device === 'android'
      ? `<a class="btn primary small" href="${GPHOTOS_ANDROID}">${icon('photo')}Google フォトを開く</a>`
      : S.device === 'ios' ? `<a class="btn primary small" href="https://photos.google.com/">${icon('photo')}Google フォトを開く</a>` : '';
    body.innerHTML = `
      <p class="lead">Google フォトに<b>バックアップずみの写真・動画だけ</b>を、Google が確かめたうえでスマホから消してくれる機能です。<br>消したあとも、Google フォトのアプリでいつでも見られます。</p>
      ${phone ? '' : `<div class="info-box">${icon('phone')}<p>この操作はスマホの「フォト」アプリで行います。スマホでこの画面を開くか、下の手順をスマホで行ってください。</p></div>`}
      ${guideSteps([
        ['「フォト」アプリを開きます', '', open],
        ['右上の、自分のアイコンを押します', '丸い顔写真か、名前の頭文字のマークです。'],
        ['バックアップが終わっているか確かめます', '「バックアップ完了」などと出ていれば大丈夫です。まだのときは Wi-Fi につないで、終わるまで待ちます。'],
        ['「このデバイスの空き容量を増やす」を押します', '見つからないときは「フォトの設定」→「バックアップ」の中にあります。'],
        ['「〇〇 GB を空ける」を押します', 'これで完了です。バックアップされていないものは消えません。'],
      ])}
      <div class="tip">${icon('alert')}バックアップの画質が「<b>保存容量の節約画質</b>」の場合、クラウドには少し縮小された写真が残ります。元の画質のまま残したいときは、先に「フォトの設定」→「バックアップ」→「バックアップの画質」を確かめてください。</div>`;
  } else {
    $('#guide-title').textContent = 'iPhone のストレージを最適化する';
    body.innerHTML = `
      <p class="lead">iCloud 写真を使っていると、<b>元の写真は iCloud に保存したまま</b>、iPhone には軽い版だけを置いて容量を空けられます。<br>写真は今までどおり「写真」アプリで見られます。</p>
      ${S.device === 'ios' ? '' : `<div class="info-box">${icon('phone')}<p>この操作は iPhone の「設定」アプリで行います。</p></div>`}
      ${guideSteps([
        ['「設定」アプリを開きます', '歯車のマークのアプリです。'],
        ['いちばん上の、自分の名前を押します'],
        ['「iCloud」→「写真」を押します'],
        ['「この iPhone を同期」がオンか確かめます', '古い iPhone では「iCloud 写真」と表示されます。'],
        ['「iPhone のストレージを最適化」を選びます', 'チェックが付けば完了です。'],
      ])}
      <div class="tip">${icon('alert')}iCloud の空き容量（無料は 5GB）が足りないと、全部は保存できません。また、iPhone の空きが少なくなったときに少しずつ軽い版に置きかわるため、すぐには空かないことがあります。</div>`;
  }
  $('#btn-guide-back').onclick = () => {
    if (S.guideFrom === 'results') showResults();
    else { show('connect', 1); renderConnect(); }
  };
}

function onCloudClick(c) {
  if (!c.connected) return startConnect(c);
  message({
    title: `${c.label} のつなぎ直し`,
    body: `いまは <b>${escapeHtml(c.email || c.label)}</b> でつながっています。<br>別のアカウントでつなぎ直しますか？`,
    ok: 'つなぎ直す',
    cancel: 'このままにする',
    onOk: () => {
      c.disconnect();
      return startConnect(c, { switchAccount: true });
    },
  });
}

// ボタンを押した処理の中から同期的に connect() を呼ぶ（Google のポップアップを開くため）
function startConnect(c, opts) {
  let p;
  try { p = c.connect(opts); } catch (e) { p = Promise.reject(e); }
  c.connecting = true;
  renderConnect();
  const done = () => {
    c.connecting = false;
    renderConnect();
  };
  return p
    .then(() => refreshAccount(c))
    .then(done)
    .catch((e) => {
      // 「つないでいます…」のまま残らないよう、先に表示を戻してからお知らせする
      done();
      return loginError(c, e.code || e.message);
    });
}

function loginError(c, code) {
  let body;
  if (code === 'cancelled') {
    body = `ログインが最後まで終わりませんでした。<br>もう一度「${escapeHtml(c.label)}」を押してください。<br><br>`
      + '<small>ログインの画面に「エラー 403」や「アクセスをブロック」と出た場合は、そのアカウントがまだ登録されていません。設定した方に登録してもらったアカウントを選んでください。</small>';
  } else if (code === 'scope') {
    body = 'Google ドライブの「ファイル情報の表示」の許可が必要です。<br>もう一度つないで、許可の画面で2つともチェックを入れてください。';
  } else if (code === 'popup_failed_to_open') {
    body = 'ログインの画面が開けませんでした。<br>ブラウザがポップアップを止めている可能性があります。アドレスバーのあたりに出る案内から、<b>このサイトのポップアップを許可</b>して、もう一度押してください。';
  } else {
    body = `うまくつなげませんでした。<br>インターネットにつながっているか確かめて、もう一度お試しください。<br><small>（${escapeHtml(code)}）</small>`;
  }
  return message({ title: 'つなげませんでした', body, tone: 'warn' });
}

// 途中でログインの期限が切れたときは、もう一度つないでから続ける
// 同時に保存しているときも、つなぎ直しの案内は1回だけ出す
const reconnecting = new Map();
function reconnect(c) {
  if (!reconnecting.has(c)) reconnecting.set(c, doReconnect(c).finally(() => reconnecting.delete(c)));
  return reconnecting.get(c);
}

async function doReconnect(c) {
  if (c instanceof OneDrive) {
    await message({
      title: 'もう一度ログインが必要です',
      body: 'OneDrive のログインの期限が切れました。お手数ですが、最初からやり直してください。',
      tone: 'warn',
    });
    throw new DOMException('中止しました', 'AbortError');
  }
  const p = await message({
    title: `${c.label} にもう一度つなぎます`,
    body: '安全のため、ログインの確認がもう一度必要になりました。<br>「つなぐ」を押して、ログインしてください。',
    ok: 'つなぐ',
    cancel: 'やめる',
    onOk: () => c.connect(),
  });
  if (!p) throw new DOMException('中止しました', 'AbortError');
  await p;
  await refreshAccount(c);
}

async function ensureConnected(clouds) {
  for (const c of clouds) if (!c.connected) await reconnect(c);
}

async function withAuth(c, fn) {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    await reconnect(c);
    return fn();
  }
}

// ---------------- ② しらべる場所 ----------------
const FOLDER_LABEL = {
  pictures: 'ピクチャ',
  pictures_local: 'ピクチャ（このパソコン内）',
  videos: 'ビデオ',
  downloads: 'ダウンロード',
  desktop: 'デスクトップ',
};

function folderLabel(f) {
  return FOLDER_LABEL[f?.key] || f?.name || '';
}

function foldersLabel(list) {
  if (!list?.length) return '';
  return list.length === 1 ? folderLabel(list[0]) : `${folderLabel(list[0])} ほか${list.length - 1}か所`;
}

// はじめから ✓ を付けておく場所（前回選んだ場所があれば、そちらを優先）
const DEFAULT_FOLDERS = new Set(['pictures', 'pictures_local', 'videos']);
const samePath = (a, b) => a.toLowerCase() === b.toLowerCase();

function blockedText(f) {
  if (f.reason === 'synced') return `${f.service || 'クラウド'} と同期しているため選べません`;
  if (f.reason === 'network') return 'ネットワーク上の場所のため選べません';
  return '見つかりません';
}

function explainBlocked(f) {
  let body;
  if (f.reason === 'synced') {
    body = `「${escapeHtml(folderLabel(f))}」は <b>${escapeHtml(f.service || 'クラウド')}</b> と同期しています。<br>`
      + 'ここで削除すると、<b>クラウドからも消えてしまう</b>ため、このツールでは扱いません。';
    if (/onedrive/i.test(f.service || '')) {
      body += '<div class="tip">💡 OneDrive のフォルダは、エクスプローラーでフォルダを右クリックして<br>「<b>空き容量を増やす</b>」を選ぶと、クラウドに残したままパソコンの容量を空けられます。</div>';
    }
  } else if (f.reason === 'network') {
    body = 'ネットワーク上の場所はゴミ箱が使えないため、このツールでは扱いません。';
  } else {
    body = 'この場所が見つかりませんでした。';
  }
  return message({ title: 'この場所は選べません', body, tone: 'warn' });
}

function goFolder() {
  show('folder', 2);
  renderFolder();
}

async function renderFolder() {
  const body = $('#folder-body');
  const title = $('#folder-title');
  const lead = $('#folder-lead');

  if (S.mode === 'server' || S.mode === 'demo') {
    title.textContent = 'しらべる場所を選びましょう';
    lead.innerHTML = '写真や動画が入っている場所に <b>✓</b> を付けて、下の「しらべる」を押してください。<br>いくつでも選べます（まだ何も消しません）。';
    body.innerHTML = '<p class="loading-line"><span class="spinner"></span>場所を探しています…</p>';
    let folders = [];
    try { folders = await S.source.folders(); } catch (e) { console.error(e); }
    let remembered = [];
    try { remembered = JSON.parse(storageGet('lastFolders') || '[]'); } catch { remembered = []; }
    const extra = remembered.filter((p) => !folders.some((f) => samePath(f.path, p)));
    S.folderChoices = folders.map((f) => ({
      ...f,
      selected: !f.blocked && (remembered.length ? remembered.some((p) => samePath(p, f.path)) : DEFAULT_FOLDERS.has(f.key)),
    }));
    // 前回「ほかの場所」から選んだ場所も、もう一度並べておく
    for (const p of extra) {
      S.folderChoices.push({ key: 'picked', name: p.split(/[\\/]/).filter(Boolean).pop() || p, path: p, selected: true, exists: true });
    }
    renderFolderChoices();
  } else if (S.mode === 'dir') {
    renderDirChoices();
  } else {
    title.textContent = 'しらべる写真・動画を選びましょう';
    lead.innerHTML = 'ボタンを押して、しらべたい写真や動画を選んでください。<br>たくさん選んでも大丈夫です。';
    const pcHint = S.device === 'windows'
      ? '<p class="note">💡 パソコンでは、ツールのフォルダにある「はじめる」をダブルクリックして起動すると、削除まで自動でできます。</p>' : '';
    body.innerHTML = `<input type="file" id="pick-input" multiple accept="image/*,video/*,.heic,.heif" hidden>
      <button type="button" class="btn primary" id="btn-pick-files">${icon('photo')}写真・動画を選ぶ</button>
      <div class="info-box">${icon('shield')}<p>この端末では、ツールから直接は削除できません。<br>しらべたあと、「写真」アプリで安全に消す方法をご案内します。</p></div>${pcHint}`;
    const input = $('#pick-input');
    $('#btn-pick-files').onclick = () => input.click();
    input.onchange = () => {
      if (!input.files?.length) return;
      S.source.setFiles(input.files);
      startScan([{ key: 'picked', name: '選んだ写真・動画' }]);
    };
  }
}

// パソコン：候補の場所に ✓ を付けて選ぶ。「ほかの場所を追加」で好きなフォルダも足せる
function renderFolderChoices() {
  const body = $('#folder-body');
  const list = S.folderChoices;
  const count = list.filter((f) => f.selected).length;
  body.innerHTML = `<div class="folder-list">${list.map((f, i) => `
      <button type="button" class="folder-card ${f.blocked ? 'blocked' : 'selectable'} ${f.selected ? 'selected' : ''}" data-i="${i}" ${f.blocked ? '' : `aria-pressed="${f.selected}"`}>
        ${icon(f.blocked ? 'lock' : 'folder', 'folder-ico')}
        <span class="folder-text"><b>${escapeHtml(folderLabel(f))}</b><small>${escapeHtml(f.path)}</small>${f.blocked ? `<em>${escapeHtml(blockedText(f))}</em>` : ''}</span>
        ${f.blocked ? '' : `<span class="check-mark">${icon('check')}</span>`}
      </button>`).join('')}</div>
    <button type="button" class="btn secondary" id="btn-pick-folder">${icon('plus')}ほかの場所を追加</button>
    <div class="actions"><button type="button" class="btn primary" id="btn-scan" ${count ? '' : 'disabled'}>
      ${icon('sparkle')}${count ? `選んだ ${count}か所をしらべる` : '場所に ✓ を付けてください'}</button></div>`;
  $$('.folder-card', body).forEach((btn) => {
    const f = list[Number(btn.dataset.i)];
    btn.onclick = () => {
      if (f.blocked) return explainBlocked(f);
      f.selected = !f.selected;
      renderFolderChoices();
    };
  });
  $('#btn-pick-folder').onclick = async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      const f = await S.source.pickFolder('写真や動画が入っているフォルダを選んで「OK」を押してください。');
      if (f?.blocked) await explainBlocked(f);
      else if (f) {
        const same = list.find((x) => samePath(x.path, f.path));
        if (same) same.selected = true; else list.push({ ...f, selected: true });
      }
    } catch (e) {
      await showError(e);
    }
    renderFolderChoices();
  };
  $('#btn-scan').onclick = () => {
    const chosen = list.filter((f) => f.selected && !f.blocked);
    storageSet('lastFolders', JSON.stringify(chosen.map((f) => f.path)));
    startScan(chosen);
  };
}

// Android：フォルダを1つずつ追加していき、まとめてしらべる
function renderDirChoices() {
  const body = $('#folder-body');
  const roots = S.source.folders;
  $('#folder-title').textContent = '写真のフォルダを選びましょう';
  $('#folder-lead').innerHTML = '「フォルダを追加」を押して、写真や動画のフォルダを選んでください。いくつでも追加できます。<br>カメラの写真は、ふつう「<b>DCIM</b>」の中の「<b>Camera</b>」に入っています。';
  body.innerHTML = `${roots.length ? `<div class="folder-list">${roots.map((f, i) => `
      <div class="folder-card selected">
        ${icon('folder', 'folder-ico')}
        <span class="folder-text"><b>${escapeHtml(f.name)}</b></span>
        <button type="button" class="icon-btn" data-remove="${i}" aria-label="${escapeHtml(f.name)} を外す">${icon('close')}</button>
      </div>`).join('')}</div>` : ''}
    <button type="button" class="btn ${roots.length ? 'secondary' : 'primary'}" id="btn-add-dir">${icon('plus')}フォルダを追加</button>
    <p class="note">選んだあとに「許可」を押してください。しらべて削除するために必要です。</p>
    ${roots.length ? `<div class="actions"><button type="button" class="btn primary" id="btn-scan">${icon('sparkle')}${roots.length}か所をしらべる</button></div>` : ''}`;
  $$('[data-remove]', body).forEach((b) => {
    b.onclick = () => { S.source.removeFolder(Number(b.dataset.remove)); renderDirChoices(); };
  });
  $('#btn-add-dir').onclick = async () => {
    try {
      const r = await S.source.addFolder();
      if (r?.duplicate) await message({ title: 'もう追加されています', body: `「${escapeHtml(r.name)}」は、すでに選んだフォルダに含まれています。` });
    } catch (e) { await showError(e); }
    renderDirChoices();
  };
  const scan = $('#btn-scan');
  if (scan) scan.onclick = () => startScan(S.source.folders);
}

// ---------------- しらべる（照らし合わせ） ----------------
async function startScan(folders) {
  if (!folders.length) return;
  if (!(await ensureCharger())) return;
  S.folders = folders;
  S.busy = true;
  S.abort = new AbortController();
  const signal = S.abort.signal;
  progress.open({
    title: 'しらべています',
    phases: ['クラウドの一覧を読み込む', '写真・動画を数える', '中身を1つずつ照らし合わせる'],
    cancelLabel: '中止する',
    note: '終わるまで、この画面のままお待ちください。電源を切ったり、ほかのアプリに切りかえたりしないでください。',
  });
  show('progress', 2);
  const guard = guardPower(() => S.abort.abort());
  // しらべ終わった分は覚えておき、途中で止まっても次は続きから早く進む（デモでは使わない）
  const cache = S.mode === 'demo' ? null : await HashCache.open();

  try {
    const clouds = S.clouds.filter((c) => c.connected);
    await ensureConnected(clouds);
    progress.phase(0);
    for (const c of clouds) {
      progress.set(null, `${c.label} の一覧を読み込んでいます`, '');
      c.index = await withAuth(c, () => c.listAll({
        signal,
        exclude: excludePatterns(),
        onProgress: (n) => progress.set(null, `${c.label} の一覧を読み込んでいます`, `${formatCount(n)} 読み込みました`),
      }));
    }

    progress.phase(1);
    progress.set(null, '写真・動画を数えています', '');
    const r = await S.source.scan(folders, { signal, onCount: (n) => progress.set(null, '写真・動画を数えています', formatCount(n)) });
    if (r.blocked?.length && !r.items.length) {
      guard.stop();
      S.busy = false;
      await explainBlocked(r.blocked[0]);
      goFolder();
      return;
    }
    const items = r.items.filter((i) => i.size > 0);

    // 大きさがぴったり同じファイルがクラウドにあるものだけ、中身を計算して照らし合わせる。
    // 手元に同じ大きさのファイルが他にもあるものは、名前ちがいの重複を探すために MD5 も計算する。
    progress.phase(2);
    const sizeCount = new Map();
    for (const it of items) sizeCount.set(it.size, (sizeCount.get(it.size) || 0) + 1);
    const plan = items.map((it) => {
      const cands = clouds.flatMap((c) => c.index.bySize.get(it.size) || []);
      const algos = new Set(cands.map((c) => c.algo));
      if (sizeCount.get(it.size) > 1) algos.add('md5');
      return { it, cands, algos: [...algos] };
    });
    const totalBytes = plan.reduce((a, p) => a + (p.algos.length ? p.it.size : 0), 0) || 1;
    let doneBytes = 0;
    for (let i = 0; i < plan.length; i++) {
      const { it, cands, algos } = plan[i];
      if (signal.aborted) throw new DOMException('中止しました', 'AbortError');
      const label = `${(i + 1).toLocaleString('ja-JP')} / ${formatCount(items.length)}`;
      if (!algos.length) {
        it.status = 'missing';
        progress.set(doneBytes / totalBytes, label, it.name);
        continue;
      }
      const key = cache && HashCache.key(S.mode, it);
      const known = key ? await cache.get(key) : null;
      if (known && algos.every((a) => known[a])) {
        it.hashes = known;
        doneBytes += it.size;
        progress.set(doneBytes / totalBytes, label, it.name);
      } else {
        try {
          it.hashes = await hashItem(S.source, it, algos, {
            signal,
            onBytes: (n) => { doneBytes += n; progress.set(doneBytes / totalBytes, label, it.name); },
          });
          if (key) cache.put(key, { ...(known || {}), ...it.hashes });
        } catch (e) {
          if (isAbort(e)) throw e;
          it.status = 'error';
          continue;
        }
      }
      const hits = cands.filter((c) => sameHash(c.algo, it.hashes[c.algo], c.hash));
      const good = hits.find((h) => h.eligible);
      if (good) { it.status = 'safe'; it.match = good; }
      else if (hits.length) { it.status = 'synced'; it.match = hits[0]; }
      else it.status = 'missing';
    }
    S.items = items;
    S.dups = findDuplicates(items);
    S.stats = { skippedSynced: r.skippedSynced || 0, skippedErrors: r.skippedErrors || 0 };
    guard.stop();
    S.busy = false;
    showResults();
    if (r.blocked?.length) await explainBlocked(r.blocked[0]);
  } catch (e) {
    guard.stop();
    S.busy = false;
    if (guard.stoppedForBattery) {
      await message({ title: '途中で止めました', body: `${BATTERY_STOP_TEXT}<br>しらべ終わった分は覚えているので、次は早く進みます。`, tone: 'warn' });
    } else if (!isAbort(e)) {
      await showError(e);
    }
    goFolder();
  }
}

// ---------------- ③ 結果 ----------------
function groups() {
  const by = (s) => S.items.filter((i) => i.status === s);
  return { safe: by('safe'), missing: by('missing'), synced: by('synced'), error: by('error') };
}

// ---------------- 名前はちがうが中身が同じもの ----------------
// 大きさと MD5 が同じものをまとめ、1つを「残す」に決める（削除の直前には全バイトを見比べる）
const COPY_MARK = /(コピー|copy|\(\d+\)|（\d+）|\s-\s\d+$|~\d+$)/i;

function findDuplicates(items) {
  const map = new Map();
  for (const it of items) {
    if (!it.hashes?.md5) continue;
    const key = `${it.size}:${it.hashes.md5}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  return [...map.values()].filter((list) => list.length > 1).map((list) => ({ items: list, keeper: chooseKeeper(list), skip: false }));
}

// 「コピー」「(1)」などが付いていない名前 → 古いもの → 浅い場所 を優先して残す
function chooseKeeper(list) {
  const marked = (it) => (COPY_MARK.test(it.name.replace(/\.[^.]+$/, '')) ? 1 : 0);
  return list.slice().sort((a, b) => marked(a) - marked(b) || a.mtime - b.mtime
    || (a.rel || a.name).length - (b.rel || b.name).length || (a.rel || a.name).localeCompare(b.rel || b.name))[0];
}

// クラウドに保存ずみのものは「クラウドに保存ずみ」の方で扱うので、ここではまだクラウドにないものだけ
const dupLive = (g) => g.items.filter((i) => i.status === 'missing' || i.status === 'synced');

function dupGroups() {
  return (S.dups || []).filter((g) => {
    const live = dupLive(g);
    return live.length > 1 && live.includes(g.keeper);
  });
}

const dupTargets = (g) => (g.skip ? [] : dupLive(g).filter((i) => i !== g.keeper));

function showResults() {
  show('results', 3);
  const g = groups();
  const canDelete = S.source.canDelete;
  const uploadable = S.clouds.some((c) => c.connected && c.canUpload);
  const where = foldersLabel(S.folders);
  $('#results-lead').innerHTML = `「${escapeHtml(where)}」の写真・動画 <b>${formatCount(S.items.length)}</b> をしらべました。`;

  const hero = $('#results-hero');
  if (!S.items.length) {
    hero.innerHTML = `<div class="hero-card neutral">${icon('photo', 'hero-ico')}<p class="hero-main">写真や動画は見つかりませんでした</p><p>別の場所をしらべてみてください。</p></div>`;
  } else if (g.safe.length) {
    hero.innerHTML = `<div class="hero-card good">
      ${icon('cloudCheck', 'hero-ico')}
      <p class="hero-label">${canDelete ? '空けられる容量' : 'クラウドに保存ずみ'}</p>
      <p class="hero-number">${formatBytes(sumSize(g.safe))}</p>
      <p class="hero-sub">${formatCount(g.safe.length)}の写真・動画が、クラウドにまったく同じ中身で保存されています。</p>
      <button type="button" class="btn primary" id="btn-go-review">${canDelete ? `${icon('sparkle')}確かめて削除へ進む` : `${icon('photo')}保存ずみの一覧と消し方を見る`}</button>
    </div>`;
    $('#btn-go-review').onclick = () => openReview();
  } else {
    hero.innerHTML = `<div class="hero-card neutral">${icon('cloud', 'hero-ico')}<p class="hero-main">クラウドに保存ずみのものはありませんでした</p>
      <p>${g.missing.length && uploadable ? '下の「クラウドに保存する」で保存すると、そのあと削除できるようになります。' : '別の場所をしらべてみてください。'}</p></div>`;
  }

  const cards = [];
  if (g.safe.length) {
    cards.push(`<article class="rcard safe">${icon('cloudCheck', 'rcard-ico')}<div>
      <h2>クラウドに保存ずみ</h2><p class="rnum">${formatCount(g.safe.length)}<span>${formatBytes(sumSize(g.safe))}</span></p>
      <p>${canDelete ? `${deviceWord()}から消しても、クラウドに同じものが残っています。` : 'クラウドに同じものが保存されています。'}</p></div></article>`);
  }
  const dg = dupGroups();
  if (dg.length) {
    const extra = dg.flatMap((d) => dupLive(d).filter((i) => i !== d.keeper));
    cards.push(`<article class="rcard dup">${icon('copy', 'rcard-ico')}<div>
      <h2>名前はちがうけど、中身が同じもの</h2><p class="rnum">${dg.length.toLocaleString('ja-JP')}組<span>${formatCount(extra.length + dg.length)}</span></p>
      <p>${canDelete ? `1つだけ残してまとめると、<b>${formatBytes(sumSize(extra))}</b> 空きます。` : '同じ写真・動画が複数あります。'}</p>
      <button type="button" class="btn secondary small" id="btn-dups">${icon('copy')}${canDelete ? '同じものを1つにまとめる' : '一覧を見る'}</button></div></article>`);
  }
  if (g.missing.length) {
    cards.push(`<article class="rcard missing">${icon('cloudUp', 'rcard-ico')}<div>
      <h2>まだクラウドにないもの</h2><p class="rnum">${formatCount(g.missing.length)}<span>${formatBytes(sumSize(g.missing))}</span></p>
      <p>このツールが消すことはありません。</p>
      ${uploadable ? `<button type="button" class="btn secondary small" id="btn-upload">${icon('cloudUp')}クラウドに保存する</button>` : ''}</div></article>`);
  }
  const keepLines = [];
  if (g.synced.length) keepLines.push(`<li>${formatCount(g.synced.length)}：同期アプリが管理しているクラウドの場所にあるもの（消すとクラウドからも消える恐れがあるため）</li>`);
  if (g.error.length) keepLines.push(`<li>${formatCount(g.error.length)}：読み取れなかったもの</li>`);
  if (S.stats?.skippedSynced) keepLines.push(`<li>${formatCount(S.stats.skippedSynced)}：クラウドと同期中のフォルダにあるもの（しらべていません）</li>`);
  if (S.stats?.skippedErrors) keepLines.push(`<li>${formatCount(S.stats.skippedErrors)}：開けなかったフォルダ</li>`);
  if (keepLines.length) {
    cards.push(`<article class="rcard other">${icon('heart', 'rcard-ico')}<div>
      <h2>念のため残すもの</h2><ul>${keepLines.join('')}</ul></div></article>`);
  }
  // スマホでは、写真の多くが Google フォト / iCloud 写真にあるので、公式機能への案内も出す
  if (S.device === 'android' || S.device === 'ios') {
    cards.push(`<div class="info-box">${icon('photo')}<p>写真を ${S.device === 'ios' ? 'iCloud 写真や ' : ''}Google フォトに保存している場合は、それぞれの公式の機能で、保存ずみのものだけをスマホから消せます。<br>
      <button type="button" class="link-btn inline" id="btn-results-guide">${S.device === 'ios' ? 'iPhone のストレージを最適化する方法' : 'Google フォトで容量を空ける方法'}を見る</button></p></div>`);
  }
  $('#results-cards').innerHTML = cards.join('');
  $('#btn-results-guide')?.addEventListener('click', () => showGuide(S.device === 'ios' ? 'icloud' : 'gphotos', 'results'));
  const up = $('#btn-upload');
  if (up) up.onclick = () => openUpload();
  const dupBtn = $('#btn-dups');
  if (dupBtn) dupBtn.onclick = () => openDupReview();
}

// ---------------- 削除するものの確認 ----------------
let thumbObserver = null;

function openReview() {
  const readOnly = !S.source.canDelete;
  const items = groups().safe.sort((a, b) => b.mtime - a.mtime);
  show('review', 3);
  $('#review-title').textContent = readOnly ? 'クラウドに保存ずみの写真・動画' : '削除するものを確かめましょう';
  $('#review-lead').innerHTML = readOnly
    ? '下の写真・動画は、クラウドに同じものが保存されています。'
    : 'ここに並んでいるものは、クラウドに同じものが保存されています。<br><b>残しておきたいものは、写真を押してください。</b>「残す」に変わり、削除されません。';
  $('#review-howto').hidden = !readOnly;
  if (readOnly) $('#review-howto').innerHTML = howToDeleteHtml();
  $('#review-bar').hidden = readOnly;
  renderGrid(items, readOnly);
  updateReviewSum();
  $('#btn-review-delete').onclick = () => confirmDelete();
  $('#btn-review-back').onclick = () => showResults();
}

function howToDeleteHtml() {
  if (S.device === 'ios') {
    return `<h2>${icon('photo')}iPhone での消し方</h2><ol>
      <li>「写真」アプリを開き、右上の「選択」を押します。</li>
      <li>下の一覧と同じ写真・動画を押して選びます。</li>
      <li>右下のゴミ箱のマークを押して削除します。</li>
      <li>容量を空けるには「アルバム」→「最近削除した項目」で「すべて削除」します。</li></ol>
      <p class="note">「最近削除した項目」に入っているあいだ（30日間）は元に戻せます。</p>`;
  }
  if (S.device === 'android') {
    return `<h2>${icon('photo')}Android での消し方</h2><ol>
      <li>「フォト」や「ギャラリー」アプリを開きます。</li>
      <li>下の一覧と同じ写真・動画を長押しして選びます。</li>
      <li>ゴミ箱のマークを押して削除します。</li></ol>`;
  }
  return `<h2>${icon('photo')}消し方</h2><p>下の一覧と同じ名前のファイルを、いつもお使いの方法で削除してください。</p>`;
}

function resetThumbs() {
  thumbObserver?.disconnect();
  thumbObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      thumbObserver.unobserve(en.target);
      loadThumb(en.target);
    }
  }, { rootMargin: '400px' });
}

const TILE_MARK = {
  delete: () => `${icon('trash')}削除`,
  keep: () => `${icon('heart')}残す`,
  keeper: () => `${icon('star')}残す`,
};

function renderGrid(items, readOnly) {
  const grid = $('#review-grid');
  grid.innerHTML = '';
  resetThumbs();

  let idx = 0;
  let lastMonth = '';
  const byId = new Map(items.map((i) => [i.id, i]));
  const sentinel = document.createElement('div');
  sentinel.className = 'grid-sentinel';
  const more = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) renderMore();
  }, { rootMargin: '800px' });

  function renderMore() {
    const frag = document.createDocumentFragment();
    for (let n = 0; n < 120 && idx < items.length; n++, idx++) {
      const it = items[idx];
      const m = monthLabel(it.mtime);
      if (m !== lastMonth) {
        lastMonth = m;
        const h = document.createElement('h3');
        h.className = 'grid-month';
        h.textContent = m;
        frag.append(h);
      }
      const tile = document.createElement(readOnly ? 'div' : 'button');
      tile.className = `tile${it.keep ? ' keep' : ''}`;
      tile.dataset.id = it.id;
      if (!readOnly) {
        tile.type = 'button';
        tile.setAttribute('aria-pressed', String(it.keep));
      }
      // 名前がちがっても中身で照合しているので、クラウド側の名前がちがうときは添えておく
      const cloudName = it.match?.name && it.match.name !== it.name
        ? `<small class="cloud-name-note">クラウドでは「${escapeHtml(it.match.name)}」</small>` : '';
      tile.innerHTML = `<span class="thumb">${icon(it.kind === 'video' ? 'video' : 'photo', 'thumb-ico')}</span>
        ${readOnly ? '' : `<span class="tile-mark">${it.keep ? TILE_MARK.keep() : TILE_MARK.delete()}</span>`}
        <span class="tile-name">${escapeHtml(it.name)}<small>${dateLabel(it.mtime)} ・ ${formatBytes(it.size)}</small>${cloudName}</span>`;
      tile.title = `${it.rel || it.name}\nクラウドの場所: ${cloudById(it.match.service)?.label} ${it.match.path}`;
      thumbObserver.observe(tile);
      frag.append(tile);
    }
    grid.append(frag);
    if (idx < items.length) grid.append(sentinel); else sentinel.remove();
  }

  if (!readOnly) {
    grid.onclick = (e) => {
      const tile = e.target.closest('.tile');
      if (!tile) return;
      const it = byId.get(tile.dataset.id);
      it.keep = !it.keep;
      tile.classList.toggle('keep', it.keep);
      tile.setAttribute('aria-pressed', String(it.keep));
      tile.querySelector('.tile-mark').innerHTML = it.keep ? TILE_MARK.keep() : TILE_MARK.delete();
      updateReviewSum();
    };
  } else {
    grid.onclick = null;
  }
  renderMore();
  more.observe(sentinel);
}

async function loadThumb(tile) {
  const it = S.items.find((i) => i.id === tile.dataset.id);
  if (!it) return;
  let url = null;
  try { url = await S.source.thumbUrl(it); } catch { url = null; }
  if (!url) return;
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.onload = () => {
    const box = tile.querySelector('.thumb');
    box.innerHTML = '';
    box.append(img);
  };
  img.src = url;
}

function updateReviewSum() {
  const safe = groups().safe;
  const del = safe.filter((i) => !i.keep);
  const kept = safe.length - del.length;
  $('#review-sum').innerHTML = `削除する：<b>${formatCount(del.length)}</b>（${formatBytes(sumSize(del))}）${kept ? `<br><span class="kept">残す：${formatCount(kept)}</span>` : ''}`;
  $('#btn-review-delete').disabled = !del.length;
}

// ---------------- 中身が同じものの確認 ----------------
function openDupReview() {
  const readOnly = !S.source.canDelete;
  show('review', 3);
  $('#review-title').textContent = readOnly ? '中身が同じ写真・動画' : '同じものを1つにまとめましょう';
  $('#review-lead').innerHTML = readOnly
    ? 'まとまりごとに、名前はちがっても中身はまったく同じです。<br>★「残す」以外のものは、「写真」アプリで削除しても大丈夫です。'
    : '名前はちがっても、中身がまったく同じものをまとめました。<br><b>★「残す」の1つを残して、ほかを削除します。</b>残すものを変えたいときは、その写真を押してください。';
  $('#review-howto').hidden = !readOnly;
  if (readOnly) $('#review-howto').innerHTML = howToDeleteHtml();
  $('#review-bar').hidden = readOnly;
  renderDupGrid(readOnly);
  updateDupSum();
  $('#btn-review-delete').onclick = () => confirmDedupe();
  $('#btn-review-back').onclick = () => showResults();
}

function renderDupGrid(readOnly) {
  const grid = $('#review-grid');
  grid.innerHTML = '';
  resetThumbs();
  const list = dupGroups();
  list.forEach((g, gi) => {
    const live = dupLive(g).sort((a, b) => (a === g.keeper ? -1 : b === g.keeper ? 1 : a.mtime - b.mtime));
    const head = document.createElement('div');
    head.className = 'grid-group';
    head.innerHTML = `<h3>${icon('copy')}同じ中身 ${formatCount(live.length)}<small>（1つ ${formatBytes(g.keeper.size)}）</small></h3>
      ${readOnly ? '' : `<button type="button" class="link-btn group-skip" data-g="${gi}"></button>`}`;
    grid.append(head);
    for (const it of live) {
      const tile = document.createElement(readOnly ? 'div' : 'button');
      tile.className = 'tile';
      tile.dataset.id = it.id;
      tile.dataset.g = String(gi);
      if (!readOnly) tile.type = 'button';
      tile.innerHTML = `<span class="thumb">${icon(it.kind === 'video' ? 'video' : 'photo', 'thumb-ico')}</span>
        <span class="tile-mark"></span>
        <span class="tile-name">${escapeHtml(it.name)}<small>${escapeHtml(it.rel && it.rel !== it.name ? it.rel : dateLabel(it.mtime))}</small></span>`;
      thumbObserver.observe(tile);
      grid.append(tile);
    }
    paintDupGroup(gi, g, readOnly);
  });

  grid.onclick = readOnly ? null : (e) => {
    const skipBtn = e.target.closest('.group-skip');
    const tile = e.target.closest('.tile');
    const gi = Number((skipBtn || tile)?.dataset.g);
    if (Number.isNaN(gi)) return;
    const g = list[gi];
    if (skipBtn) g.skip = !g.skip;
    else {
      g.keeper = dupLive(g).find((i) => i.id === tile.dataset.id) || g.keeper;
      g.skip = false;
    }
    paintDupGroup(gi, g, readOnly);
    updateDupSum();
  };
}

function paintDupGroup(gi, g, readOnly) {
  for (const tile of $$(`.tile[data-g="${gi}"]`)) {
    const isKeeper = tile.dataset.id === g.keeper.id;
    const mark = isKeeper ? 'keeper' : g.skip ? 'keep' : 'delete';
    tile.classList.toggle('keeper', isKeeper);
    tile.classList.toggle('keep', !isKeeper && g.skip);
    if (!readOnly) tile.setAttribute('aria-pressed', String(isKeeper));
    tile.querySelector('.tile-mark').innerHTML = TILE_MARK[mark]();
  }
  const btn = $(`.group-skip[data-g="${gi}"]`);
  if (btn) btn.textContent = g.skip ? 'このまとまりも整理する' : 'このまとまりは整理しない';
}

function updateDupSum() {
  const del = dupGroups().flatMap(dupTargets);
  $('#review-sum').innerHTML = `削除する：<b>${formatCount(del.length)}</b>（${formatBytes(sumSize(del))}）<br><span class="kept">★ 各まとまりの1つは残します</span>`;
  $('#btn-review-delete').disabled = !del.length;
}

// ---------------- 削除の最終確認 ----------------
const recyclePoint = () => (S.source.recycle && S.mode !== 'dir'
  ? '削除したものは「<b>ゴミ箱</b>」に入ります。ゴミ箱を空にするまでは、元に戻せます。'
  : null);

function openConfirm({ targets, points, onOk }) {
  const dlg = $('#dlg-delete');
  $('#del-summary').innerHTML = `${deviceWord()}から<br><b>${formatCount(targets.length)}（${formatBytes(sumSize(targets))}）</b>を削除します。`;
  $('#del-points').innerHTML = points.filter(Boolean).map((p) => `<li>${icon('check')}<span>${p}</span></li>`).join('');
  const agree = $('#del-agree');
  const ok = $('#del-ok');
  const cancel = $('#del-cancel');
  agree.checked = false;
  ok.disabled = true;
  agree.onchange = () => { ok.disabled = !agree.checked; };
  const finish = (go) => {
    ok.onclick = cancel.onclick = null;
    dlg.close();
    if (go && agree.checked) onOk();
  };
  ok.onclick = () => finish(true);
  cancel.onclick = () => finish(false);
  dlg.showModal();
  cancel.focus();
}

function confirmDelete() {
  const targets = groups().safe.filter((i) => !i.keep);
  if (!targets.length) return;
  const clouds = [...new Set(targets.map((t) => cloudById(t.match.service)?.label))].join('・');
  openConfirm({
    targets,
    points: [
      `どれも <b>${escapeHtml(clouds)}</b> に、中身がまったく同じものが保存されていることを確かめました。`,
      '削除する直前に、1つずつもう一度クラウドと照らし合わせます。',
      recyclePoint() || '削除したものは、クラウドからいつでも見たり、ダウンロードしたりできます。',
    ],
    onOk: () => runDelete(targets),
  });
}

function confirmDedupe() {
  const targets = dupGroups().flatMap(dupTargets);
  if (!targets.length) return;
  openConfirm({
    targets,
    points: [
      '中身がまったく同じものが複数あるときは、<b>★「残す」の1つだけ</b>を残して、ほかを削除します。',
      '削除する直前に、残すものと最初から最後まで1バイトずつ同じかを確かめます。少しでもちがえば削除しません。',
      recyclePoint(),
    ],
    onOk: () => runDedupe(),
  });
}

async function runDelete(targets) {
  if (!(await ensureCharger())) return;
  S.busy = true;
  let stop = false;
  const requestStop = () => {
    stop = true;
    progress.set(null, '止めています…', 'いま確かめているものが終わったら止まります');
  };
  progress.open({
    title: 'すっきりさせています',
    phases: ['クラウドをもう一度確かめる', '1つずつ確かめて削除する'],
    cancelLabel: 'ここで止める',
    note: '削除の直前に、クラウドに同じものがあることを1つずつ確かめています。終わるまで、この画面のままにしてください。',
    onCancel: requestStop,
  });
  show('progress', 3);
  const guard = guardPower(requestStop);
  const result = { deleted: [], skipped: [], bytes: 0, stopped: false, guard };

  try {
    progress.phase(0);
    const fresh = {};
    for (const id of new Set(targets.map((t) => t.match.service))) {
      const c = cloudById(id);
      await ensureConnected([c]);
      progress.set(null, `${c.label} をもう一度確かめています`, '');
      fresh[id] = (await withAuth(c, () => c.listAll({ exclude: excludePatterns() }))).byId;
    }
    progress.phase(1);
    const total = sumSize(targets) || 1;
    let doneBytes = 0;
    for (let i = 0; i < targets.length; i++) {
      if (stop) { result.stopped = true; break; }
      const t = targets[i];
      const label = `${(i + 1).toLocaleString('ja-JP')} / ${formatCount(targets.length)}`;
      const base = doneBytes;
      const outcome = await verifyAndRemove(t, fresh, (n) => progress.set((base + n) / total, label, t.name));
      doneBytes = base + t.size;
      progress.set(doneBytes / total, label, t.name);
      if (outcome === true) {
        t.status = 'deleted';
        result.deleted.push(t);
        result.bytes += t.size;
      } else {
        result.skipped.push({ item: t, reason: outcome });
      }
    }
  } catch (e) {
    if (!isAbort(e)) await showError(e, '途中で止まりました');
    result.stopped = true;
  }
  guard.stop();
  S.busy = false;
  S.lastResult = result;
  showDone(result);
}

// 削除する直前の最終確認。1つでも合わなければ消さずに理由を返す
async function verifyAndRemove(t, fresh, onProgressBytes) {
  const f = fresh[t.match.service]?.get(t.match.id);
  if (!f || !f.eligible || f.size !== t.size || !sameHash(f.algo, f.hash, t.match.hash)) return 'cloud_changed';
  const st = await S.source.stat(t);
  if (!st) return 'missing';
  if (st.size !== t.size || st.mtime !== t.mtime) return 'local_changed';
  let h;
  let read = 0;
  try {
    h = await hashItem(S.source, t, [f.algo], { onBytes: (n) => { read += n; onProgressBytes(read); } });
  } catch {
    return 'read';
  }
  if (!sameHash(f.algo, h[f.algo], f.hash)) return 'local_changed';
  t.removedInfo = { label: cloudById(f.service).label, path: f.path };
  return removeItem(t, f.algo === 'md5' ? 'MD5（中身の指紋）が一致' : 'QuickXorHash（中身の指紋）が一致');
}

async function removeItem(t, check) {
  let r;
  try {
    r = await S.source.remove(t, { cloud: t.removedInfo.label, cloudPath: t.removedInfo.path, check });
  } catch {
    return 'error';
  }
  return r?.ok ? true : (r?.reason || 'error');
}

async function runDedupe() {
  if (!(await ensureCharger())) return;
  const pairs = dupGroups().flatMap((g) => dupTargets(g).map((d) => ({ d, k: g.keeper })));
  S.busy = true;
  let stop = false;
  const requestStop = () => {
    stop = true;
    progress.set(null, '止めています…', 'いま見比べているものが終わったら止まります');
  };
  progress.open({
    title: '同じものを1つにまとめています',
    phases: ['残すものと1つずつ見比べて削除する'],
    cancelLabel: 'ここで止める',
    note: '残すファイルと最初から最後まで同じかを確かめてから、削除しています。終わるまで、この画面のままにしてください。',
    onCancel: requestStop,
  });
  show('progress', 3);
  progress.phase(0);
  const guard = guardPower(requestStop);
  const result = { kind: 'dup', deleted: [], skipped: [], bytes: 0, stopped: false, guard };
  const total = sumSize(pairs.map((p) => p.d)) || 1;
  let doneBytes = 0;
  try {
    for (let i = 0; i < pairs.length; i++) {
      if (stop) { result.stopped = true; break; }
      const { d, k } = pairs[i];
      const label = `${(i + 1).toLocaleString('ja-JP')} / ${formatCount(pairs.length)}`;
      const base = doneBytes;
      const outcome = await verifyDuplicateAndRemove(k, d, (n) => progress.set((base + n) / total, label, d.name));
      doneBytes = base + d.size;
      if (outcome === true) {
        d.status = 'deleted';
        result.deleted.push(d);
        result.bytes += d.size;
      } else {
        result.skipped.push({ item: d, reason: outcome });
      }
    }
  } catch (e) {
    if (!isAbort(e)) await showError(e, '途中で止まりました');
    result.stopped = true;
  }
  guard.stop();
  S.busy = false;
  showDone(result);
}

// 残すファイル(k)と消すファイル(d)を、削除の直前に全バイト見比べる
async function verifyDuplicateAndRemove(k, d, onProgressBytes) {
  if (k === d || (k.rel && k.rel === d.rel)) return 'error';
  for (const it of [k, d]) {
    const st = await S.source.stat(it);
    if (!st) return 'missing';
    if (st.size !== it.size || st.mtime !== it.mtime) return 'local_changed';
  }
  let read = 0;
  try {
    for (let off = 0; off < d.size; off += HASH_CHUNK) {
      const end = Math.min(d.size, off + HASH_CHUNK);
      const [a, b] = await Promise.all([S.source.read(k, off, end), S.source.read(d, off, end)]);
      if (a.length !== end - off || b.length !== end - off) return 'read';
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return 'local_changed';
      read += a.length;
      onProgressBytes(read);
    }
  } catch {
    return 'read';
  }
  d.removedInfo = { label: '同じ中身のファイル（手元に残しています）', path: k.rel || k.name };
  return removeItem(d, '全バイト一致');
}

const SKIP_REASON = {
  cloud_changed: 'クラウド側の状態が変わっていた',
  local_changed: 'ファイルが書きかえられていた',
  changed: 'ファイルが書きかえられていた',
  missing: 'ファイルが見つからなかった',
  in_use: 'ほかのアプリで使用中だった',
  synced: '同期中の場所にあった',
  read: '読み取れなかった',
  error: 'うまく削除できなかった',
};

function showDone(result) {
  show('done', 3);
  const n = result.deleted.length;
  const recycle = S.source.recycle && S.mode !== 'dir';
  $('#done-title').textContent = n ? 'すっきりしました！' : '削除したものはありません';
  $('#done-amount').textContent = n ? formatBytes(result.bytes) : '';
  $('#done-amount').hidden = !n;
  let lead = '';
  const remains = result.kind === 'dup' ? '同じ中身のファイルは、それぞれ1つずつ残っています。' : '消したものは、クラウドからいつでも見られます。';
  if (n && recycle) {
    lead = `${formatCount(n)}を<b>ゴミ箱</b>に移しました。<br>ゴミ箱を空にすると、パソコンの空き容量が <b>${formatBytes(result.bytes)}</b> 増えます。<br>空にするまでは、ゴミ箱からいつでも元に戻せます。`;
    if (result.kind === 'dup') lead += `<br>${remains}`;
  } else if (n) {
    lead = `${formatCount(n)}を削除して、<b>${formatBytes(result.bytes)}</b> 空けました。<br>${remains}`;
  }
  if (result.guard?.stoppedForBattery) lead += `${lead ? '<br>' : ''}${BATTERY_STOP_TEXT}`;
  else if (result.stopped) lead += `${lead ? '<br>' : ''}途中で止めました。残りはそのままです。`;
  $('#done-lead').innerHTML = lead;

  const extra = [];
  if (n && recycle && S.mode === 'server') {
    extra.push(`<div class="info-box">${icon('trash')}<p>ゴミ箱を空にするには、デスクトップの「ごみ箱」を右クリックして「ごみ箱を空にする」を選びます。</p></div>`);
  }
  if (result.skipped.length) {
    const counts = {};
    for (const s of result.skipped) counts[s.reason] = (counts[s.reason] || 0) + 1;
    extra.push(`<article class="rcard other">${icon('heart', 'rcard-ico')}<div><h2>念のため削除しなかったもの</h2><ul>${
      Object.entries(counts).map(([k, v]) => `<li>${formatCount(v)}：${SKIP_REASON[k] || SKIP_REASON.error}</li>`).join('')}</ul></div></article>`);
  }
  $('#done-extra').innerHTML = extra.join('');

  const links = [];
  if (S.mode === 'server' && n) {
    links.push(`<button type="button" class="btn secondary" id="btn-open-recycle">${icon('trash')}ゴミ箱を開く</button>`);
    links.push(`<button type="button" class="link-btn" id="btn-open-log">削除の記録（一覧表）を見る</button>`);
  } else if (n) {
    links.push(`<button type="button" class="link-btn" id="btn-save-log">削除の記録（一覧表）を保存する</button>`);
  }
  $('#done-links').innerHTML = links.join('');
  $('#btn-open-recycle')?.addEventListener('click', () => S.source.open('recycle'));
  $('#btn-open-log')?.addEventListener('click', () => S.source.open('log'));
  $('#btn-save-log')?.addEventListener('click', () => downloadLog(result));
  $('#btn-done-home').onclick = () => goFolder();
}

function downloadLog(result) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['日時', 'ファイル', 'サイズ(バイト)', '同じ中身が残っている所', 'その場所'].map(q).join(',')];
  const now = new Date().toLocaleString('ja-JP');
  for (const t of result.deleted) {
    lines.push([now, t.rel || t.name, t.size, t.removedInfo?.label, t.removedInfo?.path].map(q).join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `削除記録_${todayKey()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---------------- クラウドに保存（アップロード） ----------------
function dayFolderName() {
  const who = S.mode === 'server' ? (S.computer || 'パソコン')
    : S.mode === 'demo' ? 'デモ'
      : S.device === 'ios' ? 'iPhone' : S.device === 'android' ? 'Android' : 'ブラウザ';
  return `${todayKey()} ${who}`;
}

async function openUpload() {
  // 中身が同じものは「残す」1つだけを保存する（ほかは保存後に「保存ずみ」として扱える）
  const extras = new Set(dupGroups().flatMap((g) => dupLive(g).filter((i) => i !== g.keeper)));
  const missing = groups().missing;
  const targets = missing.filter((i) => !extras.has(i));
  const clouds = S.clouds.filter((c) => c.connected && c.canUpload);
  if (!targets.length || !clouds.length) return;
  const needed = sumSize(targets);
  const dlg = $('#dlg-upload');
  const skipped = missing.length - targets.length;
  $('#up-summary').innerHTML = `まだクラウドにない <b>${formatCount(targets.length)}（${formatBytes(needed)}）</b>を、クラウドに保存します。`
    + (skipped ? `<br><small>名前ちがいで中身が同じもの ${formatCount(skipped)}は、1つだけ保存します。</small>` : '');
  $('#up-capacity').innerHTML = '<p class="loading-line"><span class="spinner"></span>クラウドの空き容量を確かめています…</p>';
  $('#up-targets').innerHTML = '';
  const ok = $('#up-ok');
  ok.disabled = true;
  ok.onclick = null;
  $('#up-cancel').onclick = () => dlg.close();
  dlg.showModal();

  await Promise.all(clouds.map(refreshAccount));
  let chosen = clouds.slice().sort((a, b) => (b.quota?.free ?? 0) - (a.quota?.free ?? 0))[0];
  if (clouds.length > 1) {
    $('#up-targets').innerHTML = `<p class="up-label">保存先を選んでください</p>${clouds.map((c) => `
      <label class="choice"><input type="radio" name="up-target" value="${c.id}" ${c === chosen ? 'checked' : ''}>
      <span><b>${escapeHtml(c.label)}</b><small>空き ${c.quota ? formatBytes(c.quota.free) : '不明'}</small></span></label>`).join('')}`;
    for (const r of $$('input[name="up-target"]', dlg)) r.onchange = () => { chosen = cloudById(r.value); renderCapacity(); };
  }

  function renderCapacity() {
    const q = chosen.quota;
    const margin = 200 * 1024 ** 2;
    if (!q) {
      $('#up-capacity').innerHTML = `<p class="warn-text">${icon('alert')}空き容量を確かめられませんでした。時間をおいてお試しください。</p>`;
      ok.disabled = true;
      return;
    }
    const enough = !Number.isFinite(q.free) || q.free - needed >= margin;
    const total = Number.isFinite(q.total) ? q.total : q.used + q.free;
    const pctUsed = Number.isFinite(total) ? Math.min(100, (q.used / total) * 100) : 0;
    const pctNew = Number.isFinite(total) ? Math.min(100 - pctUsed, (needed / total) * 100) : 0;
    $('#up-capacity').innerHTML = `
      <div class="cap-bar ${enough ? '' : 'over'}" role="img" aria-label="クラウドの容量">
        <span class="cap-used" style="width:${pctUsed}%"></span><span class="cap-new" style="width:${pctNew}%"></span>
      </div>
      <dl class="cap-list">
        <div><dt>${escapeHtml(chosen.label)} のいまの空き</dt><dd>${formatBytes(q.free)}</dd></div>
        <div><dt>今回保存する分</dt><dd>${formatBytes(needed)}</dd></div>
        <div class="cap-after"><dt>保存したあとの空き</dt><dd>${Number.isFinite(q.free) ? formatBytes(Math.max(0, q.free - needed)) : '無制限'}</dd></div>
      </dl>
      <p class="note">保存先：${escapeHtml(chosen.label)} の「${BACKUP_FOLDER}」フォルダ</p>
      ${enough ? '' : `<p class="warn-text">${icon('alert')}クラウドの空き容量が足りません。クラウドの容量を増やすか、写真を減らしてからお試しください。</p>`}`;
    ok.disabled = !enough;
  }
  renderCapacity();

  ok.onclick = () => {
    if (ok.disabled) return;
    ok.onclick = null;
    dlg.close();
    runUpload(chosen, targets);
  };
}

const UPLOAD_PARALLEL = 3;

async function runUpload(c, targets) {
  if (!(await ensureCharger())) return;
  S.busy = true;
  let stop = false;
  const requestStop = () => {
    stop = true;
    progress.set(null, '止めています…', 'いま保存しているものが終わったら止まります');
  };
  progress.open({
    title: 'クラウドに保存しています',
    phases: ['保存先のフォルダを用意する', '保存して、中身が同じか確かめる'],
    cancelLabel: 'ここで止める',
    note: '保存したあと、クラウドの中身が手元とまったく同じかも確かめています。終わるまで、この画面のままにしてください。',
    onCancel: requestStop,
  });
  show('progress', 3);
  const guard = guardPower(requestStop);
  const okList = [];
  const ngList = [];
  try {
    await ensureConnected([c]);
    progress.phase(0);
    await withAuth(c, () => c.ensureFolder(dayFolderName()));
    progress.phase(1);
    const total = sumSize(targets) || 1;
    let doneBytes = 0;
    let finished = 0;
    let next = 0;
    let fatal = false;
    // 小さな写真がたくさんあるときは、1つずつより何件か同時に送るほうがずっと早い
    const worker = async () => {
      while (!stop && !fatal && next < targets.length) {
        const t = targets[next++];
        const label = () => `${(finished + 1).toLocaleString('ja-JP')} / ${formatCount(targets.length)}`;
        await uploadOne(t, (n) => { doneBytes += n; progress.set(doneBytes / total, label(), t.name); });
        finished++;
      }
    };
    const uploadOne = async (t, onBytes) => {
      let sent = 0;
      try {
        const r = await withAuth(c, () => {
          doneBytes -= sent;
          sent = 0;
          return c.upload(S.source, t, { onBytes: (n) => { sent += n; onBytes(n); } });
        });
        if (r.verified) {
          t.status = 'safe';
          t.uploaded = true;
          t.match = { service: c.id, algo: c.algo, id: r.id, hash: r.hash, name: r.name, path: r.path, size: t.size, eligible: true };
          okList.push(t);
          S.source.logUpload?.(t, c.label, r.path);
          // 中身が同じほかのファイルも、いま保存したものと照合できる（削除の直前には各ファイルを計算し直して確かめる）
          for (const g of S.dups || []) {
            if (g.keeper !== t) continue;
            for (const twin of g.items) {
              if (twin !== t && twin.status === 'missing') { twin.status = 'safe'; twin.match = { ...t.match }; }
            }
          }
        } else {
          ngList.push(t);
        }
      } catch (e) {
        if (isAbort(e)) { fatal = true; return; }
        console.error(e);
        ngList.push(t);
        // 容量不足や権限の問題は、続けても同じなので止める
        if (e instanceof HttpError && e.status === 403) fatal = true;
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_PARALLEL, targets.length) }, worker));
  } catch (e) {
    if (!isAbort(e)) await showError(e, '保存の途中で止まりました');
  }
  guard.stop();
  S.busy = false;
  showResults();
  const body = [];
  if (okList.length) body.push(`<b>${formatCount(okList.length)}</b>を ${escapeHtml(c.label)} に保存し、中身がまったく同じことを確かめました。`);
  if (ngList.length) body.push(`${formatCount(ngList.length)}は保存できませんでした（消さずにそのまま残しています）。`);
  if (guard.stoppedForBattery) body.push(BATTERY_STOP_TEXT);
  else if (stop) body.push('途中で止めました。');
  if (okList.length && S.source.canDelete) body.push('保存したものは「クラウドに保存ずみ」に加わり、削除できるようになりました。');
  await message({
    title: okList.length ? '保存できました' : '保存できませんでした',
    body: body.join('<br>') || '保存したものはありません。',
    tone: okList.length ? 'good' : 'warn',
  });
}

// ---------------- ボタンの割り当て ----------------
$('#btn-connect-next').onclick = () => goFolder();
$('#btn-folder-back').onclick = () => { show('connect', 1); renderConnect(); };
$('#btn-results-other').onclick = () => goFolder();

init().catch((e) => {
  console.error(e);
  showError(e, '起動できませんでした');
});
