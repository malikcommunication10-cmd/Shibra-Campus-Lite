import { all, api, bust, can, me, ask, $, esc, pkr } from '../core.js';
import { iso, span, PERIODS } from '../util.js';
import { COLS, lists, wallets, classify, delta } from '../finance-data.js';
const N = 100, LBL = { receipt: 'Receipt', payment: 'Payment', transfer: 'Transfer', opening: 'Opening', bill_raised: 'Bill raised', bill_received: 'Bill received' }, PRE = { receipt: 'RV-', payment: 'PV-', transfer: 'TV-', opening: 'OB-', partner: 'PD-' };
export default async function (el) {
  let L, W, E, tab = 'd', pg = 0; const f = { p: 'month', from: '', to: '', w: '', t: '', q: '' };
  async function load() { L = await lists(); W = wallets(L.pay); E = (await all(COLS)).map(r => classify(r, W)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)); }
  await load();
  const wl = k => (W[k] || { label: k }).label, rng = () => f.p === 'custom' ? [f.from || '0000-01-01', f.to || '9999-12-31'] : span(f.p);
  const wopts = (all0) => (all0 ? '<option value="">All accounts' : '') + Object.keys(W).map(k => `<option value="${esc(k)}">${esc(W[k].label)}`).join('');
  el.innerHTML = `<div class="bar"><select id="p" aria-label="Period">${PERIODS}</select>
  <input id="fr" type="date" hidden aria-label="From"><input id="to" type="date" hidden aria-label="To"><select id="w" aria-label="Account">${wopts(1)}</select>
  <select id="t" aria-label="Type"><option value="">All types<option value="receipt">Receipts<option value="payment">Payments<option value="transfer">Transfers</select>
  <input id="q" type="search" placeholder="Search voucher or details" aria-label="Search">${can('accounts', 'a') ? '<button class="btn p" id="nw">+ New entry</button>' : ''}</div>
  <div class="tabs"><button data-t="d" class="on">Daybook</button><button data-t="c">Cash &amp; bank</button><button data-t="h">Heads summary</button></div>
  <div class="card"><div class="tw" id="tb"></div><div class="pager" id="ft"><button class="btn" id="pv">‹ Prev</button><span id="in"></span><button class="btn" id="nx">Next ›</button></div></div>`;
  const inR = e => { const [a, b] = rng(); return e.date >= a && e.date <= b; }, touch = e => !f.w || e.wallet === f.w || e.wallet2 === f.w;
  const sum = a => a.reduce((s, e) => s + e.amount, 0), hd = e => e.pd ? 'Partner withdrawal' : e.head;
  function draw() {
    const [a, b] = rng(); $('#ft').hidden = tab !== 'd';
    if (tab === 'c') {   // balances per account for the selected period
      const rows = Object.keys(W).filter(k => !f.w || k === f.w).map(k => { const before = E.reduce((s, e) => e.date < a ? s + delta(e, k) : s, 0), inn = E.filter(e => inR(e) && e.wallet === k && (e.kind === 'receipt' || e.kind === 'opening')), out = E.filter(e => inR(e) && e.wallet === k && e.kind === 'payment'),
        ti = E.filter(e => inR(e) && e.kind === 'transfer' && e.wallet2 === k), to = E.filter(e => inR(e) && e.kind === 'transfer' && e.wallet === k), now = E.reduce((s, e) => s + delta(e, k), 0);
        return `<tr><td>${esc(wl(k))}</td><td class="r">${pkr(before)}</td><td class="r">${pkr(sum(inn))}</td><td class="r">${pkr(sum(out))}</td><td class="r">${pkr(sum(ti))}</td><td class="r">${pkr(sum(to))}</td><td class="r">${pkr(before + sum(inn) - sum(out) + sum(ti) - sum(to))}</td><td class="r"><b>${pkr(now)}</b></td></tr>`; });
      $('#tb').innerHTML = `<table><thead><tr><th>Account</th><th class="r">Opening</th><th class="r">Received</th><th class="r">Paid</th><th class="r">Transfer in</th><th class="r">Transfer out</th><th class="r">Closing</th><th class="r">Balance today</th></tr></thead><tbody>${rows.join('')}</tbody></table>`; return;
    }
    const rows = E.filter(e => inR(e) && touch(e));
    if (tab === 'h') {
      const grp = k => { const m = {}; rows.filter(e => e.kind === k).forEach(e => { m[hd(e)] = (m[hd(e)] || 0) + e.amount; }); return Object.entries(m).sort((x, y) => y[1] - x[1]); };
      const t = (title, g) => `<table><thead><tr><th>${title}</th><th class="r">PKR ${pkr(g.reduce((s, x) => s + x[1], 0))}</th></tr></thead><tbody>${g.map(([h, v]) => `<tr><td>${esc(h)}</td><td class="r">${pkr(v)}</td></tr>`).join('') || '<tr><td colspan="2">No entries</td></tr>'}</tbody></table>`;
      $('#tb').innerHTML = t('Income heads', grp('receipt')) + t('Expense heads', grp('payment')); return;
    }
    const q = f.q.toLowerCase(), list = rows.filter(e => (!f.t || e.kind === f.t) && (!q || (e.id + ' ' + e.title + ' ' + e.head + ' ' + e.notes).toLowerCase().includes(q))).reverse();
    const tot = list.length, max = Math.max(0, Math.ceil(tot / N) - 1); pg = Math.min(pg, max); const rc = sum(list.filter(e => e.kind === 'receipt')), py = sum(list.filter(e => e.kind === 'payment'));
    $('#tb').innerHTML = tot ? `<table><thead><tr><th>Date</th><th>Voucher</th><th>Type</th><th>Account</th><th>Details</th><th class="r">Received</th><th class="r">Paid</th><th></th></tr></thead><tbody>${list.slice(pg * N, pg * N + N).map(e => `<tr><td>${esc(e.date)}</td><td>${esc(e.id)}</td>
      <td><span class="tag ${e.kind === 'payment' ? 'u' : e.kind === 'receipt' ? '' : 'pt'}">${e.pd ? 'Partner' : LBL[e.kind]}</span></td><td>${esc(e.kind === 'transfer' ? wl(e.wallet) + ' → ' + wl(e.wallet2) : wl(e.wallet))}</td>
      <td>${esc(hd(e))}${e.title && e.title !== e.head ? '<br><small>' + esc(e.title) + '</small>' : ''}</td><td class="r">${e.kind === 'receipt' || e.kind === 'opening' ? pkr(e.amount) : ''}</td><td class="r">${e.kind === 'payment' ? pkr(e.amount) : ''}</td>
      <td>${e.manual && /^(RV|PV|TV|OB|PD|AR|AP)-/i.test(e.id) && can('accounts', 'd') ? `<button class="btn" data-del="${esc(e.id)}" aria-label="Delete ${esc(e.id)}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="msg">No entries for this period. Change the period or clear the filters.</div>';
    $('#in').textContent = tot ? `${pg * N + 1}-${Math.min(tot, pg * N + N)} of ${tot} · received PKR ${pkr(rc)} · paid PKR ${pkr(py)}` : '0 entries'; $('#pv').disabled = pg === 0; $('#nx').disabled = pg >= max;
  }
  $('#p').onchange = e => { f.p = e.target.value; $('#fr').hidden = $('#to').hidden = f.p !== 'custom'; pg = 0; draw(); };
  $('#fr').onchange = e => { f.from = e.target.value; draw(); }; $('#to').onchange = e => { f.to = e.target.value; draw(); };
  $('#w').onchange = e => { f.w = e.target.value; pg = 0; draw(); }; $('#t').onchange = e => { f.t = e.target.value; pg = 0; draw(); };
  let tm; $('#q').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { f.q = e.target.value; pg = 0; draw(); }, 250); };
  $('#pv').onclick = () => { pg--; draw(); }; $('#nx').onclick = () => { pg++; draw(); };
  el.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; pg = 0; el.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  $('#tb').onclick = async e => { const b = e.target.closest('[data-del]'); if (!b || !await ask(`Delete voucher ${b.dataset.del}? This cannot be undone.`)) return;
    try { await api('accounts?voucher_id=eq.' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }); bust(); await load(); draw(); } catch (x) { $('#tb').insertAdjacentHTML('afterbegin', `<div class="msg err">${esc(x.message)}</div>`); } };
  if ($('#nw')) $('#nw').onclick = openNew;

  function openNew() {
    const admin = me().role === 'Admin' && L.partners.length, m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<form class="box"><h2>New entry</h2><label>Type<select id="k"><option value="receipt">Receipt (money in)<option value="payment">Payment (money out)<option value="transfer">Transfer between accounts<option value="opening">Opening balance${admin ? '<option value="partner">Partner withdrawal' : ''}</select></label>
    <label>Date<input id="d" type="date" value="${iso(new Date())}" required></label><label>Amount (PKR)<input id="a" type="number" min="0.01" step="any" required></label>
    <label><span id="wl">Account</span><select id="w1">${wopts(0)}</select></label><label id="l2" hidden>To account<select id="w2">${wopts(0)}</select></label>
    <label id="lh">Head<input id="h" list="hl" autocomplete="off"><datalist id="hl"></datalist></label><label id="lp" hidden>Partner<select id="pn">${L.partners.map(p => `<option>${esc(p)}`).join('')}</select></label>
    <label id="lt" hidden>Withdrawal type<select id="pt"><option>Profit distribution<option>Partner drawings / personal use<option>Capital withdrawal</select></label>
    <label>Details<input id="ti"></label><label>Notes<input id="no"></label><div id="er" class="err"></div><div class="row"><button type="button" class="btn" id="x">Cancel</button><button class="btn p">Save entry</button></div></form>`;
    document.body.appendChild(m); const g = id => $('#' + id, m), sync = () => { const k = g('k').value; g('l2').hidden = k !== 'transfer'; g('lh').hidden = !(k === 'receipt' || k === 'payment'); g('lp').hidden = g('lt').hidden = k !== 'partner';
      g('wl').textContent = k === 'receipt' ? 'Deposit to' : k === 'payment' || k === 'partner' ? 'Paid from' : k === 'transfer' ? 'From account' : 'Account'; g('hl').innerHTML = (k === 'receipt' ? L.inc : L.exp).map(h => `<option value="${esc(h)}">`).join(''); };
    g('k').onchange = sync; sync(); g('x').onclick = () => m.remove();
    $('form', m).onsubmit = async ev => {
      ev.preventDefault(); const k = g('k').value, amt = parseFloat(g('a').value), w1 = g('w1').value, w2 = g('w2').value, h = g('h').value.trim(), ti = g('ti').value.trim(), no = g('no').value.trim(), d = g('d').value, er = t => { g('er').textContent = t; };
      if (!(amt > 0)) return er('Enter an amount greater than 0.'); if ((k === 'receipt' || k === 'payment') && !h) return er('Enter or choose a head.'); if (k === 'transfer' && w1 === w2) return er('From and To accounts must be different.');
      let id; do { id = PRE[k] + Math.floor(100000 + Math.random() * 900000); } while (E.some(x => x.id === id));
      const P = { receipt: { from_account: h, to_account: w1, description: ti || h, amount_in: amt, amount_out: 0, remarks: no }, payment: { from_account: w1, to_account: h, description: ti || h, amount_in: 0, amount_out: amt, remarks: no },
        transfer: { from_account: w1, to_account: w2, description: ti || 'Account transfer', amount_in: amt, amount_out: amt, remarks: no }, opening: { from_account: 'Opening Balance', to_account: w1, description: 'Opening Balance', amount_in: amt, amount_out: 0, remarks: no },
        partner: { from_account: w1, to_account: 'Partner Drawings', description: g('pn').value, amount_in: 0, amount_out: amt, remarks: `Type: ${g('pt').value}${no ? ' | ' + no : ''}` } }[k];
      const b = $('.p', m); b.disabled = true;
      try { await api('accounts', { method: 'POST', body: { voucher_id: id, ...P, date: d } }); m.remove(); bust(); await load(); draw(); } catch (x) { er(x.message); b.disabled = false; }
    };
  }
  draw();
}
