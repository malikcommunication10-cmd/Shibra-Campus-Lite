// Shibra Campus Lite: config, auth, API, router. No libraries, no build step.
const D = { url: 'https://tsnfwebctvjnmmweepiu.supabase.co', key: 'sb_publishable_mQcfSTQd8nca5xzbT1q6dw_aRvOHIYh' };
const LS = localStorage, rd = (k, d) => { try { return JSON.parse(LS.getItem(k)) ?? d; } catch { return d; } };
export const cfg = () => ({ ...D, ...rd('sl_cfg', {}) });
export const $ = (s, e = document) => e.querySelector(s);
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pkr = n => (+n || 0).toLocaleString('en-US');
let S = rd('sl_sess', null), ME = null;
export const can = (p, a = 'v') => !!ME && String((ME.perms.pages || {})[p] || '').includes(a);
export const me = () => ME;
export const ask = t => new Promise(res => { const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="box"><div>${esc(t)}</div><div class="row"><button class="btn" id="n">Cancel</button><button class="btn p" id="y">Yes</button></div></div>`; document.body.appendChild(m); m.querySelector('#n').onclick = () => { m.remove(); res(false); }; m.querySelector('#y').onclick = () => { m.remove(); res(true); }; });
export const flag = f => !!ME && (ME.perms.flags || []).includes(f);

async function auth(path, body) {
  const c = cfg(), r = await fetch(`${c.url}/auth/v1/${path}`, { method: 'POST', headers: { apikey: c.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error_description || d.msg || 'Sign in failed. Check your email and password.');
  return d;
}
const keep = d => { S = { access: d.access_token, refresh: d.refresh_token, exp: Date.now() + (d.expires_in - 60) * 1e3, email: d.user.email }; LS.setItem('sl_sess', JSON.stringify(S)); };
async function token() {
  if (!S) throw Error('auth');
  if (Date.now() > S.exp) { try { keep(await auth('token?grant_type=refresh_token', { refresh_token: S.refresh })); } catch { logout(); throw Error('auth'); } }
  return S.access;
}
export const getToken = () => token();
export function logout() { S = ME = null; LS.removeItem('sl_sess'); location.hash = '#/login'; route(); }

// api('students?select=a,b', {count:1, range:[0,49]}) -> {rows,total}. Always request only the columns you need.
export async function api(path, o = {}) {
  const c = cfg(), h = { apikey: c.key, Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' };
  if (o.count) h.Prefer = 'count=exact';
  if (o.prefer) h.Prefer = o.prefer;
  if (o.range) { h.Range = o.range.join('-'); h['Range-Unit'] = 'items'; }
  const r = await fetch(`${c.url}/rest/v1/${path}`, { method: o.method || 'GET', headers: h, body: o.body ? JSON.stringify(o.body) : undefined });
  const rows = await r.json().catch(() => []);
  if (!r.ok) throw Error(rows.message || 'Request failed (' + r.status + ')');
  const cr = r.headers.get('content-range') || '';
  return { rows, total: cr.includes('/') ? +cr.split('/')[1] : rows.length };
}
// all('table?select=cols&filter'): fetches every row in parallel 1000-row pages (stable order), cached in memory for 2 minutes.
const memo = new Map(); export const bust = () => memo.clear();
export async function all(path, ttl = 120000) {
  const h = memo.get(path); if (h && Date.now() - h.t < ttl) return h.v;
  let ord = null, first;
  for (const o of ['id', 'seq', 'created_at', null]) { try { first = await api(path + (o ? '&order=' + o + '.asc' : ''), { count: 1, range: [0, 999] }); ord = o; break; } catch (e) { if (!o || e.message === 'auth') throw e; } }
  let rows = first.rows; const n = rows.length;
  if (n && first.total > n) { const jobs = []; for (let f = n; f < first.total; f += n) jobs.push(api(path + (ord ? '&order=' + ord + '.asc' : ''), { range: [f, f + n - 1] }).then(r => r.rows)); (await Promise.all(jobs)).forEach(a => { rows = rows.concat(a); }); }
  memo.set(path, { t: Date.now(), v: rows }); return rows;
}
async function loadMe() {
  const { rows: u } = await api('app_users?select=name,role,active,perms&email=eq.' + encodeURIComponent(S.email.toLowerCase()));
  if (!u[0] || u[0].active === false) return null;
  let p = u[0].perms;
  if (!p) p = (await api('app_roles?select=perms&name=eq.' + encodeURIComponent(u[0].role || ''))).rows[0]?.perms || { pages: {}, flags: [] };
  return { email: S.email, name: u[0].name || S.email, role: u[0].role, perms: p };
}

// ---- Supabase connection (gear icon) ----
export function openCfg() {
  const c = cfg(), m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div class="box" role="dialog" aria-label="Supabase connection"><h2>Supabase connection</h2>
  <label>Project URL<input id="cu" value="${esc(c.url)}" placeholder="https://xxxx.supabase.co"></label>
  <label>Publishable key<input id="ck" value="${esc(c.key)}" placeholder="sb_publishable_..."></label>
  <small id="cm" class="msg" style="padding:0;text-align:left">Use the publishable (anon) key only. Never paste a service-role key.</small>
  <div class="row"><button class="btn" id="cr">Reset to default</button><button class="btn" id="ct">Test connection</button><button class="btn p" id="cs">Save</button><button class="btn" id="cx">Close</button></div></div>`;
  document.body.appendChild(m);
  const v = () => ({ url: $('#cu', m).value.trim().replace(/\/+$/, ''), key: $('#ck', m).value.trim() });
  const say = (t, bad) => { const e = $('#cm', m); e.textContent = t; e.className = 'msg' + (bad ? ' err' : ''); e.style.cssText = 'padding:0;text-align:left'; };
  $('#cx', m).onclick = () => m.remove();
  $('#ct', m).onclick = async () => {
    const x = v(); say('Testing...');
    try { const r = await fetch(x.url + '/auth/v1/settings', { headers: { apikey: x.key } }); say(r.ok ? 'Connected. Sign in works with this project.' : 'Rejected (' + r.status + '). Check the URL and key.', !r.ok); } catch { say('Could not reach this URL.', true); }
  };
  $('#cs', m).onclick = () => { const x = v(); if (!/^https:\/\/.+/.test(x.url) || !x.key) return say('Enter both a https:// URL and a key.', true); LS.setItem('sl_cfg', JSON.stringify(x)); LS.removeItem('sl_sess'); location.reload(); };
  $('#cr', m).onclick = () => { LS.removeItem('sl_cfg'); LS.removeItem('sl_sess'); location.reload(); };
}

// ---- Menu: [route, label, permission page]. Only routes in PAGES are built so far. ----
const PAGES = { dashboard: () => import('./pages/dashboard.js'), students: () => import('./pages/students.js'), fees: () => import('./pages/fees.js'), followups: () => import('./pages/followups.js'), 'fee-update': () => import('./pages/fee-update.js'), users: () => import('./pages/users.js'), settings: () => import('./pages/settings.js'), setup: () => import('./pages/setup.js'), accounts: () => import('./pages/accounts.js'), books: () => import('./pages/books.js'), reports: () => import('./pages/reports.js'), statements: () => import('./pages/statements.js'), audit: () => import('./pages/audit.js'), dayclose: () => import('./pages/dayclose.js') };
const NAV = [['Home', [['dashboard', 'Dashboard', 'dashboard']]], ['Students', [['students', 'Directory', 'students'], ['fee-update', 'Fee update', 'increments']]],
  ['Fees', [['fees', 'Vouchers & collection', 'fees'], ['followups', 'Follow-up calls', 'followups']]], ['Finance', [['accounts', 'Daybook & cash', 'accounts'], ['dayclose', 'Day close', 'accounts', 'closeday']]],
  ['Book Store', [['books', 'Sales & inventory', 'books']]], ['Staff', [['staff', 'Staff & payroll', 'staff']]],
  ['Reports', [['reports', 'Business reports', 'reports'], ['statements', 'Financial statements', 'reports'], ['audit', 'Audit trail', 'audit']]],
  ['Admin', [['settings', 'Master lists & rules', 'settings'], ['users', 'Users & roles', 'users'], ['setup', 'Health, backup & setup', 'settings']]]];
const gearBtn = '<button class="btn ic" data-gear title="Supabase connection" aria-label="Supabase connection">⚙</button>';

async function route() {
  const app = $('#app'), r = location.hash.slice(2) || 'dashboard';
  if (!S) { if (r !== 'login') location.hash = '#/login'; return loginView(app); }
  if (r === 'login') { location.hash = '#/dashboard'; return; }
  if (!ME) {
    app.innerHTML = '<div class="msg">Loading...</div>';
    try { ME = await loadMe(); } catch (e) { return e.message === 'auth' ? undefined : fail(app, e.message); }
    if (!ME) return fail(app, 'This email has no access. Ask an administrator to add you in Users & Roles.');
  }
  const groups = NAV.map(([g, items]) => { const li = items.filter(i => can(i[2]) && (!i[3] || flag(i[3]))); return li.length ? `<div class="grp">${g}</div>` + li.map(i => PAGES[i[0]] ? `<a href="#/${i[0]}" class="${i[0] === r ? 'on' : ''}">${i[1]}</a>` : `<a class="off">${i[1]}<em>soon</em></a>`).join('') : ''; }).join('');
  const it = NAV.flatMap(g => g[1]).find(i => i[0] === r);
  app.innerHTML = `<div class="shell"><aside id="sb"><div class="brand">Concept School<small>Shibra Campus</small></div><nav class="nav">${groups}</nav></aside>
  <div><header class="top"><button class="btn ic menu" id="mn" aria-label="Menu">☰</button><h1>${it ? it[1] : 'Dashboard'}</h1><span>${esc(ME.name)}</span>${gearBtn}<button class="btn" id="lo">Sign out</button></header><main id="pg"><div class="msg">Loading...</div></main></div></div>`;
  $('#mn').onclick = () => $('#sb').classList.toggle('open'); $('#lo').onclick = logout;
  const el = $('#pg');
  if (!PAGES[r] || !it || !can(it[2]) || (it[3] && !flag(it[3]))) { el.innerHTML = '<div class="msg">This section is not available yet, or you do not have access.</div>'; return; }
  try { await (await PAGES[r]()).default(el); } catch (e) { if (e.message !== 'auth') el.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}
function fail(app, t) { app.innerHTML = `<div class="login"><div class="box"><div class="msg err">${esc(t)}</div><div class="row"><button class="btn" id="lo">Sign out</button></div></div></div>`; $('#lo').onclick = logout; }
function loginView(app) {
  app.innerHTML = `<div class="login"><div class="gear">${gearBtn}</div><form class="box" id="lf"><h2>Sign in to Shibra Campus</h2>
  <label>Email<input id="em" type="email" autocomplete="username" value="${esc(LS.getItem('sl_email') || '')}" required></label>
  <label>Password<input id="pw" type="password" autocomplete="current-password" required></label><div id="le" class="err"></div><button class="btn p">Sign in</button></form></div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault(); const b = $('#lf button.p'); b.disabled = true; $('#le').textContent = '';
    try { const em = $('#em').value.trim(); keep(await auth('token?grant_type=password', { email: em, password: $('#pw').value })); LS.setItem('sl_email', em); location.hash = '#/dashboard'; route(); }
    catch (x) { $('#le').textContent = x.message; b.disabled = false; }
  };
}
document.addEventListener('click', e => { if (e.target.closest('[data-gear]')) openCfg(); });
addEventListener('hashchange', route);
let idle; const bump = () => { clearTimeout(idle); if (S) idle = setTimeout(logout, 5 * 60 * 1000); };   // 5-minute idle sign-out, same as the old app
['click', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach(ev => addEventListener(ev, bump, { passive: true }));
bump(); route();
