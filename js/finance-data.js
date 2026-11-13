// Accounts logic ported from the old app: voucher prefixes decide what a row is and how it moves an account balance.
import { all } from './core.js';
export const COLS = 'accounts?select=id,voucher_id,from_account,to_account,description,amount_in,amount_out,date,remarks';
const INCOME = ['Admission / Registration Fee', 'Annual Fund', 'Book Store Sale', 'Uniform / Stationery Sale', 'Transport Fee', 'Donation', 'Other Income'];
const EXPENSE = ['Salaries', 'Utility Bills', 'Rent', 'Stationery', 'Repair & Maintenance', 'Fuel / Transport', 'Events / Functions', 'Books Purchase', 'Printing', 'Internet / Phone', 'Refreshments', 'Misc Expense'];
export async function lists() {
  const k = encodeURIComponent('("Payment Account","Income Head","Expense Head","Business Partner")'), out = { pay: [], inc: [], exp: [], partners: [] };
  try { (await all('settings?select=setting_key,setting_value&setting_key=in.' + k)).forEach(r => { const v = String(r.setting_value || '').trim(); if (!v) return;
    ({ 'Payment Account': out.pay, 'Income Head': out.inc, 'Expense Head': out.exp, 'Business Partner': out.partners })[r.setting_key]?.push(v); }); } catch { }
  if (!out.inc.length) out.inc = INCOME; if (!out.exp.length) out.exp = EXPENSE; return out;
}
export function wallets(items) {
  const W = { cash: { label: 'Cash in Hand' } };
  (items.length ? items : ['Bank', 'Online / JazzCash']).forEach(t => { const s = t.toLowerCase(), k = s === 'bank' ? 'bank' : /^online(\s*\/\s*jazz\s*cash)?$/.test(s) ? 'online' : t;
    if (!W[k]) W[k] = { label: k === 'bank' ? 'Bank' : k === 'online' ? 'Online / JazzCash' : t }; });
  return W;
}
const norm = (v, W) => { const raw = String(v || '').trim(), low = raw.toLowerCase(); for (const k in W) if (k.toLowerCase() === low || W[k].label.toLowerCase() === low) return k;
  if (/bank/.test(low)) return 'bank'; if (/online|jazz|easy|wallet|raast/.test(low)) return 'online'; return 'cash'; };
export function classify(r, W) {
  const id = String(r.voucher_id || '').trim(), up = id.toUpperCase(), from = String(r.from_account || '').trim(), to = String(r.to_account || '').trim();
  const inA = parseFloat(r.amount_in) || 0, outA = parseFloat(r.amount_out) || 0, desc = String(r.description || '').trim();
  const e = { id, sequence: r.id == null ? null : Number(r.id), date: String(r.date || '').slice(0, 10), notes: String(r.remarks || '').trim(), title: desc, wallet: 'cash', wallet2: null, amount: inA || outA, head: '', kind: 'receipt', manual: true, fee: false, pd: false, flag: '' };
  const fix = (kind, wallet, amount, head, flag = '') => Object.assign(e, { kind, wallet, amount, head, flag });
  if (/^(AR|AP)-\d+$/.test(up)) fix(up[1] === 'R' ? 'bill_raised' : 'bill_received', 'cash', inA || outA, up[1] === 'R' ? 'Accounts Receivable' : 'Accounts Payable');
  else if (/^(AR|AP|BK)-\d+-/.test(up)) { const isIn = inA > 0; fix(isIn ? 'receipt' : 'payment', norm(isIn ? to : from, W), inA || outA, isIn ? 'Accounts Receivable' : 'Accounts Payable'); }
  else if (up.startsWith('TV-')) { fix('transfer', norm(from, W), inA || outA, 'Transfer'); e.wallet2 = norm(to, W); }
  else if (up.startsWith('OB-')) fix('opening', norm(to, W), inA || outA, 'Opening Balance');
  else if (up.startsWith('FA-P-')) fix('payment', norm(from, W), outA, 'Fixed asset purchase', 'asset');
  else if (up.startsWith('FA-S-')) fix('receipt', norm(to, W), inA, 'Fixed asset sale', 'asset');
  else if (up.startsWith('PD-')) { fix('payment', norm(from, W), outA || inA, 'Partner withdrawal', 'partner'); e.pd = true; }
  else if (up.startsWith('PV-')) fix('payment', norm(from, W), outA || inA, to || 'Misc Expense', /^staff security payable$/i.test(to) ? 'security' : /^partner drawings$/i.test(to) ? 'partner' : '');
  else if (up.startsWith('RV-')) fix('receipt', norm(to, W), inA || outA, from || 'Other Income');
  else if (/^(cash receipt|cash payment|salary payment)$/i.test(from)) { const rec = inA > 0 && outA === 0; fix(rec ? 'receipt' : 'payment', norm(r.remarks, W), rec ? inA : outA, /salary/i.test(from) ? 'Salaries' : rec ? 'Other Income' : 'Misc Expense'); e.title = desc || to; e.notes = ''; }
  else if (outA > 0 && inA === 0) fix('payment', norm(from, W), outA, to || desc || 'Misc Expense', /^partner drawings$/i.test(to) ? 'partner' : '');
  else { fix('receipt', norm(to, W), inA, from || 'Receipt'); if (/^V-\d+/i.test(id)) { e.fee = true; e.flag = 'fee'; const m = from.match(/^(.*?)\s*\(/); e.head = 'Fee – ' + (m ? m[1] : from); e.manual = false; } }
  if (/^(ADV|SEC)-/.test(up)) e.manual = false;
  return e;
}
export const delta = (e, w) => e.kind === 'receipt' || e.kind === 'opening' ? (e.wallet === w ? e.amount : 0) : e.kind === 'payment' ? (e.wallet === w ? -e.amount : 0)
  : e.kind === 'transfer' ? (e.wallet === w ? -e.amount : 0) + (e.wallet2 === w ? e.amount : 0) : 0;
