import { api, pkr, flag, esc, can } from '../core.js';
import { COLS, classify, wallets } from '../finance-data.js';
import { loadFees, studentDues } from '../fees-data.js';
// Counts use Prefer: count=exact with a 1-row range, so no student data is downloaded for the numbers.
export default async function (el) {
  const t = new Date().toLocaleDateString('en-CA'), m = t.slice(0, 8) + '01', money = flag('money');
  const act = 'or=(status.is.null,status.eq.,status.ilike.active)', one = { count: 1, range: [0, 0] };
  const W = wallets([]), sum = rows => { const e = rows.map(r => classify(r, W)); return [e.filter(x => x.kind === 'receipt').reduce((s, x) => s + x.amount, 0), e.filter(x => x.kind === 'payment').reduce((s, x) => s + x.amount, 0)]; };   // transfers, openings and bills are not income or expense
  const [a, all, mo] = await Promise.all([api('students?select=admis_no&' + act, one), api('students?select=admis_no', one),
    money ? api(`${COLS}&date=gte.${m}`) : null]);
  const k = (l, v, c = '') => `<div class="kpi ${c}"><span>${esc(l)}</span><b>${v}</b></div>`;
  let h = k('Active students', pkr(a.total)) + k('Left / other', pkr(all.total - a.total));
  if (money) { const [ti, to] = sum(mo.rows.filter(r => String(r.date).slice(0, 10) === t)), [mi, mo2] = sum(mo.rows); h += k('Received today', 'PKR ' + pkr(ti)) + k('Paid today', 'PKR ' + pkr(to), 'a') + k('Received this month', 'PKR ' + pkr(mi)) + k('Paid this month', 'PKR ' + pkr(mo2), 'a'); }
  el.innerHTML = `<div class="kpis">${h}</div><div class="card" id="cd"><div class="msg">Loading dues...</div></div>`;
  if (!can('fees')) { document.getElementById('cd').remove(); return; }
  const dues = studentDues(await loadFees()).filter(x => x.bal > 0.004 && x.active === true), by = {};   // active students only, charges up to this month
  dues.forEach(x => { by[x.cls] = (by[x.cls] || 0) + x.bal; });
  const rows = Object.entries(by).sort((a, b) => b[1] - a[1]), max = rows[0] ? rows[0][1] : 1, tot = rows.reduce((a, r) => a + r[1], 0);
  document.getElementById('cd').innerHTML = `<div class="cls"><b>Pending dues of active students, by class: PKR ${pkr(tot)} (${dues.length} students)</b>` + (rows.length ? rows.map(([c, v]) => `<div><div><span>${esc(c)}</span><span>PKR ${pkr(v)}</span></div><i style="width:${Math.max(3, v / max * 100)}%"></i></div>`).join('') : '<span>No pending dues.</span>') + '</div>';
}
