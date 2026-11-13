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
  if (!r.ok) throw Error(d.error_description || d.msg || d.message || 'The authentication request failed.');
  return d;
}
const keep = d => {
  S = {
    access: d.access_token,
    refresh: d.refresh_token || S?.refresh,
    exp: Date.now() + (Math.max(60, Number(d.expires_in) || 3600) - 60) * 1e3,
    email: String(d.user?.email || S?.email || '').toLowerCase()
  };
  LS.setItem('sl_sess', JSON.stringify(S));
};
async function token() {
  if (!S) throw Error('auth');
  if (Date.now() > S.exp) { try { keep(await auth('token?grant_type=refresh_token', { refresh_token: S.refresh })); } catch { logout(); throw Error('auth'); } }
  return S.access;
}
export const getToken = () => token();
const memo = new Map(), apiMemo = new Map(), pendingInvalidations = new Set();
export function logout() { S = ME = null; memo.clear(); apiMemo.clear(); pendingInvalidations.clear(); LS.removeItem('sl_sess'); location.hash = '#/login'; route(); }

const RPC_TABLES = {
  lite_pay_staff_salary: ['accounts', 'payroll', 'staff_payroll_payments'],
  lite_record_staff_salary_advance: ['accounts', 'staff_salary_advances'],
  schedule_staff_salary_increment: ['staff_salary_increments'],
  reschedule_staff_salary_increment: ['staff_salary_increments']
};
const READONLY_RPCS = new Set(['app_business_reports', 'app_audit_events', 'app_followup_data']);
const RPC_DEPENDENCIES = {
  app_business_reports: ['students', 'fees', 'accounts', 'books', 'staff', 'payroll', 'staff_attendance', 'staff_payroll_payments', 'staff_salary_advances', 'staff_salary_increments', 'call_logs', 'increments', 'settings', 'fixed_asset_transactions', 'staff_security_ledger'],
  app_audit_events: ['students', 'fees', 'accounts', 'books', 'staff', 'payroll', 'staff_attendance', 'staff_payroll_payments', 'staff_salary_advances', 'staff_salary_increments', 'call_logs', 'increments', 'settings', 'app_users', 'app_roles', 'day_close', 'fixed_asset_transactions', 'staff_security_ledger'],
  app_followup_data: ['students', 'fees', 'accounts', 'call_logs']
};
const resourceOf = path => String(path).split('?')[0];
function affectedTables(path) {
  const resource = resourceOf(path);
  if (resource.startsWith('rpc/')) return RPC_TABLES[resource.slice(4)] || [];
  return resource ? [resource] : [];
}
function invalidateTables(tables) {
  if (!tables.length) { memo.clear(); apiMemo.clear(); return; }
  const affected = new Set(tables);
  for (const [path] of memo) if (affected.has(resourceOf(path))) memo.delete(path);
  for (const [key, entry] of apiMemo) {
    if (affected.has(entry.resource) || entry.dependencies.some(table => affected.has(table))) apiMemo.delete(key);
  }
}
export function bust(resource) {
  if (resource) {
    const tables = affectedTables(resource);
    invalidateTables(tables);
    tables.forEach(table => pendingInvalidations.delete(table));
    return;
  }
  const tables = [...pendingInvalidations];
  if (tables.length) invalidateTables(tables);
  else invalidateTables([]);
  pendingInvalidations.clear();
}

