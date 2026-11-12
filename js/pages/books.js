import { all, $, esc, pkr } from '../core.js';
import { span, PERIODS } from '../util.js';
import { loadBooks, stock, dues } from '../books-data.js';
const N = 100, LBL = { sale: 'Sale', purchase: 'Purchase', sale_return: 'Sale return', purchase_return: 'Purchase return' };
export default async function (el) {
  const { rows, acc } = await loadBooks(); let limit = 5;
  try { const s = await all('settings?select=setting_value&setting_key=eq.Low%20Stock%20Limit'); const v = parseInt(s[0] && s[0].setting_value); if (v >= 0) limit = v; } catch { }
  const ST = stock(rows), D = dues(rows, acc); let tab = 'o', pg = 0; const f = { p: 'month', from: '', to: '', t: '', q: '', inv: '', who: 'recv' };
  el.innerHTML = `<div class="tabs"><button data-t="o" class="on">Overview</button><button data-t="i">Inventory</button><button data-t="x">Transactions</button><button data-t="p">Students &amp; vendors</button></div>
  <div class="bar" id="fb"><select id="p" aria-label="Period">${PERIODS}</select><input id="fr" type="date" hidden aria-label="From"><input id="to" type="date" hidden aria-label="To"><select id="t" aria-label="Type"><option value="">All types<option value="sale">Sales<option value="purchase">Purchases<option value="sale_return">Sale returns<option value="purchase_return">Purchase returns</select>
  <select id="iv" aria-label="Stock" hidden><option value="">All stock<option value="low">Low + out of stock<option value="out">Out of stock<option value="in">In stock</select><select id="wh" aria-label="Party type" hidden><option value="recv">Students / customers owe us<option value="pay">We owe vendors</option></select><input id="q" type="search" placeholder="Search" aria-label="Search"></div>
  <div id="kp" class="kpis"></div><div class="card"><div class="tw" id="tb"></div><div class="pager" id="ft"><button class="btn" id="pv">‹ Prev</button><span id="in"></span><button class="btn" id="nx">Next ›</button></div></div>`;
  const rng = () => f.p === 'custom' ? [f.from || '0000-01-01', f.to || '9999-12-31'] : span(f.p), k = (l, v, c = '') => `<div class="kpi ${c}"><span>${esc(l)}</span><b>${v}</b></div>`, tbl = (h, r) => `<table><thead><tr>${h}</tr></thead><tbody>${r}</tbody></table>`;
  function draw() {
    const [a, b] = rng(), q = f.q.toLowerCase(), inR = r => r.date >= a && r.date <= b, tx = rows.filter(r => inR(r)), sum = kd => tx.filter(r => r.kind === kd).reduce((s, r) => s + r.net, 0);
    $('#t').hidden = tab !== 'x'; $('#iv').hidden = tab !== 'i'; $('#wh').hidden = tab !== 'p'; $('#p').hidden = tab === 'i' || tab === 'p';
    $('#fr').hidden = $('#to').hidden = tab === 'i' || tab === 'p' || f.p !== 'custom'; $('#ft').hidden = tab !== 'x'; $('#kp').innerHTML = '';
    if (tab === 'o') {
      const low = ST.filter(s => s.stock <= limit), top = {}; tx.filter(r => r.kind === 'sale').forEach(r => { top[r.title] = (top[r.title] || 0) + r.qty; });
      $('#kp').innerHTML = k('Sales', 'PKR ' + pkr(sum('sale'))) + k('Purchases', 'PKR ' + pkr(sum('purchase')), 'a') + k('Stock value (at cost)', 'PKR ' + pkr(ST.reduce((s, x) => s + x.value, 0))) + k('Low or out of stock', low.length, low.length ? 'a' : '');
      $('#tb').innerHTML = tbl('<th>Low stock (limit ' + limit + ')</th><th class="r">In stock</th>', low.sort((x, y) => x.stock - y.stock).slice(0, 15).map(s => `<tr><td>${esc(s.name)}</td><td class="r">${s.stock}</td></tr>`).join('') || '<tr><td colspan="2">Nothing is running low.</td></tr>')
        + tbl('<th>Top selling in period</th><th class="r">Qty</th>', Object.entries(top).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([n, v]) => `<tr><td>${esc(n)}</td><td class="r">${pkr(v)}</td></tr>`).join('') || '<tr><td colspan="2">No sales in this period.</td></tr>'); return;
    }
    if (tab === 'i') {
      const l = ST.filter(s => (!q || s.name.toLowerCase().includes(q)) && (f.inv === 'out' ? s.stock <= 0 : f.inv === 'low' ? s.stock <= limit : f.inv === 'in' ? s.stock > 0 : true)).sort((x, y) => x.name.localeCompare(y.name));
      $('#tb').innerHTML = tbl('<th>Item</th><th class="r">Purchased</th><th class="r">Sold</th><th class="r">In stock</th><th class="r">Value at cost</th>', l.map(s => `<tr><td>${esc(s.name)}</td><td class="r">${pkr(s.p - s.pr)}</td><td class="r">${pkr(s.s - s.sr)}</td><td class="r"><span class="tag ${s.stock <= 0 ? 'u' : s.stock <= limit ? 'pt' : ''}">${s.stock}</span></td><td class="r">${pkr(s.value)}</td></tr>`).join('') || '<tr><td colspan="5">No items match.</td></tr>'); return;
    }
    if (tab === 'p') {
      const l = D.filter(p => p[f.who].pending > 0.004 && (!q || p.name.toLowerCase().includes(q))).sort((x, y) => y[f.who].pending - x[f.who].pending);
      $('#tb').innerHTML = tbl('<th>Name</th><th class="r">Billed</th><th class="r">Settled</th><th class="r">Pending</th>', l.map(p => `<tr><td>${esc(p.name)}</td><td class="r">${pkr(p[f.who].total)}</td><td class="r">${pkr(p[f.who].settled)}</td><td class="r"><b>${pkr(p[f.who].pending)}</b></td></tr>`).join('') || '<tr><td colspan="4">Nothing pending.</td></tr>');
      $('#kp').innerHTML = k(f.who === 'recv' ? 'Total to collect' : 'Total to pay', 'PKR ' + pkr(l.reduce((s, p) => s + p[f.who].pending, 0)), 'a'); return;
    }
    const l = tx.filter(r => (!f.t || r.kind === f.t) && (!q || (r.title + ' ' + r.party + ' ' + r.voucher).toLowerCase().includes(q))).sort((x, y) => y.date.localeCompare(x.date) || String(y.voucher).localeCompare(String(x.voucher)));
    const max = Math.max(0, Math.ceil(l.length / N) - 1); pg = Math.min(pg, max);
    $('#tb').innerHTML = tbl('<th>Date</th><th>Type</th><th>Item</th><th>Party</th><th class="r">Qty</th><th class="r">Amount</th><th>Voucher</th>', l.slice(pg * N, pg * N + N).map(r => `<tr><td>${esc(r.date)}</td><td><span class="tag ${r.kind.startsWith('purchase') ? 'pt' : ''}">${LBL[r.kind]}</span></td><td>${esc(r.title)}</td><td>${esc(r.party)}</td><td class="r">${r.qty}</td><td class="r">${pkr(r.net)}</td><td>${esc(r.voucher)}</td></tr>`).join('') || '<tr><td colspan="7">No transactions for this period.</td></tr>');
    $('#in').textContent = l.length ? `${pg * N + 1}-${Math.min(l.length, pg * N + N)} of ${l.length}` : '0 transactions'; $('#pv').disabled = pg === 0; $('#nx').disabled = pg >= max;
  }
  $('#p').onchange = e => { f.p = e.target.value; pg = 0; draw(); }; $('#fr').onchange = e => { f.from = e.target.value; draw(); }; $('#to').onchange = e => { f.to = e.target.value; draw(); };
  $('#t').onchange = e => { f.t = e.target.value; pg = 0; draw(); }; $('#iv').onchange = e => { f.inv = e.target.value; draw(); }; $('#wh').onchange = e => { f.who = e.target.value; draw(); };
  let tm; $('#q').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { f.q = e.target.value; pg = 0; draw(); }, 250); };
  $('#pv').onclick = () => { pg--; draw(); }; $('#nx').onclick = () => { pg++; draw(); };
  el.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; pg = 0; el.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  draw();
}
