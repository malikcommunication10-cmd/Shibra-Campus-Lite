import { api, flag, $, esc } from '../core.js';
import { span, PERIODS, fmt, csv } from '../util.js';
// All totals are computed on the server by the app_business_reports function, so only a small summary is downloaded.
export default async function (el) {
  let data = null, seq = 0;
  el.innerHTML = `<div class="bar"><select id="p" aria-label="Period">${PERIODS}</select><input id="fr" type="date" hidden aria-label="From"><input id="to" type="date" hidden aria-label="To"><button class="btn p" id="go">Show report</button>${flag('export') ? '<button class="btn" id="ex">Export CSV</button>' : ''}</div><div id="sm" class="sub"></div><div id="kp" class="kpis"></div><div id="bd" class="cols"></div>`;
  const k = (l, v, n = '', c = '') => `<div class="kpi ${c}"><span>${esc(l)}</span><b>${esc(v)}</b><span>${esc(n)}</span></div>`;
  const t = (title, head, rows, total) => `<div class="card"><h3 class="t">${esc(title)}</h3><div class="tw"><table><thead><tr>${head.map((h, i) => `<th class="${i ? 'r' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? 'r' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}">No data for this period.</td></tr>`}${total ? `<tr class="tot">${total.map((c, i) => `<td class="${i ? 'r' : ''}">${esc(c)}</td>`).join('')}</tr>` : ''}</tbody></table></div></div>`;
  const rng = () => $('#p').value === 'custom' ? [$('#fr').value, $('#to').value] : span($('#p').value);
  async function load() {
    const [from, to] = rng(), id = ++seq; if (!from || !to || from > to) { $('#sm').textContent = 'Choose a valid range: From must be on or before To.'; return; }
    $('#go').disabled = true; $('#sm').textContent = 'Loading...';
    try {
      const { rows: d } = await api('rpc/app_business_reports', { method: 'POST', body: { p_from: from, p_to: to } }); if (id !== seq) return;
      if (!d || !d.students || !d.fees) throw Error('The report service returned an unexpected response.'); data = d; draw(d);
    } catch (e) { if (id === seq) $('#sm').innerHTML = `<span class="err">Could not load reports: ${esc(e.message)}</span>`; } finally { if (id === seq) $('#go').disabled = false; }
  }
  function draw(d) {
    const st = d.students, fe = d.fees, ac = d.accounts || {}, sf = d.staff || {}, fu = d.followups || {}, bill = +fe.payable || 0, got = +fe.collected_to_selected_vouchers || 0, ft = Array.isArray(fe.by_type) ? fe.by_type : [];
    $('#sm').textContent = `Activity from ${d.from} through ${d.to}`;
    $('#kp').innerHTML = k('Students enrolled', fmt(st.total), `${fmt(st.active)} active`) + k('Staff', fmt(sf.total), `${fmt(sf.active)} active`) + k('Fees billed (net)', 'Rs ' + fmt(bill), `Discounts Rs ${fmt(fe.discounts)}`) + k('Fees collected', 'Rs ' + fmt(got), bill > 0 ? `Collection rate ${Math.round(got / bill * 100)}%` : '') +
      k('Fees pending (estimate)', 'Rs ' + fmt(fe.estimated_outstanding), 'Billed minus collected', 'a') + k('Money received', 'Rs ' + fmt(ac.money_in), `${fmt(ac.entries)} entries`) + k('Money paid out', 'Rs ' + fmt(ac.money_out), '', 'a') + k('Payroll paid', 'Rs ' + fmt(sf.payroll_paid), `Unpaid Rs ${fmt(sf.payroll_unpaid)}`) + k('Follow-up calls', fmt(fu.calls), `Promised Rs ${fmt(fu.promised_amount)}`);
    const sum = (a, f) => a.reduce((s, r) => s + (+r[f] || 0), 0), by = st.by_class || [];
    $('#bd').innerHTML = t('Students by class', ['Class', 'Enrolled', 'Left', 'Active'], by.map(r => [r.label, fmt(r.count), fmt(r.left_count), fmt(r.net_count)]), ['Total', fmt(st.total), fmt(st.left), fmt(st.active)])
      + t('Fees by type', ['Type', 'Records', 'Gross', 'Discount', 'Net'], ft.map(r => [r.label, fmt(r.count), fmt(r.payable), fmt(r.discount), fmt(r.net_payable)]), ['Total', fmt(sum(ft, 'count')), fmt(sum(ft, 'payable')), fmt(sum(ft, 'discount')), fmt(sum(ft, 'net_payable'))])
      + t('Tuition fee amounts', ['Monthly fee', 'Students'], (st.by_tuition_fee || []).map(r => ['Rs ' + fmt(r.label), fmt(r.count)]), ['Average', 'Rs ' + fmt(st.average_tuition_fee)])
      + t('Money by account head', ['Head', 'Money in', 'Money out'], (ac.by_account || []).map(r => [r.label, fmt(r.money_in), fmt(r.money_out)]))
      + t('Staff attendance', ['Status', 'Count'], (sf.attendance || []).map(r => [r.label, fmt(r.count)])) + t('Follow-up outcomes', ['Outcome', 'Count'], (fu.by_outcome || []).map(r => [r.label, fmt(r.count)]))
      + `<div class="card sub">Books: ${fmt(d.books && d.books.records)} records · ${fmt(d.books && d.books.transactions)} transactions in period · ${fmt(d.books && d.books.units)} units<br>Increments: ${fmt(d.increments && d.increments.records)} records · Rs ${fmt(d.increments && d.increments.amount)} in period</div>`;
  }
  $('#p').onchange = e => { $('#fr').hidden = $('#to').hidden = e.target.value !== 'custom'; if (e.target.value !== 'custom') load(); };
  $('#go').onclick = load; $('#fr').onchange = $('#to').onchange = () => { if ($('#fr').value && $('#to').value) load(); };
  if ($('#ex')) $('#ex').onclick = () => { if (!data) return; const rows = [];
    ['students', 'fees', 'accounts', 'books', 'staff', 'followups', 'increments'].forEach(sec => Object.entries(data[sec] || {}).forEach(([key, v]) => { if (Array.isArray(v)) v.forEach(r => rows.push([data.from, data.to, sec + ':' + key, r.label || 'Unspecified', JSON.stringify(r)])); else if (v === null || typeof v !== 'object') rows.push([data.from, data.to, sec, key, v]); }));
    csv(`school_reports_${data.from}_${data.to}`, ['period_from', 'period_to', 'section', 'label', 'value'], rows); };
  load();
}
