import { api, all, cfg, flag, $, esc } from '../core.js';
import { iso } from '../util.js';
const TABLES = ['students', 'fees', 'accounts', 'increments', 'books', 'staff', 'payroll', 'staff_attendance', 'call_logs', 'settings', 'app_users', 'app_roles', 'day_close', 'fixed_asset_transactions', 'staff_security_ledger'];
const SQL = [['supabase_admin_preflight.sql', 'Admin preflight (read-only checks)', 'Run first. Only reads the catalog.'], ['supabase_updates.sql', 'General updates', 'Extra columns and small fixes.'], ['supabase_reports_audit.sql', 'Reports and Audit functions', 'Creates app_business_reports and app_audit_events plus the audit triggers.'], ['supabase_staff_attendance.sql', 'Staff attendance', 'Attendance tables and fingerprint-import helpers.'],
  ['supabase_staff_advances.sql', 'Staff advances', 'Advance tracking for payroll.'], ['supabase_staff_increments.sql', 'Staff salary increments', 'Scheduled increment functions.'], ['supabase_performance.sql', 'Performance indexes', 'Safe to run any time; speeds up large tables.']];
export default async function (el) {
  let tab = 'h'; const url = cfg().url;
  el.innerHTML = `<div class="tabs"><button data-t="h" class="on">Health check</button><button data-t="b">Backup</button><button data-t="s">Setup SQL</button></div><div id="bd"></div>`;
  const bd = $('#bd');
  async function health() {
    bd.innerHTML = `<div class="card" style="padding:14px;margin-bottom:12px">Connected to <b>${esc(url)}</b>. Change it with the ⚙ icon.</div><div class="card"><div class="tw" id="hr"><div class="msg">Checking...</div></div></div>`;
    const tRes = await Promise.all(TABLES.map(async t => { try { await api(`${t}?select=*`, { range: [0, 0] }); return [t, 'ok']; } catch (e) { return [t, /permission|denied|401|403/i.test(e.message) ? 'blocked' : /not find|404|does not exist|schema cache/i.test(e.message) ? 'missing' : 'error:' + e.message]; } }));
    const d = iso(new Date()), rpc = [['app_followup_data', 'rpc/app_followup_data', undefined], ['app_business_reports', 'rpc/app_business_reports', { p_from: d, p_to: d }], ['app_audit_events', 'rpc/app_audit_events', { p_from: d, p_to: d, p_table: null, p_operation: null, p_actor: null, p_search: null, p_limit: 1, p_offset: 0 }]];
    const rRes = await Promise.all(rpc.map(async ([n, p, b]) => { try { await api(p, b ? { method: 'POST', body: b } : {}); return [n, 'ok']; } catch (e) { return [n, /not find|404|schema cache/i.test(e.message) ? 'missing' : /permission|denied|403/i.test(e.message) ? 'blocked' : 'error:' + e.message]; } }));
    const tag = s => `<span class="tag ${s === 'ok' ? '' : s === 'blocked' ? 'pt' : 'u'}">${s === 'ok' ? 'OK' : s === 'blocked' ? 'No access for your role' : s === 'missing' ? 'Missing' : esc(s)}</span>`;
    $('#hr').innerHTML = `<table><thead><tr><th>Check</th><th>Result</th></tr></thead><tbody>${tRes.map(([n, s]) => `<tr><td>Table <b>${n}</b></td><td>${tag(s)}</td></tr>`).join('')}${rRes.map(([n, s]) => `<tr><td>Function <b>${n}</b></td><td>${tag(s)}</td></tr>`).join('')}</tbody></table>
      <div class="sub" style="padding:12px 14px">Write-type functions (payroll waivers, staff increments, fixed assets) and the admin-set-user-password Edge Function cannot be tested safely from here. If one of those features fails, re-run the matching SQL from the Setup SQL tab or deploy the function. "Missing" for the follow-up, reports or audit functions means their SQL has not been installed in this project.</div>`;
  }
  function backup() {
    if (!flag('export')) { bd.innerHTML = '<div class="msg">Backup needs the "Download CSV / backup" permission.</div>'; return; }
    bd.innerHTML = `<div class="card" style="padding:14px;display:grid;gap:10px"><b>Download a JSON copy of your data</b><div class="sub" style="padding:0">Pick tables, then download one file. For a full database backup (including logins and policies) use Supabase's own backups or the pg_dump script in tools/.</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px">${TABLES.map(t => `<label style="display:flex;gap:6px;align-items:center;color:inherit;font-size:14px"><input type="checkbox" data-t="${t}" checked> ${t}</label>`).join('')}</div><div><button class="btn p" id="dl">Download backup</button></div><div id="bs" class="sub" style="padding:0"></div></div>`;
    $('#dl').onclick = async () => { const sel = [...bd.querySelectorAll('[data-t]:checked')].map(c => c.dataset.t); if (!sel.length) return; $('#dl').disabled = true; const out = { exported_at: new Date().toISOString(), source: url, tables: {} }, miss = [];
      for (const t of sel) { $('#bs').textContent = `Reading ${t}...`; try { out.tables[t] = await all(`${t}?select=*`, 0); } catch { miss.push(t); } }
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' })); a.download = `shibra-backup-${iso(new Date())}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      $('#bs').textContent = `Downloaded ${Object.keys(out.tables).length} table(s), ${Object.values(out.tables).reduce((s, r) => s + r.length, 0).toLocaleString()} rows.` + (miss.length ? ` Skipped (not available): ${miss.join(', ')}.` : ''); $('#dl').disabled = false; };
  }
  function sql() {
    bd.innerHTML = `<div class="card" style="padding:14px;margin-bottom:12px"><b>Setting up a new Supabase project</b><ol style="margin:8px 0 0;padding-left:20px"><li>Copy your data into the new project (pg_dump / restore, or CSV import).</li><li>Run the SQL below in the new project's SQL Editor, in this order, then check the Health tab.</li><li>Deploy the <code>admin-set-user-password</code> Edge Function (needed only for "Set password").</li><li>Click ⚙, paste the new URL and publishable key, Test, Save.</li></ol>
      <div class="sub" style="padding:8px 0 0">Not included in the original project files, so take them from your original Supabase setup: <code>supabase_roles.sql</code> (users, roles and RLS), <code>supabase_followups_access.sql</code>, <code>supabase_require_previous_day_close.sql</code>. See docs/SUPABASE-FIRST-ADMIN-SETUP.md.</div></div>
      <div class="card"><div class="tw"><table><tbody>${SQL.map(([f, t, n]) => `<tr><td><b>${esc(t)}</b><br><small>${esc(n)} (${f})</small></td><td><button class="btn" data-f="${f}">View</button></td></tr>`).join('')}</tbody></table></div></div><div id="sq"></div>`;
    bd.onclick = async e => { const b = e.target.closest('[data-f]'); if (!b) return; $('#sq').innerHTML = '<div class="msg">Loading...</div>';
      try { const r = await fetch('sql/' + b.dataset.f); if (!r.ok) throw Error('File not found'); const t = await r.text(); $('#sq').innerHTML = `<div class="card" style="padding:12px;margin-top:12px"><div class="bar"><b style="flex:1">${esc(b.dataset.f)}</b><button class="btn p" id="cp">Copy SQL</button></div><textarea readonly style="width:100%;height:320px;font:12px monospace">${esc(t)}</textarea></div>`;
        $('#cp').onclick = async () => { try { await navigator.clipboard.writeText(t); $('#cp').textContent = 'Copied'; } catch { $('#sq textarea').select(); $('#cp').textContent = 'Select and copy'; } }; } catch (x) { $('#sq').innerHTML = `<div class="msg err">${esc(x.message)}</div>`; } };
  }
  const go = { h: health, b: backup, s: sql };
  el.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; el.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b)); bd.onclick = null; go[tab](); });
  health();
}
