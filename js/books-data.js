// Book Store logic ported from the old app (normBookRow, stock valuation, computeDues). The books table's columns vary between setups, so we detect them once.
import { api, all } from './core.js';
const KNOWN = ['id', 'type', 'tx_type', 'party', 'party_name', 'vendor', 'book', 'book_title', 'title', 'qty', 'net_amount', 'amount', 'date', 'voucher_no', 'notes'];
export const partyKey = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const SALE_HEAD = 'Book Store Sale', BUY_HEAD = 'Books Purchase';
function normParty(v) {
  const p = String(v || '').trim().replace(/\s+/g, ' '); if (!/^purchase\s*:/i.test(p)) return p;
  const d = p.replace(/^purchase\s*:\s*/i, '').trim(), i = d.lastIndexOf(' - '); return i >= 0 ? d.slice(i + 3).trim() : d;
}
function normRow(r) {
  const t = String(r.type ?? r.tx_type ?? '').trim().toLowerCase(), kind = t.includes('return') ? (t.includes('sale') ? 'sale_return' : 'purchase_return') : (t.includes('sale') ? 'sale' : 'purchase');
  const raw = r.party_name ?? r.party ?? r.vendor ?? '', alt = String(r.party ?? r.vendor ?? '').trim();
  return { id: r.id, kind, party: normParty(/^purchase\s*:/i.test(String(raw)) && alt && !/^purchase\s*:/i.test(alt) ? alt : raw), net: parseFloat(r.net_amount ?? r.amount) || 0, voucher: String(r.voucher_no ?? '').trim(),
    notes: String(r.notes ?? '').trim(), date: String(r.date ?? '').slice(0, 10), title: String(r.book ?? r.book_title ?? r.title ?? '').trim(), qty: parseFloat(r.qty) || 0 };
}
export async function loadBooks() {
  const probe = await api('books?select=*', { range: [0, 0] }), cols = Object.keys(probe.rows[0] || {}), use = KNOWN.filter(c => cols.includes(c));
  const rows = use.length ? (await all('books?select=' + use.join(','))).map(normRow) : [];
  const enc = encodeURIComponent('(voucher_id.like.AR-*,voucher_id.like.AP-*,voucher_id.like.BK-*,voucher_id.like.RV-*,voucher_id.like.PV-*)');
  const acc = await all('accounts?select=voucher_id,from_account,to_account,description,amount_in,amount_out,date,remarks&or=' + enc);
  return { rows, acc };
}
export function stock(rows) {   // per title: stock = purchased - purchase returns - sold + sale returns; value at average purchase cost
  const m = {};
  rows.forEach(r => { const k = r.title.replace(/\s+/g, ' ').toLowerCase(); if (!k) return; const it = m[k] || (m[k] = { name: r.title, p: 0, pr: 0, s: 0, sr: 0, pAmt: 0, prAmt: 0, sAmt: 0 });
    if (r.kind === 'purchase') { it.p += r.qty; it.pAmt += r.net; } else if (r.kind === 'purchase_return') { it.pr += r.qty; it.prAmt += r.net; } else if (r.kind === 'sale') { it.s += r.qty; it.sAmt += r.net; } else it.sr += r.qty; });
  return Object.values(m).map(it => { const q = it.p - it.pr, cost = q > 0 ? Math.max(0, (it.pAmt - it.prAmt) / q) : 0; it.stock = it.p - it.pr - it.s + it.sr; it.value = Math.max(it.stock, 0) * cost; return it; });
}
export function dues(txs, acc) {   // same engine as the Accounts ledger, so Books and Accounts agree
  const P = {}, bills = {}, get = n => { const k = partyKey(n); return P[k] || (P[k] = { key: k, name: String(n).trim(), recvE: [], payE: [], recvS: [], payS: [] }); };
  txs.forEach(t => { if (!t.party) return; const v = t.voucher.toUpperCase(); if (!v || v.startsWith('RV-') || v.startsWith('PV-') || v.startsWith('BK-IMP') || /^imported/i.test(t.notes)) return; const p = get(t.party);
    if (t.kind === 'sale' || t.kind === 'purchase') { const e = { date: t.date, amt: t.net, voucher: t.voucher, paid: 0, pk: p.key, side: t.kind === 'sale' ? 'recv' : 'pay' }; (t.kind === 'sale' ? p.recvE : p.payE).push(e); bills[v] = e; }
    else if (t.kind === 'sale_return') p.recvS.push({ date: t.date, amt: t.net, pool: true }); else if (t.kind === 'purchase_return') p.payS.push({ date: t.date, amt: t.net, pool: true }); });
  acc.forEach(r => { const v = String(r.voucher_id || '').trim().toUpperCase(), m = v.match(/^(AR|AP)-\d+$/); if (!m || !r.description) return; const recv = m[1] === 'AR', amt = parseFloat(recv ? r.amount_in : r.amount_out) || 0; if (amt <= 0) return;
    const p = get(normParty(r.description)), e = { date: String(r.date || '').slice(0, 10), amt, voucher: v, paid: 0, pk: p.key, side: recv ? 'recv' : 'pay' }; (recv ? p.recvE : p.payE).push(e); bills[v] = e; });
  acc.forEach(r => { const vid = String(r.voucher_id || '').trim(), up = vid.toUpperCase(), d = String(r.date || '').slice(0, 10), inA = parseFloat(r.amount_in) || 0, outA = parseFloat(r.amount_out) || 0, ref = up.match(/^((?:AR|AP|BK)-\d+)-/);
    if (ref) { const b = bills[ref[1]]; if (!b) return; const amt = b.side === 'recv' ? inA : outA; if (amt <= 0) return; b.paid += amt; P[b.pk][b.side === 'recv' ? 'recvS' : 'payS'].push({ date: d, amt }); return; }
    if (up.startsWith('RV-') && partyKey(r.from_account) === partyKey(SALE_HEAD) && inA > 0) get(normParty(r.description)).recvS.push({ date: d, amt: inA, pool: true });
    else if (up.startsWith('PV-') && partyKey(r.to_account) === partyKey(BUY_HEAD) && outA > 0) get(normParty(r.description)).payS.push({ date: d, amt: outA, pool: true }); });
  const r2 = n => Math.round(n * 100) / 100, side = (E, S) => { const pool0 = S.filter(x => x.pool).reduce((t, x) => t + x.amt, 0); const total = E.reduce((t, e) => t + e.amt, 0), settled = S.reduce((t, x) => t + x.amt, 0); return { total: r2(total), settled: r2(settled), pending: r2(total - settled), pool0 }; };
  return Object.values(P).filter(p => p.recvE.length || p.payE.length || p.recvS.length || p.payS.length).map(p => ({ name: p.name, recv: side(p.recvE, p.recvS), pay: side(p.payE, p.payS) }));
}
