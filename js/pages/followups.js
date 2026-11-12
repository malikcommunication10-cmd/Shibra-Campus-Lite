import { api, all, bust, can, me, ask, $, esc } from '../core.js';
import { fmt, iso } from '../util.js';
// Follow-up calls: families (siblings share a family code), pending dues oldest-first, call history and promises. Data comes from the restricted app_followup_data function.
const OUT = { promised: 'Spoke – promise taken', callback: 'Asked to call back later', no_answer: 'Did not answer', off_wrong: 'Phone off / wrong number', refused: 'Refused / raised an issue', paid: 'Payment received', other: 'Other' };
const ST = { overdue: ['Overdue promise', 'u', 0], today: ['Promise today', 'pt', 1], new: ['Not called yet', '', 2], nopromise: ['No promise', 'pt', 3], upcoming: ['Promise upcoming', '', 4], clear: ['Clear', '', 5] };
const MON = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'], N = 50;
const rankP = p => { p = String(p || '').trim().toLowerCase(); if (p.includes('arrear')) return -1; const a = p.split(/\s+/), m = MON.indexOf(a[0]); return m < 0 ? 9999999 : (parseInt(a[1]) || 0) * 12 + m; };
const ckey = (adm, name) => { adm = String(adm || '').trim().toLowerCase(); return adm ? 'a:' + adm : 'n:' + String(name || '').trim().toLowerCase(); };
const digits = v => String(v || '').replace(/\D/g, ''), wa = v => { const d = digits(v); return d.startsWith('92') ? d : d.startsWith('0') ? '92' + d.slice(1) : '92' + d; };
export default async function (el) {
  const { rows: D } = await api('rpc/app_followup_data').catch(e => { throw Error(/404/.test(e.message) ? 'Restricted Follow-up access is not installed. Ask the administrator to run supabase_followups_access.sql.' : e.message); });
  if (!D || !Array.isArray(D.students) || !Array.isArray(D.fees) || !Array.isArray(D.accounts)) throw Error('Follow-up access is not set up. Ask the administrator to run supabase_followups_access.sql, then refresh.');
  let logs = [], noLogs = false, FAM = [], FM = {}, pg = 0; const f = { q: '', c: '', s: '', pend: true }, today = iso(new Date()), nowR = new Date().getFullYear() * 12 + new Date().getMonth();
  const loadLogs = async () => { try { logs = await all('call_logs?select=id,family_key,call_date,outcome,spoke_with,promise_date,promise_amount,remarks,pending_at_call,caller', 0); noLogs = false; } catch { logs = []; noLogs = true; } };
  const paidBy = {}; D.accounts.forEach(r => { const k = String(r.voucher_id || '').trim().split('-').slice(0, 2).join('-'); if (k) paidBy[k] = (paidBy[k] || 0) + (parseFloat(r.amount_in) || 0); });
  function build() {
    const kids = {}, add = (k, b) => kids[k] || (kids[k] = { key: k, adm: '', name: '', cls: '', sib: '', contacts: [], parent: '', v: new Map(), future: 0, inS: false, status: '', ...b });
    D.students.forEach(s => { const c = [], seen = new Set(); let parent = ''; Object.entries(s).forEach(([k, v]) => { const t = String(v ?? '').trim(); if (!t) return;
      if (/phone|mobile|contact|whatsapp|cell|\btel\b/i.test(k)) { const d = digits(t); if (d.length >= 7 && !seen.has(d)) { seen.add(d); c.push({ label: k.replace(/_/g, ' '), number: t }); } } else if (/father|guardian|parent/i.test(k) && !parent && /[^\d\s]/.test(t)) parent = t; });
      add(ckey(s.admis_no, s.student_name), { adm: s.admis_no || '', name: s.student_name || '', cls: s.class || '', inS: true, status: String(s.status || ''), sib: String(s.siblings ?? '').trim(), contacts: c, parent }); });
    D.fees.forEach(r => { const ch = add(ckey(r.admis_no, r.student_name), { adm: r.admis_no || '', name: r.student_name || '', cls: r.class || '', sib: String(r.siblings ?? '').trim() }), vid = String(r.voucher_id || '').trim(), pay = (parseFloat(r.payable) || 0) - (parseFloat(r.discount) || 0), rk = rankP(r.period);
      const v = ch.v.get(vid) || { period: r.period, pay: 0, paid: paidBy[vid] || 0, fut: rk > 0 && rk !== 9999999 && rk > nowR }; v.pay += pay; ch.v.set(vid, v); });
    Object.values(kids).forEach(ch => { let pool = 0, due = 0; const vs = [...ch.v.values()].sort((a, b) => rankP(a.period) - rankP(b.period)); vs.forEach(v => { pool += v.paid; if (!v.fut) due += v.pay; });
      ch.net = Math.round((due - pool) * 100) / 100; let left = pool; ch.rows = vs.filter(v => !v.fut).map(v => { const use = Math.min(Math.max(left, 0), Math.max(v.pay, 0)); left -= use; return { period: v.period, pay: v.pay, bal: Math.round((v.pay - use) * 100) / 100 }; }); });
    const fams = {}; Object.values(kids).forEach(ch => { const n = ch.sib.replace(/\s+/g, '').toLowerCase(), k = n ? 'fam:' + n : 'solo:' + ch.key; const fm = fams[k] || (fams[k] = { key: k, label: n ? ch.sib : '', kids: [], pending: 0, contacts: [], parent: '', logs: [] });
      fm.kids.push(ch); fm.pending += ch.net; if (!fm.parent && ch.parent) fm.parent = ch.parent; ch.contacts.forEach(c => { if (!fm.contacts.some(x => digits(x.number) === digits(c.number))) fm.contacts.push(c); }); });
    logs.forEach(l => { if (fams[l.family_key]) fams[l.family_key].logs.push(l); });
    FAM = Object.values(fams).map(fm => { fm.logs.sort((a, b) => new Date(b.call_date) - new Date(a.call_date)); fm.last = fm.logs[0] || null; fm.promise = fm.last && fm.last.promise_date ? String(fm.last.promise_date).slice(0, 10) : ''; fm.pending = Math.round(fm.pending * 100) / 100;
      fm.st = fm.pending <= 0 ? 'clear' : !fm.last ? 'new' : !fm.promise ? 'nopromise' : fm.promise > today ? 'upcoming' : fm.promise === today ? 'today' : 'overdue';
      fm.title = fm.label ? 'Family ' + fm.label : 'Individual'; fm.names = fm.kids.map(k => k.name).sort().join(', '); fm.cls = [...new Set(fm.kids.map(k => k.cls))]; return fm; });
    FM = {}; FAM.forEach(x => { FM[x.key] = x; });
  }
  await loadLogs(); build();
  const classes = [...new Set(D.students.map(s => s.class).filter(Boolean))].sort();
  el.innerHTML = `${noLogs ? '<div class="card msg err">The call history table is not available. Ask the administrator to run supabase_followups_access.sql.</div>' : ''}<div id="kp" class="kpis"></div>
  <div class="bar"><input id="q" type="search" placeholder="Search student, family or phone" aria-label="Search"><select id="c" aria-label="Class"><option value="">All classes${classes.map(c => `<option>${esc(c)}`).join('')}</select>
  <select id="s" aria-label="Status"><option value="">All status${Object.entries(ST).map(([k, v]) => `<option value="${k}">${v[0]}`).join('')}</select><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pe" checked> Pending only</label></div>
  <div class="card"><div class="tw" id="tb"></div><div class="pager"><button class="btn" id="pv">‹ Prev</button><span id="in"></span><button class="btn" id="nx">Next ›</button></div></div>`;
  function draw() {
    const q = f.q.toLowerCase(), qd = digits(f.q), act = FAM.filter(x => x.pending > 0.004);
    $('#kp').innerHTML = [['Families with dues', act.length, ''], ['Total pending', 'PKR ' + fmt(act.reduce((s, x) => s + x.pending, 0)), 'a'], ['Overdue promises', act.filter(x => x.st === 'overdue').length, 'a'], ['Promises today', act.filter(x => x.st === 'today').length, ''], ['Not called yet', act.filter(x => x.st === 'new').length, '']].map(([l, v, c]) => `<div class="kpi ${c}"><span>${l}</span><b>${v}</b></div>`).join('');
    const l = FAM.filter(x => (!f.pend || x.pending > 0.004) && (!f.s || x.st === f.s) && (!f.c || x.cls.includes(f.c)) && (!q || x.names.toLowerCase().includes(q) || x.title.toLowerCase().includes(q) || (qd.length > 3 && x.contacts.some(c => digits(c.number).includes(qd))))).sort((a, b) => ST[a.st][2] - ST[b.st][2] || b.pending - a.pending);
    const max = Math.max(0, Math.ceil(l.length / N) - 1); pg = Math.min(pg, max);
    $('#tb').innerHTML = l.length ? `<table><thead><tr><th>Family / students</th><th>Class</th><th class="r">Pending</th><th>Last call</th><th>Promise</th><th>Status</th><th></th></tr></thead><tbody>${l.slice(pg * N, pg * N + N).map(x => `<tr><td><b>${esc(x.title)}</b><br><small>${esc(x.names)}</small></td><td>${esc(x.cls.join(', '))}</td><td class="r"><b>${fmt(x.pending)}</b></td>
      <td>${x.last ? esc(OUT[x.last.outcome] || x.last.outcome) + '<br><small>' + esc(String(x.last.call_date).slice(0, 10)) + '</small>' : '—'}</td><td>${esc(x.promise || '—')}</td><td><span class="tag ${ST[x.st][1]}">${ST[x.st][0]}</span></td><td><button class="btn" data-o="${esc(x.key)}">Open</button></td></tr>`).join('')}</tbody></table>` : '<div class="msg">No families match. Clear a filter or untick "Pending only".</div>';
    $('#in').textContent = l.length ? `${pg * N + 1}-${Math.min(l.length, pg * N + N)} of ${l.length}` : '0 families'; $('#pv').disabled = pg === 0; $('#nx').disabled = pg >= max;
  }
  function open(key) {
    const x = FM[key]; if (!x) return; const m = document.createElement('div'); m.className = 'modal'; const canLog = can('followups', 'a');
    m.innerHTML = `<div class="box" style="max-width:680px;max-height:92vh;overflow:auto"><h2>${esc(x.title)}: PKR ${fmt(x.pending)} pending</h2><div>${esc(x.parent ? 'Parent: ' + x.parent : '')}</div>
    <div>${x.contacts.map(c => `<a class="btn" href="tel:${esc(digits(c.number))}">📞 ${esc(c.number)}</a> <a class="btn" target="_blank" rel="noopener" href="https://wa.me/${wa(c.number)}">WhatsApp</a> <small>${esc(c.label)}</small><br>`).join('') || '<small>No phone number on file.</small>'}</div>
    ${x.kids.map(k => `<div class="card"><div class="sub"><b>${esc(k.name)}</b> · ${esc(k.cls)} · ${esc(k.adm)} · pending PKR ${fmt(k.net)}</div><div class="tw"><table><tbody>${k.rows.filter(r => r.bal > 0.004).map(r => `<tr><td>${esc(r.period)}</td><td class="r">${fmt(r.pay)}</td><td class="r"><b>${fmt(r.bal)}</b></td></tr>`).join('') || '<tr><td>No unpaid months</td></tr>'}</tbody></table></div></div>`).join('')}
    ${canLog && !noLogs ? `<form id="lf" style="display:grid;gap:8px"><b>Log a call</b><select id="oc">${Object.entries(OUT).map(([k, v]) => `<option value="${k}">${v}`).join('')}</select><input id="sw" placeholder="Spoke with"><div class="bar" style="margin:0"><input id="pd" type="date" aria-label="Promise date"><input id="pa" type="number" min="0" step="any" placeholder="Promise amount"></div>
      <input id="rm" placeholder="Remarks"><input id="cl" placeholder="Your name" value="${esc(localStorage.getItem('caller_name') || me().name || '')}"><div id="er" class="err"></div><button class="btn p">Save call</button></form>` : ''}
    <div class="card"><div class="sub"><b>Call history</b></div><div class="tw"><table><tbody>${x.logs.map(l => `<tr><td>${esc(String(l.call_date).slice(0, 10))}</td><td>${esc(OUT[l.outcome] || l.outcome)}</td><td class="w">${esc(l.remarks || '')}${l.promise_date ? '<br><small>Promise ' + esc(String(l.promise_date).slice(0, 10)) + (l.promise_amount ? ' · PKR ' + fmt(l.promise_amount) : '') + '</small>' : ''}<br><small>${esc(l.caller || '')}</small></td><td>${can('followups', 'd') ? `<button class="btn" data-d="${esc(l.id)}" aria-label="Delete call">✕</button>` : ''}</td></tr>`).join('') || '<tr><td>No calls logged yet.</td></tr>'}</tbody></table></div></div>
    <div class="row"><button class="btn" id="x">Close</button></div></div>`;
    document.body.appendChild(m); $('#x', m).onclick = () => m.remove();
    const again = async () => { bust(); await loadLogs(); build(); m.remove(); draw(); open(key); };
    m.onclick = async e => { const b = e.target.closest('[data-d]'); if (!b || !await ask('Delete this call record permanently?')) return; try { await api('call_logs?id=eq.' + encodeURIComponent(b.dataset.d), { method: 'DELETE' }); again(); } catch (z) { alert(z.message); } };
    if ($('#lf', m)) $('#lf', m).onsubmit = async e => { e.preventDefault(); const g = id => $('#' + id, m).value.trim(), oc = g('oc'), pd = g('pd'), er = t => { $('#er', m).textContent = t; };
      if ((oc === 'promised' || oc === 'callback') && !pd) return er('A promise / call-back date is required for this outcome.'); if (oc === 'other' && !g('rm') && !pd) return er('Enter remarks or a promise date.');
      if (g('cl')) localStorage.setItem('caller_name', g('cl')); $('.p', m).disabled = true;
      try { await api('call_logs', { method: 'POST', body: { family_key: x.key, family_label: x.title, children: x.kids.map(k => `${k.name} (${k.cls || '-'})`).join(', '), student_keys: x.kids.map(k => k.key), call_date: new Date().toISOString(), outcome: oc, spoke_with: g('sw') || null, promise_date: pd || null, promise_amount: g('pa') ? parseFloat(g('pa')) : null, remarks: g('rm') || null, pending_at_call: x.pending, caller: g('cl') || null } }); again(); }
      catch (z) { er('Could not save: ' + z.message); $('.p', m).disabled = false; } };
  }
  let tm; $('#q').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { f.q = e.target.value; pg = 0; draw(); }, 250); };
  $('#c').onchange = e => { f.c = e.target.value; pg = 0; draw(); }; $('#s').onchange = e => { f.s = e.target.value; pg = 0; draw(); }; $('#pe').onchange = e => { f.pend = e.target.checked; pg = 0; draw(); };
  $('#pv').onclick = () => { pg--; draw(); }; $('#nx').onclick = () => { pg++; draw(); }; $('#tb').onclick = e => { const b = e.target.closest('[data-o]'); if (b) open(b.dataset.o); };
  draw();
}
