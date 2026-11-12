import { api, all, bust, can, ask, $, esc, pkr } from '../core.js';
import { loadFees, vouchers, studentDues } from '../fees-data.js';
import { printChallan } from '../challan.js';
import { MONTHS, schoolYear, plan, loadExisting, loadIncrements, insertRows } from '../fees-gen.js';
import { iso } from '../util.js';
const N = 50, tc = t => String(t || '').replace(/\b\w/g, c => c.toUpperCase());
const label = g => g.types.length > 1 ? `Admission voucher (${g.types.map(tc).join(' + ')}) - ${g.student}` : `${g.types[0]} (${g.period}) - ${g.student}`;
export default async function (el) {
  let D, V, SD, tab = 'v', pg = 0, f = { q: '', c: '', p: '', s: '' };
  const load = async () => { D = await loadFees(); V = vouchers(D); SD = studentDues(D); };
  await load();
  const opts = (a, all) => `<option value="">${all}` + [...new Set(a)].filter(Boolean).sort().map(x => `<option>${esc(x)}`).join('');
  el.innerHTML = `<div class="tabs"><button data-t="v" class="on">Vouchers</button><button data-t="s">Student dues</button></div>
  <div class="bar"><input id="q" type="search" placeholder="Search name, admission no or voucher" aria-label="Search"><select id="c" aria-label="Class">${opts(V.map(v => v.cls), 'All classes')}</select>
  <select id="p" aria-label="Period">${opts(V.map(v => v.period), 'All periods')}</select><select id="s" aria-label="Status"><option value="">All status<option>Unpaid<option>Partial<option>Paid</select>${can('fees', 'a') ? '<button class="btn p" id="gn">Generate vouchers</button>' : ''}</div>
  <div class="card"><div class="tw" id="t"></div><div class="pager"><button class="btn" id="pv">‹ Prev</button><span id="in"></span><button class="btn" id="nx">Next ›</button></div></div>`;
  function draw() {
    const q = f.q.toLowerCase(), hit = x => (!f.c || x.cls === f.c) && (!q || [x.student, x.name, x.adm, x.id].some(v => String(v || '').toLowerCase().includes(q)));
    let rows, head, line;
    if (tab === 'v') {
      rows = V.filter(x => hit(x) && (!f.p || x.period === f.p) && (!f.s || x.st === f.s)).sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
      head = '<th>Voucher</th><th>Student</th><th>Class</th><th>Period</th><th class="r">Net</th><th class="r">Paid</th><th class="r">Due</th><th>Status</th><th></th>';
      line = x => `<tr><td>${esc(x.id)}</td><td>${esc(x.student)}<br><small>${esc(x.adm)}</small></td><td>${esc(x.cls)}</td><td>${esc(x.period)}</td><td class="r">${pkr(x.net)}</td><td class="r">${pkr(x.paid)}</td><td class="r">${pkr(x.due)}</td>
      <td><span class="tag ${x.st === 'Paid' ? '' : x.st === 'Partial' ? 'pt' : 'u'}">${x.st}</span></td><td><button class="btn" data-pr="${esc(x.id)}" aria-label="Print challan">Print</button> ${x.due > 0.004 && can('fees', 'a') ? `<button class="btn" data-pay="${esc(x.id)}">Receive</button>` : ''} ${moreSel(x)}</td></tr>`;
    } else {
      rows = SD.filter(x => x.bal > 0.004 && x.active !== false && hit(x)).sort((a, b) => b.bal - a.bal);
      head = '<th>Adm no</th><th>Student</th><th>Class</th><th class="r">Charged</th><th class="r">Paid</th><th class="r">Balance</th><th></th>';
      line = x => `<tr><td>${esc(x.adm)}</td><td>${esc(x.name)}</td><td>${esc(x.cls)}</td><td class="r">${pkr(x.charge)}</td><td class="r">${pkr(x.paid)}</td><td class="r"><b>${pkr(x.bal)}</b></td><td>${can('fees', 'a') ? `<button class="btn" data-sp="${esc(x.adm)}|${esc(x.name)}">Receive</button>` : ''}</td></tr>`;
    }
    const tot = rows.length, max = Math.max(0, Math.ceil(tot / N) - 1); pg = Math.min(pg, max);
    $('#t').innerHTML = tot ? `<table><thead><tr>${head}</tr></thead><tbody>${rows.slice(pg * N, pg * N + N).map(line).join('')}</tbody></table>` : '<div class="msg">Nothing matches. Clear a filter or the search.</div>';
    $('#in').textContent = tot ? `${pg * N + 1}-${Math.min(tot, pg * N + N)} of ${tot}` + (tab === 's' ? ` · total PKR ${pkr(rows.reduce((a, x) => a + x.bal, 0))}` : '') : '0 results';
    $('#pv').disabled = pg === 0; $('#nx').disabled = pg >= max;
  }
  let timer; $('#q').oninput = e => { clearTimeout(timer); timer = setTimeout(() => { f.q = e.target.value; pg = 0; draw(); }, 250); };
  ['c', 'p', 's'].forEach(k => $('#' + k).onchange = e => { f[k] = e.target.value; pg = 0; draw(); });
  $('#pv').onclick = () => { pg--; draw(); }; $('#nx').onclick = () => { pg++; draw(); };
  el.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; pg = 0; el.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b)); $('#p').hidden = $('#s').hidden = tab === 's'; draw(); });
  $('#t').onclick = e => { const b = e.target.closest('[data-pay]'), p = e.target.closest('[data-pr]'), sp = e.target.closest('[data-sp]'); if (b) receive(V.find(x => x.id === b.dataset.pay)); else if (p) printChallan([V.find(x => x.id === p.dataset.pr)]); else if (sp) { const [a, n] = sp.dataset.sp.split('|'); studentPay(a, n); } };
  $('#t').onchange = e => { const s = e.target.closest('[data-more]'); if (!s || !s.value) return; const g = V.find(x => x.id === s.dataset.more), a = s.value; s.value = ''; if (a === 'disc') discount(g); else if (a === 'item') addItem(g); else if (a === 'del') del(g); else if (a === 'stu') studentPay(g.adm, g.student); };

  async function receive(g) {   // saves one fee receipt exactly like the old Fee Vouchers page: an Accounts row with voucher_id "<voucher>-<timestamp>"
    let accts = ['cash']; try { accts = accts.concat((await all('settings?select=setting_value&setting_key=eq.Payment%20Account')).map(r => String(r.setting_value || '').trim()).filter(Boolean)); } catch { }
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<form class="box"><h2>Receive fee: ${esc(g.student)}</h2><small>${esc(g.id)} · ${esc(g.period)} · due PKR ${pkr(g.due)}</small>
    <label>Amount (PKR)<input id="am" type="number" min="1" step="any" max="${g.due}" value="${g.due}" required></label>
    <label>Deposit to<select id="ac">${[...new Set(accts)].map(a => `<option value="${esc(a)}">${esc(a === 'cash' ? 'Cash in Hand' : a)}`).join('')}</select></label>
    <label>Date<input id="dt" type="date" value="${new Date().toLocaleDateString('en-CA')}" required></label><label>Remarks<input id="rm" value="Fee received"></label>
    <div id="er" class="err"></div><div class="row"><button type="button" class="btn" id="x">Cancel</button><button class="btn p">Save receipt</button></div></form>`;
    document.body.appendChild(m); $('#x', m).onclick = () => m.remove();
    $('form', m).onsubmit = async e => {
      e.preventDefault(); const amt = parseFloat($('#am', m).value), b = $('.p', m);
      if (!(amt > 0) || amt > g.due + 0.004) return $('#er', m).textContent = 'Enter an amount between 1 and the amount due.';
      b.disabled = true; const rm = $('#rm', m).value.trim() || 'Fee received';
      try {
        await api('accounts', { method: 'POST', body: { voucher_id: `${g.id}-${Date.now()}`, from_account: label(g), to_account: $('#ac', m).value, description: rm, amount_in: amt, amount_out: 0, date: $('#dt', m).value, remarks: rm } });
        m.remove(); bust(); await load(); draw();
      } catch (x) { $('#er', m).textContent = x.message; b.disabled = false; }
    };
  }
  const enc = encodeURIComponent, fm = n => (+n || 0).toLocaleString('en-US'), refresh = async () => { bust(); await load(); draw(); };
  const moreSel = x => { const o = [can('fees', 'e') ? '<option value="disc">Edit discount' : '', can('fees', 'a') ? '<option value="item">Add item<option value="stu">Receive for student (oldest first)' : '', can('fees', 'd') && x.paid <= 0.004 ? '<option value="del">Delete voucher' : ''].join(''); return o ? `<select data-more="${esc(x.id)}" aria-label="More actions"><option value="">More…${o}</select>` : ''; };
  const rowFilter = r => r.id != null ? `id=eq.${enc(r.id)}` : `voucher_id=eq.${enc(r.voucher_id)}&type=eq.${enc(r.type)}`, vrows = async id => (await api('fees?select=*&voucher_id=eq.' + enc(id))).rows;
  const sheet = (html, init) => { const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<form class="box" style="max-width:520px;max-height:92vh;overflow:auto">${html}</form>`; document.body.appendChild(m); init(m, s => $(s, m)); };
  const payAccts = async () => { let a = ['cash']; try { a = a.concat((await all('settings?select=setting_value&setting_key=eq.Payment%20Account')).map(r => String(r.setting_value || '').trim()).filter(Boolean)); } catch { } return [...new Set(a)].map(x => `<option value="${esc(x)}">${esc(x === 'cash' ? 'Cash in Hand' : x)}`).join(''); };
  async function discount(g) {
    const rows = await vrows(g.id); if (!rows.length) return;
    sheet(`<h2>Edit discount</h2><div>${esc(g.student)} · ${esc(g.period)}</div><label>Fee item<select id="it">${rows.map((r, i) => `<option value="${i}">${esc(tc(r.type || 'tuition fee'))}: PKR ${fm(r.payable)}`).join('')}</select></label><label>Discount (PKR)<input id="am" type="number" min="0" step="any"></label><label>Reason (required when discount > 0)<input id="rs"></label><div id="er" class="err"></div><div class="row"><button type="button" class="btn" id="x">Cancel</button><button class="btn p">Save discount</button></div>`, (m, q) => {
      const pick = () => { const r = rows[+q('#it').value], d = String(r.remarks || '').split(' | ').find(x => x.startsWith('Discount ')); q('#am').value = r.discount || ''; q('#rs').value = d ? d.replace(/^Discount [^:]*: /, '') : ''; }; q('#it').onchange = pick; pick(); q('#x').onclick = () => m.remove();
      q('form').onsubmit = async e => { e.preventDefault(); const r = rows[+q('#it').value], amt = parseFloat(q('#am').value) || 0, rs = q('#rs').value.trim(), pay = parseFloat(r.payable) || 0; if (amt < 0 || amt > pay) return q('#er').textContent = 'The discount must be between 0 and the payable amount.'; if (amt > 0 && !rs) return q('#er').textContent = 'Please give a reason for the discount.';
        const parts = String(r.remarks || '').split(' | ').filter(x => x && !x.startsWith('Discount ')); if (amt > 0) parts.push(`Discount ${amt}: ${rs}`);
        try { await api('fees?' + rowFilter(r), { method: 'PATCH', body: { discount: amt, remarks: parts.join(' | ') } }); m.remove(); await refresh(); } catch (x) { q('#er').textContent = x.message; } }; });
  }
  async function addItem(g) {
    const rows = await vrows(g.id), f = rows[0]; if (!f) return;
    sheet(`<h2>Add fee item</h2><div>${esc(g.student)} · ${esc(g.period)} · ${esc(g.id)}</div><small>Already in this voucher: ${esc(rows.map(r => `${tc(r.type || 'tuition fee')} ${fm((parseFloat(r.payable) || 0) - (parseFloat(r.discount) || 0))}`).join(', '))}</small><label>Fee name<input id="ty" list="tl" placeholder="e.g. exam fee" required><datalist id="tl"><option value="tuition fee"><option value="annual fund"><option value="registration fee"><option value="admission fee"><option value="arrears"><option value="exam fee"></datalist></label>
      <label>Amount (PKR)<input id="am" type="number" min="1" step="any" required></label><label>Discount (PKR)<input id="di" type="number" min="0" step="any"></label><label>Remarks<input id="rm"></label><div id="er" class="err"></div><div class="row"><button type="button" class="btn" id="x">Cancel</button><button class="btn p">Add item</button></div>`, (m, q) => {
      q('#x').onclick = () => m.remove(); q('form').onsubmit = async e => { e.preventDefault(); const type = q('#ty').value.trim().toLowerCase().replace(/\s+/g, ' '), amt = parseFloat(q('#am').value) || 0, di = Math.min(parseFloat(q('#di').value) || 0, amt), rm = q('#rm').value.trim(), er = t => { q('#er').textContent = t; };
        if (!type) return er('Please enter the fee name.'); if (amt <= 0) return er('Enter an amount greater than 0.'); if (rows.some(r => String(r.type || '').trim().toLowerCase() === type)) return er(`This voucher already has "${type}". Edit its discount, or use a different name.`); if (di > 0 && !rm) return er('Remarks are required when a discount is given.');
        if (g.st === 'Paid' && !await ask(`Voucher ${g.id} is fully paid. Adding this item makes it partly unpaid again. Continue?`)) return;
        const row = { sr_no: f.sr_no || '', voucher_id: g.id, admis_no: f.admis_no || '', student_name: f.student_name || '', type, period: f.period, payable: amt, discount: di, class: f.class || '', status: 'Unpaid', date: iso(new Date()), remarks: di > 0 ? `Discount ${di}: ${rm}` : rm }; if ('siblings' in f) row.siblings = f.siblings;
        try { await api('fees', { method: 'POST', body: row }); m.remove(); await refresh(); } catch (x) { er(x.message); } }; });
  }
  async function del(g) {
    if (g.paid > 0.004) return alert('This voucher has payments in Accounts. Delete the payment from Finance first.'); if (!await ask(`Delete voucher ${g.id} (${g.student}, ${g.period})? This cannot be undone.`)) return;
    try { await api('fees?voucher_id=eq.' + enc(g.id), { method: 'DELETE' }); await refresh(); } catch (x) { alert('Could not delete: ' + x.message); }
  }
  async function studentPay(adm, name) {   // all dues up to this month, oldest first; any extra becomes an advance on the next upcoming voucher
    const a = String(adm || '').trim().toLowerCase(), n = String(name || '').trim().toLowerCase(), ym = iso(new Date()).slice(0, 7), key = g => g.items.every(i => String(i.type).toLowerCase() === 'arrears') ? '0000-00' : String(g.start || '9999-99').slice(0, 7);
    const G = V.filter(v => a ? String(v.adm).trim().toLowerCase() === a : String(v.student).trim().toLowerCase() === n).sort((x, y) => key(x).localeCompare(key(y)) || x.id.localeCompare(y.id, undefined, { numeric: true }));
    const dueAll = G.filter(g => key(g) <= ym), due = dueAll.filter(g => g.due > 0.5), future = G.filter(g => key(g) > ym && g.due > 0.5), total = Math.round(due.reduce((s, g) => s + g.due, 0) * 100) / 100, accts = await payAccts();
    if (!G.length) return alert('No vouchers found for this student.');
    const mk = amt => { const out = []; let left = Math.round(amt * 100) / 100; for (const g of due) { if (left <= 0.004) break; const x = Math.round(Math.min(left, g.due) * 100) / 100; if (x > 0) { out.push({ g, amt: x, adv: false }); left = Math.round((left - x) * 100) / 100; } }
      let lost = 0; if (left > 0.004) { const t = future[0] || dueAll[dueAll.length - 1]; if (t) out.push({ g: t, amt: left, adv: true }); else lost = left; } return { out, lost }; };
    sheet(`<h2>Receive from ${esc(name)}</h2><div class="tw" style="max-height:180px"><table><tbody>${due.map(g => `<tr><td>${esc(g.period)}</td><td>${esc(g.id)}</td><td class="r">${fm(g.due)}</td></tr>`).join('') || '<tr><td>No dues up to this month.</td></tr>'}</tbody></table></div><div><b>Total due up to this month: PKR ${fm(total)}</b></div>
      <label>Amount received (PKR)<input id="am" type="number" min="1" step="any" value="${total > 0 ? total : ''}" required></label><label>Deposit to<select id="ac">${accts}</select></label><label>Date<input id="dt" type="date" value="${iso(new Date())}" required></label><label>Remarks<input id="rm" value="Bulk payment via FIFO"></label><div id="pv2" class="sub" style="padding:0"></div><div id="er" class="err"></div><div class="row"><button type="button" class="btn" id="x">Cancel</button><button class="btn p">Receive payment</button></div>`, (m, q) => {
      const show = () => { const amt = parseFloat(q('#am').value) || 0, r = mk(amt); q('#pv2').innerHTML = amt > 0 ? r.out.map(p => `${p.adv ? '➕ Advance → ' : '✔ '}${esc(p.g.period)} ${esc(p.g.id)}: <b>PKR ${fm(p.amt)}</b>`).join('<br>') + (r.lost ? `<br><span class="err">PKR ${fm(r.lost)} cannot be placed: no voucher.</span>` : '') : 'Enter the amount to see how it is applied.'; };
      q('#am').oninput = show; show(); q('#x').onclick = () => m.remove();
      q('form').onsubmit = async e => { e.preventDefault(); const amt = parseFloat(q('#am').value) || 0, r = mk(amt); if (amt <= 0 || !r.out.length || r.lost) return q('#er').textContent = 'No voucher found to apply this payment.'; const rm = q('#rm').value.trim() || 'Bulk payment via FIFO', nonce = Date.now(); q('.p').disabled = true;
        try { await api('accounts', { method: 'POST', body: r.out.map(p => ({ voucher_id: `${p.g.id}-${nonce}-${p.adv ? 'adv' : Math.floor(Math.random() * 1000)}`, from_account: label(p.g), to_account: q('#ac').value, description: p.adv ? rm + ' (Advance)' : rm, amount_in: p.amt, amount_out: 0, date: q('#dt').value, remarks: p.adv ? rm + ' (Advance)' : rm })) }); m.remove(); await refresh(); } catch (x) { q('#er').textContent = x.message; q('.p').disabled = false; } }; });
  }
  async function generate() {   // bulk monthly vouchers: same eligibility, increment, arrears and duplicate rules as the old Fees page
    const year = await schoolYear(), sp = (await api('students?select=*', { range: [0, 0] })).rows[0] || {}, fp = (await api('fees?select=*', { range: [0, 0] })).rows[0] || {};
    const want = ['admis_no', 'sr_no', 'student_name', 'class', 'status', 'doj', 'left_date', 'monthly_tution_fee', 'siblings', 'arrears2025'].filter(c => c in sp), [stu, existing, incs] = await Promise.all([all('students?select=' + want.join(','), 0), loadExisting(), loadIncrements()]);
    const classes = [...new Set(stu.map(s => String(s.class || '').trim()).filter(Boolean))].sort(), m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<form class="box"><h2>Generate fee vouchers</h2><label>Period<select id="gp">${MONTHS.map((x, i) => `<option value="${i + 1}">${x} ${year}</option>`).join('')}<option value="0">Whole year ${year}</option></select></label><label>Class<select id="gc"><option value="">All classes${classes.map(c => `<option>${esc(c)}`).join('')}</select></label>
    <div id="gs" class="sub" style="padding:0"></div><div id="er" class="err"></div><div class="row"><button type="button" class="btn" id="x">Cancel</button><button class="btn p" id="go">Create vouchers</button></div></form>`; document.body.appendChild(m); $('#gp', m).value = String(new Date().getMonth() + 1);
    const cols = (st, arr) => { const o = {}; if ('siblings' in fp) o.siblings = st.siblings ?? null; if ('arrears2025' in fp) o.arrears2025 = arr; return o; };
    let P; const calc = () => { const c = $('#gc', m).value, mo = +$('#gp', m).value; P = plan({ students: c ? stu.filter(s => String(s.class || '').trim() === c) : stu, periods: mo ? [mo] : MONTHS.map((_, i) => i + 1), year, existing, incs, today: iso(new Date()), extra: { cols } });
      const total = P.out.reduce((s, x) => s + (x.payable || 0), 0), ids = new Set(P.out.map(x => x.voucher_id)).size; $('#gs', m).innerHTML = P.out.length ? `${P.out.length} new fee item(s) in ${ids} voucher(s), total PKR ${fmt(total)}.` : 'Nothing to create: vouchers already exist for this selection.'
        + (P.miss.length ? `<br>${P.miss.length} student(s) skipped: no date of joining.` : '') + (P.nolf.length ? `<br>${P.nolf.length} left student(s) skipped: no left date.` : '') + (P.skipped ? `<br>${P.skipped} arrears item(s) skipped: arrears voucher already exists.` : ''); $('#go', m).disabled = !P.out.length; };
    const fmt = n => (+n || 0).toLocaleString('en-US'); $('#gp', m).onchange = $('#gc', m).onchange = calc; calc(); $('#x', m).onclick = () => m.remove();
    $('form', m).onsubmit = async e => { e.preventDefault(); $('#go', m).disabled = true; try { await insertRows(api, P.out); m.remove(); bust(); await load(); draw(); } catch (x) { $('#er', m).textContent = /23505|fees_pkey/.test(x.message) ? 'The fees table still has voucher_id as its primary key. Run the fees update SQL (see Admin: Setup SQL).' : x.message; $('#go', m).disabled = false; } };
  }
  if ($('#gn')) $('#gn').onclick = generate;
  draw();
}
