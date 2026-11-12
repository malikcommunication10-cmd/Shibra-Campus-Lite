// Fee logic ported from the old app (buildFeeVouchers + dashboard dues). Same rules, narrow columns only.
import { all } from './core.js';
const MON = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export const rank = p => { const a = String(p || '').trim().toLowerCase().split(/\s+/), m = MON.indexOf(a[0]); return m < 0 ? null : (parseInt(a[1]) || 0) * 12 + m; };
export const curRank = () => { const d = new Date(); return d.getFullYear() * 12 + d.getMonth(); };
export async function loadFees() {
  const [fees, acc, stu] = await Promise.all([all('fees?select=admis_no,student_name,class,voucher_id,period,type,payable,discount'),
    all('accounts?select=voucher_id,amount_in&voucher_id=like.V-*'), all('students?select=admis_no,student_name,status')]);
  const paid = {};
  acc.forEach(r => { const id = String(r.voucher_id || '').trim(); if (!/^V-\d+/i.test(id)) return; const k = id.split('-').slice(0, 2).join('-'); paid[k] = (paid[k] || 0) + (parseFloat(r.amount_in) || 0); });
  return { fees, paid, stu };
}
export function vouchers({ fees, paid }) {
  const map = new Map();
  fees.forEach(f => {
    const id = String(f.voucher_id || '').trim(); if (!id) return;
    const g = map.get(id) || { id, adm: String(f.admis_no || '').trim(), student: f.student_name || '', cls: f.class || '', period: f.period || '', types: [], net: 0 };
    g.net += (parseFloat(f.payable) || 0) - (parseFloat(f.discount) || 0); g.types.push(f.type || 'Tuition Fee'); (g.items = g.items || []).push({ type: f.type || 'tuition fee', payable: parseFloat(f.payable) || 0, discount: parseFloat(f.discount) || 0 }); map.set(id, g);
  });
  return [...map.values()].map(g => { g.paid = Math.round((paid[g.id] || 0) * 100) / 100; g.due = Math.round((g.net - g.paid) * 100) / 100; const r = rank(g.period); g.start = r === null ? '' : `${Math.floor(r / 12)}-${String(r % 12 + 1).padStart(2, '0')}-01`; g.st = g.due <= 0.004 ? 'Paid' : g.paid > 0 ? 'Partial' : 'Unpaid'; return g; });
}
// Per student: all charges up to this month minus ALL payments (same as the old dashboard).
export function studentDues({ fees, paid, stu }) {
  const cur = curRank(), st = new Map(), nm = new Map(), norm = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  stu.forEach(s => { const t = String(s.status || '').trim().toLowerCase(), on = !t || t === 'active'; if (s.admis_no) st.set(norm(s.admis_no), on); if (s.student_name) nm.set(norm(s.student_name), on); });
  const agg = {};
  fees.forEach(f => {
    const k = norm(f.admis_no || f.student_name), v = String(f.voucher_id || '').trim();
    const x = agg[k] || (agg[k] = { adm: f.admis_no || '', name: f.student_name || '', cls: String(f.class || '-').trim() || '-', charge: 0, paid: 0, seen: new Set(), a: norm(f.admis_no), n: norm(f.student_name) });
    if (!x.seen.has(v)) { x.seen.add(v); x.paid += paid[v] || 0; }
    const r = rank(f.period); if (r !== null && r > cur) return;
    x.charge += (parseFloat(f.payable) || 0) - (parseFloat(f.discount) || 0);
  });
  return Object.values(agg).map(x => ({ ...x, bal: Math.round((x.charge - x.paid) * 100) / 100, active: x.a && st.has(x.a) ? st.get(x.a) : x.n && nm.has(x.n) ? nm.get(x.n) : null }));
}
