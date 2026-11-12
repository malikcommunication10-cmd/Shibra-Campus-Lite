import { api, flag, $, esc } from '../core.js';
import { span, PERIODS, csv } from '../util.js';
const N = 50, TABLES = ['students', 'fees', 'accounts', 'increments', 'books', 'staff', 'payroll', 'staff_attendance', 'call_logs', 'settings', 'app_users', 'app_roles', 'day_close'];
export default async function (el) {
  let pg = 0, total = 0, ev = [], seq = 0, tm;
  el.innerHTML = `<div class="bar"><select id="p" aria-label="Period">${PERIODS}</select><input id="fr" type="date" hidden aria-label="From"><input id="to" type="date" hidden aria-label="To">
  <select id="tb" aria-label="Table"><option value="">All tables${TABLES.map(t => `<option value="public.${t}">${t}`).join('')}</select><select id="op" aria-label="Operation"><option value="">All operations<option>INSERT<option>UPDATE<option>DELETE</select>
  <input id="ac" placeholder="Actor email" aria-label="Actor"><input id="q" type="search" placeholder="Search" aria-label="Search">${flag('export') ? '<button class="btn" id="ex">Export page</button>' : ''}</div>
  <div class="card"><div class="tw" id="bd"></div><div class="pager"><button class="btn" id="pv">‹ Prev</button><span id="in"></span><button class="btn" id="nx">Next ›</button></div></div>`;
  const rng = () => $('#p').value === 'custom' ? [$('#fr').value, $('#to').value] : span($('#p').value);
  async function load() {
    const [from, to] = rng(), id = ++seq; if (!from || !to || from > to) { $('#bd').innerHTML = '<div class="msg err">Choose a valid range: From must be on or before To.</div>'; return; }
    $('#bd').innerHTML = '<div class="msg">Loading...</div>';
    try {
      const { rows: r } = await api('rpc/app_audit_events', { method: 'POST', body: { p_from: from, p_to: to, p_table: $('#tb').value || null, p_operation: $('#op').value || null, p_actor: $('#ac').value.trim() || null, p_search: $('#q').value.trim() || null, p_limit: N, p_offset: pg * N } });
      if (id !== seq) return; if (!r || !Array.isArray(r.events)) throw Error('The audit service returned an unexpected response.'); ev = r.events; total = +r.total || 0;
      $('#bd').innerHTML = ev.length ? `<table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Table</th><th>Row</th><th>Changes</th></tr></thead><tbody>${ev.map(e => `<tr><td>${esc(new Date(e.occurred_at).toLocaleString())}</td><td>${esc(e.actor_email || 'Unattributed')}</td>
        <td><span class="tag ${e.operation === 'DELETE' ? 'u' : e.operation === 'UPDATE' ? 'pt' : ''}">${esc(e.operation)}</span></td><td>${esc(e.table_name)}</td><td>${esc(e.row_key || '—')}</td><td class="w"><details><summary>Show changed fields</summary><pre>${esc(JSON.stringify(e.changes || {}, null, 2))}</pre></details></td></tr>`).join('')}</tbody></table>` : '<div class="msg">No audit events match these filters.</div>';
      $('#in').textContent = `${total.toLocaleString()} event(s) · page ${pg + 1}`; $('#pv').disabled = pg === 0; $('#nx').disabled = (pg + 1) * N >= total;
    } catch (e) { if (id === seq) $('#bd').innerHTML = `<div class="msg err">Could not load audit events: ${esc(e.message)}</div>`; }
  }
  const soon = () => { clearTimeout(tm); tm = setTimeout(() => { pg = 0; load(); }, 300); };
  $('#p').onchange = e => { $('#fr').hidden = $('#to').hidden = e.target.value !== 'custom'; if (e.target.value !== 'custom') soon(); };
  ['fr', 'to', 'tb', 'op'].forEach(i => $('#' + i).onchange = soon); ['ac', 'q'].forEach(i => $('#' + i).oninput = soon);
  $('#pv').onclick = () => { pg--; load(); }; $('#nx').onclick = () => { pg++; load(); };
  if ($('#ex')) $('#ex').onclick = () => csv(`audit_${rng().join('_')}_page${pg + 1}`, ['occurred_at', 'actor_email', 'operation', 'table_name', 'row_key', 'changes'], ev.map(e => [e.occurred_at, e.actor_email, e.operation, e.table_name, e.row_key, JSON.stringify(e.changes || {})]));
  load();
}
