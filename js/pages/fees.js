import { api, all, bust, can, $, esc, pkr } from '../core.js';
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
      <td><span class="tag ${x.st === 'Paid' ? '' : x.st === 'Partial' ? 'pt' : 'u'}">${x.st}</span></td><td><button class="btn" data-pr="${esc(x.id)}" aria-label="Print challan">Print</button> ${x.due > 0.004 && can('fees', 'a') ? `<button class="btn" data-pay="${esc(x.id)}">Receive</button>` : ''}</td></tr>`;
    } else {
      rows = SD.filter(x => x.bal > 0.004 && x.active !== false && hit(x)).sort((a, b) => b.bal - a.bal);
      head = '<th>Adm no</th><th>Student</th><th>Class</th><th class="r">Charged</th><th class="r">Paid</th><th class="r">Balance</th>';
      line = x => `<tr><td>${esc(x.adm)}</td><td>${esc(x.name)}</td><td>${esc(x.cls)}</td><td class="r">${pkr(x.charge)}</td><td class="r">${pkr(x.paid)}</td><td class="r"><b>${pkr(x.bal)}</b></td></tr>`;
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
  $('#t').onclick = e => { const b = e.target.closest('[data-pay]'), p = e.target.closest('[data-pr]'); if (b) receive(V.find(x => x.id === b.dataset.pay)); else if (p) printChallan([V.find(x => x.id === p.dataset.pr)]); };

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