// api('students?select=a,b', {count:1, range:[0,49]}) -> {rows,total}. Always request only the columns you need.
export async function api(path, o = {}) {
  const method = o.method || 'GET', resource = resourceOf(path);
  const rpcName = resource.startsWith('rpc/') ? resource.slice(4) : '';
  const cacheable = method === 'GET' || (method === 'POST' && READONLY_RPCS.has(rpcName));
  const dependencies = RPC_DEPENDENCIES[rpcName] || [resource];
  const cacheKey = `${method}|${path}|${o.count ? 'count' : ''}|${o.range ? o.range.join('-') : ''}|${o.body ? JSON.stringify(o.body) : ''}`;
  if (cacheable && o.cache !== false && apiMemo.has(cacheKey)) return apiMemo.get(cacheKey).promise;
  const request = async () => {
    const c = cfg(), h = { apikey: c.key, Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' };
    if (o.count) h.Prefer = 'count=exact';
    if (o.prefer) h.Prefer = o.prefer;
    if (o.range) { h.Range = o.range.join('-'); h['Range-Unit'] = 'items'; }
    const r = await fetch(`${c.url}/rest/v1/${path}`, { method, headers: h, body: o.body ? JSON.stringify(o.body) : undefined });
    const rows = await r.json().catch(() => []);
    if (!r.ok) throw Error(rows.message || 'Request failed (' + r.status + ')');
    const cr = r.headers.get('content-range') || '';
    return { rows, total: cr.includes('/') ? +cr.split('/')[1] : rows.length };
  };
  if (!cacheable) {
    const result = await request();
    const tables = affectedTables(path);
    if (tables.length) {
      tables.forEach(table => pendingInvalidations.add(table));
      invalidateTables(tables);
    }
    return result;
  }
  if (o.cache === false) return request();
  if (apiMemo.size >= 200 && !apiMemo.has(cacheKey)) apiMemo.delete(apiMemo.keys().next().value);
  const entry = { resource, dependencies, promise: request() };
  apiMemo.set(cacheKey, entry);
  try { return await entry.promise; }
  catch (error) { apiMemo.delete(cacheKey); throw error; }
}
// Read data once per browser session; successful writes invalidate only the affected table.
export async function all(path, ttl = Infinity) {
  const h = memo.get(path); if (h && Date.now() - h.t < ttl) return h.v;
  let ord = null, first;
  for (const o of ['id', 'seq', 'created_at', null]) { try { first = await api(path + (o ? '&order=' + o + '.asc' : ''), { count: 1, range: [0, 999], cache: ttl !== 0 }); ord = o; break; } catch (e) { if (!o || e.message === 'auth') throw e; } }
  let rows = first.rows; const n = rows.length;
  if (n && first.total > n) { const jobs = []; for (let f = n; f < first.total; f += n) jobs.push(api(path + (ord ? '&order=' + ord + '.asc' : ''), { range: [f, f + n - 1], cache: ttl !== 0 }).then(r => r.rows)); (await Promise.all(jobs)).forEach(a => { rows = rows.concat(a); }); }
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
const PAGES = { dashboard: () => import('./pages/dashboard.js'), students: () => import('./pages/students.js'), fees: () => import('./pages/fees.js'), followups: () => import('./pages/followups.js'), 'fee-update': () => import('./pages/fee-update.js'), users: () => import('./pages/users.js'), settings: () => import('./pages/settings.js'), setup: () => import('./pages/setup.js'), accounts: () => import('./pages/accounts.js'), books: () => import('./pages/books.js'), staff: () => import('./pages/staff.js'), reports: () => import('./pages/reports.js'), statements: () => import('./pages/statements.js'), audit: () => import('./pages/audit.js'), dayclose: () => import('./pages/dayclose.js') };
const NAV = [['Home', [['dashboard', 'Dashboard', 'dashboard']]], ['Students', [['students', 'Directory', 'students'], ['fee-update', 'Fee update', 'increments']]],
  ['Fees', [['fees', 'Vouchers & collection', 'fees'], ['followups', 'Follow-up calls', 'followups']]], ['Finance', [['accounts', 'Daybook & cash', 'accounts'], ['dayclose', 'Day close', 'accounts', 'closeday']]],
  ['Book Store', [['books', 'Sales & inventory', 'books']]], ['Staff', [['staff', 'Staff & payroll', 'staff']]],
  ['Reports', [['reports', 'Business reports', 'reports'], ['statements', 'Financial statements', 'reports'], ['audit', 'Audit trail', 'audit']]],
  ['Admin', [['settings', 'Master lists & rules', 'settings'], ['users', 'Users & roles', 'users'], ['setup', 'Health, backup & setup', 'settings']]]];
const gearBtn = '<button class="btn ic" data-gear title="Supabase connection" aria-label="Supabase connection">⚙</button>';
let recoveryMode = false;
let recoveryInvalid = false;

async function route() {
  const app = $('#app'), r = location.hash.slice(2) || 'dashboard';
  if (recoveryMode || recoveryInvalid) return loginView(app);
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
  const savedEmail = LS.getItem('sl_email') || '';
  app.innerHTML = `<div class="auth-shell">
    <aside class="auth-brand" aria-hidden="true">
      <div><div class="auth-logo">🏫</div><h1>Concept School</h1><p class="auth-sub">Shibra Campus · School Management System</p></div>
      <ul class="auth-points">
        <li><b>Fees &amp; student ledgers</b><span>Vouchers, receipts and parent statements</span></li>
        <li><b>Accounts &amp; financial reports</b><span>Daybook, statements and school finances</span></li>
        <li><b>Book store &amp; payroll</b><span>Stock, salaries and staff records</span></li>
      </ul>
      <p class="auth-foot">Authorised staff only. Actions are recorded in the audit trail.</p>
    </aside>
    <main class="auth-panel">
      <div class="auth-mobile-brand"><div class="auth-logo">🏫</div><div><b>Concept School</b><span>Shibra Campus</span></div></div>
      <form class="auth-form" id="lf" ${recoveryMode ? 'hidden' : ''}>
        <div><h2>Sign in</h2><p>Use the email and password given by the administrator.</p></div>
        <label for="em">Email<input id="em" type="email" autocomplete="username" value="${esc(savedEmail)}" placeholder="name@example.com" required></label>
        <label for="pw">Password</label>
        <div class="password-field"><input id="pw" type="password" autocomplete="current-password" placeholder="Your password" required>
          <button type="button" class="password-toggle" id="pwBtn" aria-label="Show password" aria-pressed="false">Show</button></div>
        <p id="capsWarn" class="caps-warning" hidden>Caps Lock is on.</p>
        <label class="remember-email"><input id="rememberEmail" type="checkbox" checked> Remember my email on this computer</label>
        <p id="le" class="auth-message" role="alert" hidden></p>
        <button class="btn p auth-submit" id="loginBtn" type="submit">Sign in</button>
        <button class="auth-link" id="forgotBtn" type="button">Forgot password? Send a reset link to my email</button>
      </form>
      <form class="auth-form" id="recoveryForm" ${recoveryMode ? '' : 'hidden'}>
        <div><h2>Set a new password</h2><p>Choose a new password for your school account.</p></div>
        ${recoveryInvalid
          ? '<p class="auth-message" role="alert">This reset link is invalid or expired. Request a new link and try again.</p>'
          : `<label for="newPassword">New password<input id="newPassword" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" required></label>
             <label for="confirmPassword">Confirm new password<input id="confirmPassword" type="password" autocomplete="new-password" minlength="8" placeholder="Type it again" required></label>
             <p id="recoveryMsg" class="auth-message" role="status" hidden></p>
             <button class="btn p auth-submit" id="recoveryBtn" type="submit">Save new password</button>`}
        <button class="auth-link" id="cancelRecovery" type="button">Back to sign in</button>
      </form>
      <p class="auth-copy">&copy; ${new Date().getFullYear()} Concept School Shibra Campus</p>
    </main>
    <div class="gear">${gearBtn}</div>
  </div>`;

  const loginForm = $('#lf'), emailInput = $('#em'), passwordInput = $('#pw');
  if (recoveryMode) {
    if (!recoveryInvalid) $('#newPassword').focus();
    else showLoginMessage('This reset link is invalid or expired. Request a new link and try again.', true);
  } else {
    if (savedEmail) passwordInput.focus();
    else emailInput.focus();
  }
  $('#pwBtn').onclick = () => {
    const show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    $('#pwBtn').textContent = show ? 'Hide' : 'Show';
    $('#pwBtn').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    $('#pwBtn').setAttribute('aria-pressed', String(show));
  };
  const caps = event => {
    if (event.getModifierState) $('#capsWarn').hidden = !event.getModifierState('CapsLock');
  };
  ['keydown', 'keyup'].forEach(name => passwordInput.addEventListener(name, caps));
  passwordInput.addEventListener('blur', () => { $('#capsWarn').hidden = true; });
  loginForm.onsubmit = async event => {
    event.preventDefault();
    const button = $('#loginBtn');
    button.disabled = true;
    button.textContent = 'Signing in…';
    showLoginMessage('', false);
    try {
      const email = emailInput.value.trim();
      const session = await auth('token?grant_type=password', { email, password: passwordInput.value });
      if (!session.access_token) throw new Error('The sign-in response did not contain a session.');
      keep(session);
      const user = await loadMe();
      if (!user || user.active === false) {
        S = null;
        LS.removeItem('sl_sess');
        showLoginMessage(user ? 'This account is switched off. Please ask the administrator.' : 'Your account has no role yet. Please ask the administrator.', true);
        return;
      }
      ME = user;
      if ($('#rememberEmail').checked) LS.setItem('sl_email', email);
      else LS.removeItem('sl_email');
      const firstPage = NAV.flatMap(group => group[1]).find(item => can(item[2]) && (!item[3] || flag(item[3])) && PAGES[item[0]]);
      const routeName = firstPage?.[0] || 'dashboard';
      location.hash = `#/${routeName}`;
      await route();
    } catch (error) {
      S = null;
      ME = null;
      LS.removeItem('sl_sess');
      const message = String(error.message || '').toLowerCase();
      showLoginMessage(message.includes('confirm')
        ? 'This account is not confirmed yet. Ask the administrator.'
        : message.includes('invalid') || message.includes('credentials')
          ? 'The email or password is incorrect.'
          : message.includes('app_users') || message.includes('app_roles') || message.includes('relation')
            ? 'The users table is not set up yet. Ask the administrator to configure app access.'
            : 'Could not sign in. Check your connection and try again.', true);
    } finally {
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  };

  $('#forgotBtn').onclick = async () => {
    const email = emailInput.value.trim();
    if (!email) {
      showLoginMessage('Enter your email address first.', true);
      emailInput.focus();
      return;
    }
    if (location.protocol === 'file:') {
      showLoginMessage('Open the school app from its website before requesting a reset link.', true);
      return;
    }
    const button = $('#forgotBtn');
    button.disabled = true;
    button.textContent = 'Sending reset link…';
    showLoginMessage('', false);
    try {
      const c = cfg();
      const redirectTo = `${location.origin}${location.pathname}${location.search}`;
      const response = await fetch(`${c.url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: 'POST',
        headers: { apikey: c.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.msg || result.message || 'Could not send the reset email. Check the Supabase redirect URL settings.');
      }
      showLoginMessage('If this email belongs to an account, a password reset link has been sent. Check your inbox and spam folder.', false, true);
    } catch (error) {
      showLoginMessage(error.message || 'Could not send the reset email. Please try again.', true);
    } finally {
      button.disabled = false;
      button.textContent = 'Forgot password? Send a reset link to my email';
    }
  };

  $('#recoveryForm').onsubmit = async event => {
    event.preventDefault();
    if (recoveryInvalid || !S?.access) return;
    const password = $('#newPassword').value;
    if (password.length < 8) return showRecoveryMessage('Use at least 8 characters.', false);
    if (password !== $('#confirmPassword').value) return showRecoveryMessage('The passwords do not match.', false);
    const button = $('#recoveryBtn');
    button.disabled = true;
    button.textContent = 'Saving password…';
    try {
      const c = cfg();
      const response = await fetch(`${c.url}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          apikey: c.key,
          Authorization: `Bearer ${await token()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.msg || result.message || 'Could not update the password. The reset link may have expired.');
      }
      recoveryMode = false;
      recoveryInvalid = false;
      S = null;
      ME = null;
      LS.removeItem('sl_sess');
      if (location.hash) history.replaceState(null, document.title, location.pathname + location.search);
      loginView(app);
      showLoginMessage('Password updated. Sign in with your new password.', false, true);
      $('#em').focus();
    } catch (error) {
      showRecoveryMessage(error.message || 'Could not update the password. The reset link may have expired.', false);
    } finally {
      if ($('#recoveryBtn')) {
        $('#recoveryBtn').disabled = false;
        $('#recoveryBtn').textContent = 'Save new password';
      }
    }
  };

  $('#cancelRecovery').onclick = () => {
    recoveryMode = false;
    recoveryInvalid = false;
    S = null;
    ME = null;
    LS.removeItem('sl_sess');
    if (location.hash) history.replaceState(null, document.title, location.pathname + location.search);
    loginView(app);
  };
}
function showLoginMessage(message, bad, success = false) {
  const element = $('#le');
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle('is-error', Boolean(bad));
  element.classList.toggle('is-success', Boolean(success));
}
function showRecoveryMessage(message, success) {
  const element = $('#recoveryMsg');
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle('is-success', Boolean(success));
  element.classList.toggle('is-error', !success);
}
function startRecoveryFromHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (params.get('type') !== 'recovery') return;
  recoveryMode = true;
  S = null;
  ME = null;
  LS.removeItem('sl_sess');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken) {
    recoveryInvalid = true;
  } else {
    recoveryInvalid = false;
    keep({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: Number(params.get('expires_in')) || 3600
    });
  }
  history.replaceState(null, document.title, location.pathname + location.search);
}
document.addEventListener('click', e => { if (e.target.closest('[data-gear]')) openCfg(); });
addEventListener('hashchange', route);
let idle; const bump = () => { clearTimeout(idle); if (S) idle = setTimeout(logout, 5 * 60 * 1000); };   // 5-minute idle sign-out, same as the old app
['click', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach(ev => addEventListener(ev, bump, { passive: true }));
startRecoveryFromHash();
bump(); route();
