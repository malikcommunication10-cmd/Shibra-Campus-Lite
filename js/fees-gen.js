// Voucher generation rules ported from the old Fees and Students pages: same eligibility, increments, arrears and duplicate checks.
import { all } from './core.js';
import { MONTHS, effectiveMonth, parseSchoolYear, tuitionFeeForPeriod } from './fee-rules.js';
export { MONTHS };
const ARREARS_MONTH = 'January', ARREARS_YEAR = 2025, tc = t => String(t).replace(/\b\w/g, c => c.toUpperCase());
export { tc };
export async function schoolYear() {
  const settings = await all('settings?select=setting_key,setting_value');
  return parseSchoolYear(settings);
}
const dojV = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})/); return m ? (+m[1]) * 12 + (+m[2]) : null; };
export function eligibility(st, year, mi) {   // 'ok' | 'nodoj' | 'nolf' (left, but no left date) | 'out' (before joining or after leaving)
  const sv = dojV(st.doj); if (sv === null) return 'nodoj'; const pv = year * 12 + mi; if (pv < sv) return 'out';
  const s = String(st.status || '').trim().toLowerCase(); if (s && s !== 'active') { const m = String(st.left_date || '').match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return 'nolf'; if (pv > (+m[1]) * 12 + (+m[2]) - (+m[3] > 15 ? 0 : 1)) return 'out'; }
  return 'ok';
}
const norm = s => String(s ?? '').trim().toLowerCase();
export async function loadExisting() { return all('fees?select=voucher_id,admis_no,student_name,period,type'); }
export async function loadIncrements() { const m = {}; (await all('increments?select=*')).forEach(i => { m[norm(i.admis_no)] = i; }); return m; }
// Returns {out: rows to insert, miss: students without DOJ, nolf: left students without left date, arrearsSkipped}
export function plan({ students, periods, year, existing, incs, today, extra = {} }) {
  const used = new Set(), keys = new Set(), aAdm = new Set(), aName = new Set(), vmap = new Map(), out = [], miss = {}, nolf = {}; let skipped = 0;
  existing.forEach(f => { const m = String(f.voucher_id || '').match(/^V-(\d+)/i); if (m) used.add(+m[1]); const a = norm(f.admis_no), n = norm(f.student_name), p = String(f.period || '').trim(), t = norm(f.type);
    if (a) keys.add(`${a}_${p}_${t}`); if (n) keys.add(`${n}_${p}_${t}`); if (t === 'arrears') { if (a) aAdm.add(a); if (n) aName.add(n); }
    const k = `${a.replace(/^0+/, '')}_${p}`; if (!vmap.has(k)) vmap.set(k, String(f.voucher_id || '').trim()); });
  const nextId = () => { let n; do { n = Math.floor(100000 + Math.random() * 900000); } while (used.has(n)); used.add(n); return 'V-' + n; };
  const add = (st, adm, sn, period, type, payable, remarks, arr) => {
    if (!(Number(payable) > 0.004)) return;
    if (type === 'arrears' && (aAdm.has(adm) || aName.has(sn))) { skipped++; return; } const k1 = `${adm}_${period}_${type}`, k2 = `${sn}_${period}_${type}`; if (keys.has(k1) || keys.has(k2)) return;
    const vk = `${adm.replace(/^0+/, '')}_${period}`; let v = vmap.get(vk); if (!v) { v = nextId(); vmap.set(vk, v); }
    out.push({ sr_no: st.sr_no || '', voucher_id: v, admis_no: st.admis_no || '', student_name: st.student_name || '', type, period, payable, class: st.class || '', status: 'Unpaid', date: today, remarks, ...extra.cols(st, arr) });
    keys.add(k1); keys.add(k2); if (type === 'arrears') { if (adm) aAdm.add(adm); if (sn) aName.add(sn); } };
  periods.forEach(mi => { const period = `${MONTHS[mi - 1]} ${year}`; students.forEach(st => {
    const adm = norm(st.admis_no || st.sr_no), sn = norm(st.student_name), key = st.admis_no || st.student_name, el = eligibility(st, year, mi);
    if (el === 'nodoj') { miss[key] = st; return; } if (el === 'nolf') { nolf[key] = st; return; } if (el !== 'ok') return;
    const inc = incs[norm(st.admis_no)], em = inc ? effectiveMonth(inc.effective_period, year) : 0;
    let tp = tuitionFeeForPeriod(st.monthly_tution_fee, inc, mi, year), rm = '';
    if (inc) {
      if (inc.remarks) rm = inc.remarks;
    }
    add(st, adm, sn, period, 'tuition fee', tp, rm, null);
    if (MONTHS[mi - 1] === ARREARS_MONTH) { const a = parseFloat(st.arrears2025) || 0; if (a > 0) add(st, adm, sn, period, 'arrears', a, `${ARREARS_YEAR} arrears (one-time carry-forward)`, String(a)); }
    if (inc && parseFloat(inc.annual_fund) > 0 && norm(inc.fee_type) === 'annual fund' && em > 0 && mi === em) add(st, adm, sn, period, 'annual fund', parseFloat(inc.annual_fund), inc.remarks || '', null); }); });
  return { out, miss: Object.values(miss), nolf: Object.values(nolf), skipped };
}
export async function insertRows(api, rows) { for (let i = 0; i < rows.length; i += 500) await api('fees', { method: 'POST', body: rows.slice(i, i + 500) }); }
