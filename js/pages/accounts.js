import { all, api, bust, can, me, ask, $, esc, pkr } from '../core.js';
import { iso, span, PERIODS } from '../util.js';
import { COLS, lists, wallets, classify, delta } from '../finance-data.js';
import { feeHeadReceipts } from '../fee-head-rules.js';
const N = 100, LBL = { receipt: 'Receipt', payment: 'Payment', transfer: 'Transfer', opening: 'Opening', bill_raised: 'Bill raised', bill_received: 'Bill received' }, PRE = { receipt: 'RV-', payment: 'PV-', transfer: 'TV-', opening: 'OB-', partner: 'PD-' };
export default async function (el) {
  let L, W, E, balanceById, balanceByDate, accountBalances, accountDateBalances, feeHeads, feeHeadsLoading, feeBreakdown = new Map(), headDetailEntries = new Map(), tab = 'd', pg = 0, sortKey = 'date', sortDir = -1; const f = { p: 'month', from: '', to: '', w: '', t: '', q: '' };
  async function load() {
    L = await lists(); W = wallets(L.pay);
    E = (await all(COLS)).map(r => classify(r, W)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    balanceById = new Map(); balanceByDate = new Map();
    accountBalances = new Map(Object.keys(W).map(k => [k, new Map()]));
    accountDateBalances = new Map(Object.keys(W).map(k => [k, new Map()]));
    const accountRunning = new Map(Object.keys(W).map(k => [k, 0]));
    let running = 0;
    E.forEach(e => {
      const change = e.kind === 'receipt' || e.kind === 'opening' ? e.amount : e.kind === 'payment' ? -e.amount : 0;
      running = Math.round((running + change + Number.EPSILON) * 100) / 100;
      balanceById.set(e.id, running); balanceByDate.set(e.date, running);
      accountRunning.forEach((value, wallet) => {
        const next = Math.round((value + delta(e, wallet) + Number.EPSILON) * 100) / 100;
        accountRunning.set(wallet, next);
        accountBalances.get(wallet).set(e.id, next);
        accountDateBalances.get(wallet).set(e.date, next);
      });
    });
  }
  await load();
  const wl = k => (W[k] || { label: k }).label, rng = () => f.p === 'custom' ? [f.from || '0000-01-01', f.to || '9999-12-31'] : span(f.p);
  const wopts = (all0) => (all0 ? '<option value="">All accounts' : '') + Object.keys(W).map(k => `<option value="${esc(k)}">${esc(W[k].label)}`).join('');
  const loadFeeHeads = () => {
    if (feeHeads || feeHeadsLoading) return feeHeadsLoading;
    feeHeadsLoading = all('fees?select=admis_no,student_name,class,voucher_id,period,type,payable,discount')
      .then(feeRows => {
        const payments = E.filter(row => row.fee).map(row => ({ id: row.id, date: row.date, amount: row.amount, account: wl(row.wallet) }));
        feeHeads = feeHeadReceipts(feeRows, payments, iso(new Date()));
      })
      .finally(() => { feeHeadsLoading = null; });
    return feeHeadsLoading;
  };
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
      const stats = new Map(Object.keys(W).map(k => [k, { before: 0, received: 0, paid: 0, transferIn: 0, transferOut: 0, current: 0 }]));
      E.forEach(e => {
        const from = stats.get(e.wallet), to = stats.get(e.wallet2);
        if (from) from.current += delta(e, e.wallet);
        if (to && e.kind === 'transfer') to.current += e.amount;
        if (e.date < a) {
          if (from) from.before += delta(e, e.wallet);
          if (to && e.kind === 'transfer') to.before += e.amount;
        } else if (e.date <= b) {
          if (from && (e.kind === 'receipt' || e.kind === 'opening')) from.received += e.amount;
          if (from && e.kind === 'payment') from.paid += e.amount;
          if (from && e.kind === 'transfer') from.transferOut += e.amount;
          if (to && e.kind === 'transfer') to.transferIn += e.amount;
        }
      });
      const rows = Object.keys(W).filter(k => !f.w || k === f.w).map(k => {
        const s = stats.get(k), closing = s.before + s.received - s.paid + s.transferIn - s.transferOut;
        return `<tr><td>${esc(wl(k))}</td><td class="r">${pkr(s.before)}</td><td class="r">${pkr(s.received)}</td><td class="r">${pkr(s.paid)}</td><td class="r">${pkr(s.transferIn)}</td><td class="r">${pkr(s.transferOut)}</td><td class="r">${pkr(closing)}</td><td class="r"><b>${pkr(s.current)}</b></td></tr>`;
      });
      $('#tb').innerHTML = `<table><thead><tr><th>Account</th><th class="r">Opening</th><th class="r">Received</th><th class="r">Paid</th><th class="r">Transfer in</th><th class="r">Transfer out</th><th class="r">Closing</th><th class="r">Balance today</th></tr></thead><tbody>${rows.join('')}</tbody></table>`; return;
    }
    const rows = E.filter(e => inR(e) && touch(e));
    if (tab === 'h') {
      if (!feeHeads) {
        $('#tb').innerHTML = '<div class="msg">Loading fee head details…</div>';
        loadFeeHeads().then(() => { if (tab === 'h') draw(); }).catch(error => {
          feeHeadsLoading = null;
          if (tab === 'h') $('#tb').innerHTML = `<div class="msg err">${esc(error.message || 'Could not load fee head details.')}</div>`;
        });
        return;
      }
      const inRange = detail => detail.date >= a && detail.date <= b && (!f.w || Object.keys(W).find(key => W[key].label === detail.account) === f.w);
      const makeGroups = kind => {
        const grouped = new Map();
        const add = (head, detail) => { const entries = grouped.get(head) || []; entries.push(detail); grouped.set(head, entries); };
        rows.filter(e => e.kind === kind && !e.fee).forEach(e => add(hd(e), {
          date: e.date, voucher: e.id, sourceVoucher: e.id, period: '', student: '', adm: '',
          cls: '', account: wl(e.wallet), amount: e.amount, details: e.title, notes: e.notes
        }));
        if (kind === 'receipt') {
          feeBreakdown = new Map();
          feeHeads.forEach((entries, head) => {
            const details = entries.filter(inRange);
            if (details.length) feeBreakdown.set(head, details);
          });
          const feeEntries = [...feeBreakdown.values()].flat();
          if (feeEntries.length) add('Fee income', { entries: feeEntries, amount: sum(feeEntries) });
        }
        return [...grouped].map(([head, entries]) => ({ head, entries, total: sum(entries) })).sort((x, y) => y.total - x.total);
      };
      const income = makeGroups('receipt'), expense = makeGroups('payment');
      headDetailEntries = new Map();
      const t = (title, kind, groups) => `<table><thead><tr><th>${title}</th><th class="r">PKR ${pkr(groups.reduce((total, group) => total + group.total, 0))}</th></tr></thead><tbody>${groups.map(group => {
        const key = `${kind}|${group.head}`; headDetailEntries.set(key, group.entries);
        return `<tr><td><button type="button" class="text-link" data-head-detail="${esc(key)}">${esc(group.head)}</button></td><td class="r">${pkr(group.total)}</td></tr>`;
      }).join('') || '<tr><td colspan="2">No entries</td></tr>'}</tbody></table>`;
      $('#tb').innerHTML = t('Income heads', 'receipt', income) + t('Expense heads', 'payment', expense); return;
    }
    const q = f.q.toLowerCase(), visible = rows.filter(e => (!f.t || e.kind === f.t) && (!q || (e.id + ' ' + e.title + ' ' + e.head + ' ' + e.notes).toLowerCase().includes(q)));
    const rowBalances = f.w ? accountBalances.get(f.w) : balanceById;
    const dateBalances = f.w ? accountDateBalances.get(f.w) : balanceByDate;
    const feeGroups = new Map(), list = [];
    visible.forEach(e => {
      if (!e.fee) {
        list.push({ date: e.date, id: e.id, kind: e.kind, pd: e.pd, wallet: e.wallet, wallet2: e.wallet2, title: hd(e), amount: e.amount,
          received: e.kind === 'receipt' || e.kind === 'opening' ? e.amount : 0, paid: e.kind === 'payment' ? e.amount : 0,
          balance: rowBalances.get(e.id) || 0, entries: [e] });
        return;
      }
      if (!feeGroups.has(e.date)) feeGroups.set(e.date, []);
      feeGroups.get(e.date).push(e);
    });
    feeGroups.forEach((entries, date) => {
      const accounts = [...new Set(entries.map(e => wl(e.wallet)))];
      list.push({ date, id: `Fee receipts (${entries.length})`, kind: 'fee', wallet: accounts.join(', '), title: 'Fee received',
        received: sum(entries), paid: 0, balance: dateBalances.get(date) || 0, entries });
    });
    const valueOf = row => ({
      date: row.date, voucher: row.id, type: row.kind === 'fee' ? 'Fee receipt' : row.pd ? 'Partner' : LBL[row.kind],
      account: row.wallet, details: `${row.title} ${row.entries[0].title} ${row.entries[0].head} ${row.entries[0].notes}`,
      received: row.received, paid: row.paid, balance: row.balance
    })[sortKey];
    list.sort((x, y) => {
      const a = valueOf(x), b = valueOf(y);
      return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' })) * sortDir;
    });
    const tot = list.length, max = Math.max(0, Math.ceil(tot / N) - 1); pg = Math.min(pg, max);
    const rc = sum(visible.filter(e => e.kind === 'receipt' || e.kind === 'opening')), py = sum(visible.filter(e => e.kind === 'payment'));
    const th = (key, label, cls = '', total = null) => `<th class="${cls}"><button type="button" class="sort-head" data-sort="${key}" aria-label="Sort by ${label}">${label}${sortKey === key ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}${total === null ? '' : `<small class="sort-total">PKR ${pkr(total)}</small>`}</button></th>`;
    const actions = (e, id) => {
      const editable = e.manual && /^(RV|PV|TV|OB|PD)-/i.test(id), deletable = e.manual && /^(RV|PV|TV|OB|PD|AR|AP)-/i.test(id);
      return `${editable && can('accounts', 'e') ? `<button type="button" class="btn ic row-action" data-edit="${esc(id)}" aria-label="Edit ${esc(id)}" title="Edit">✎</button>` : ''}${deletable && can('accounts', 'd') ? `<button type="button" class="btn ic row-action danger" data-del="${esc(id)}" aria-label="Delete ${esc(id)}" title="Delete">×</button>` : ''}`;
    };
    const renderRow = row => {
      if (row.kind === 'fee') {
        const detail = row.entries.map(e => `<div class="daybook-fee-detail"><span>${esc(e.id)} · ${esc(wl(e.wallet))}</span><b>PKR ${pkr(e.amount)}</b></div>`).join('');
        return `<tr><td>${esc(row.date)}</td><td>Fee receipts (${row.entries.length})</td><td><span class="tag">Fee</span></td><td>${esc(row.wallet)}</td>
          <td>${esc(row.title)}<details class="daybook-expand"><summary>＋ View ${row.entries.length} entries</summary>${detail}</details></td>
          <td class="r">${pkr(row.received)}</td><td class="r">—</td><td class="r"><b>${pkr(row.balance)}</b></td><td></td></tr>`;
      }
      const e = row.entries[0];
      return `<tr><td>${esc(row.date)}</td><td>${esc(row.id)}</td>
        <td><span class="tag ${e.kind === 'payment' ? 'u' : e.kind === 'receipt' ? '' : 'pt'}">${e.pd ? 'Partner' : LBL[e.kind]}</span></td>
        <td>${esc(e.kind === 'transfer' ? wl(e.wallet) + ' → ' + wl(e.wallet2) : wl(e.wallet))}</td>
        <td>${esc(hd(e))}${e.title && e.title !== e.head ? '<br><small>' + esc(e.title) + '</small>' : ''}</td>
        <td class="r">${row.received ? pkr(row.received) : '—'}</td><td class="r">${row.paid ? pkr(row.paid) : '—'}</td><td class="r"><b>${pkr(row.balance)}</b></td>
        <td class="daybook-actions">${actions(e, e.id)}</td></tr>`;
    };
    $('#tb').innerHTML = tot ? `<table><thead><tr>${th('date', 'Date')}${th('voucher', 'Voucher')}${th('type', 'Type')}${th('account', 'Account')}${th('details', 'Details')}${th('received', 'Received', 'r', rc)}${th('paid', 'Paid', 'r', py)}${th('balance', 'Balance', 'r')}<th>Actions</th></tr></thead>
      <tbody>${list.slice(pg * N, pg * N + N).map(renderRow).join('')}</tbody></table>` : '<div class="msg">No entries for this period. Change the period or clear the filters.</div>';
    $('#in').textContent = tot ? `${pg * N + 1}-${Math.min(tot, pg * N + N)} of ${tot} rows · received PKR ${pkr(rc)} · paid PKR ${pkr(py)}` : '0 entries'; $('#pv').disabled = pg === 0; $('#nx').disabled = pg >= max;
  }
  $('#p').onchange = e => { f.p = e.target.value; $('#fr').hidden = $('#to').hidden = f.p !== 'custom'; pg = 0; draw(); };
  $('#fr').onchange = e => { f.from = e.target.value; draw(); }; $('#to').onchange = e => { f.to = e.target.value; draw(); };
  $('#w').onchange = e => { f.w = e.target.value; pg = 0; draw(); }; $('#t').onchange = e => { f.t = e.target.value; pg = 0; draw(); };
  let tm; $('#q').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { f.q = e.target.value; pg = 0; draw(); }, 250); };
  $('#pv').onclick = () => { pg--; draw(); }; $('#nx').onclick = () => { pg++; draw(); };
  el.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
    tab = b.dataset.t; pg = 0;
    el.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    setTimeout(draw, 0);
  });
  $('#tb').onclick = async e => {
    const head = e.target.closest('[data-head-detail]');
    if (head) { showHeadDetails(head.dataset.headDetail); return; }
    const sort = e.target.closest('[data-sort]');
    if (sort) { const key = sort.dataset.sort; sortDir = sortKey === key ? -sortDir : key === 'date' ? -1 : 1; sortKey = key; pg = 0; draw(); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) { const row = E.find(item => item.id === edit.dataset.edit); if (row) openNew(row); return; }
    const remove = e.target.closest('[data-del]'); if (!remove || !await ask(`Delete voucher ${remove.dataset.del}? This cannot be undone.`)) return;
    try { await api('accounts?voucher_id=eq.' + encodeURIComponent(remove.dataset.del), { method: 'DELETE' }); bust(); await load(); draw(); } catch (x) { $('#tb').insertAdjacentHTML('afterbegin', `<div class="msg err">${esc(x.message)}</div>`); }
  };
  if ($('#nw')) $('#nw').onclick = openNew;

  function showHeadDetails(key) {
    const entries = headDetailEntries.get(key) || [], [kind, ...headParts] = key.split('|'), head = headParts.join('|');
    const m = document.createElement('div'); m.className = 'modal';
    const detailsMarkup = details => details.slice().sort((x, y) => y.date.localeCompare(x.date) || String(x.voucher).localeCompare(String(y.voucher), undefined, { numeric: true })).map(entry => `
      <tr><td>${esc(entry.date || '—')}</td><td>${esc(entry.student || entry.details || entry.notes || '—')}</td><td>${esc(entry.adm || '—')}</td>
      <td>${esc(entry.period || '—')}</td><td>${esc(entry.voucher || '—')}</td><td>${esc(entry.account || '—')}</td><td class="r">${pkr(entry.amount)}</td></tr>`).join('');
    const detailTable = details => `<div class="tw"><table><thead><tr><th>Date</th><th>Student / Details</th><th>Admission no</th><th>Period</th><th>Voucher</th><th>Account</th><th class="r">Amount</th></tr></thead><tbody>${detailsMarkup(details) || '<tr><td colspan="7">No details available.</td></tr>'}</tbody></table></div>`;
    const feeSummary = key === 'receipt|Fee income';
    const feeBreakdownTable = () => `<div class="tw"><table><thead><tr><th>Fee head</th><th class="r">Received</th></tr></thead><tbody>${[...feeBreakdown].map(([feeHead, details]) => ({ feeHead, details, total: sum(details) })).sort((x, y) => y.total - x.total).map(group => `<tr><td><button type="button" class="text-link" data-fee-head="${esc(group.feeHead)}">${esc(group.feeHead)}</button></td><td class="r">${pkr(group.total)}</td></tr>`).join('')}</tbody></table></div>`;
    const content = feeSummary ? feeBreakdownTable() : detailTable(entries);
    m.innerHTML = `<div class="box ledger-box"><div class="row ledger-head"><div><h2 data-head-title>${esc(head)}</h2><div class="sub" style="padding:3px 0" data-head-subtitle>${feeSummary ? 'Fee received, grouped by the fee item' : `${kind === 'receipt' ? 'Income' : 'Expense'} details · ${entries.length} entries`}</div></div><div class="row"><button type="button" class="btn" data-fee-back ${feeSummary ? 'hidden' : ''}>Back to fee heads</button><button type="button" class="btn" data-close-head>Close</button></div></div>
      <div data-head-content>${content}</div></div>`;
    document.body.appendChild(m);
    m.onclick = event => {
      if (event.target === m || event.target.closest('[data-close-head]')) { m.remove(); return; }
      const feeHead = event.target.closest('[data-fee-head]');
      if (feeHead) {
        const selected = feeHead.dataset.feeHead, rows = feeBreakdown.get(selected) || [];
        $('[data-head-title]', m).textContent = selected;
        $('[data-head-subtitle]', m).textContent = `Fee head details · ${rows.length} entries`;
        $('[data-head-content]', m).innerHTML = detailTable(rows);
        $('[data-fee-back]', m).hidden = false;
        return;
      }
      if (event.target.closest('[data-fee-back]')) {
        $('[data-head-title]', m).textContent = head;
        $('[data-head-subtitle]', m).textContent = 'Fee received, grouped by the fee item';
        $('[data-head-content]', m).innerHTML = feeBreakdownTable();
        $('[data-fee-back]', m).hidden = true;
      }
    };
  }

  function openNew(editEntry = null) {
    const admin = (me().role === 'Admin' && L.partners.length) || !!editEntry?.pd, m = document.createElement('div'); m.className = 'modal';
    const partnerType = editEntry?.notes.match(/Type:\s*([^|]+)/i)?.[1]?.trim();
    m.innerHTML = `<form class="box"><h2>${editEntry ? 'Edit entry' : 'New entry'}</h2><label>Type<select id="k"><option value="receipt">Receipt (money in)<option value="payment">Payment (money out)<option value="transfer">Transfer between accounts<option value="opening">Opening balance${admin ? '<option value="partner">Partner withdrawal' : ''}</select></label>
    <label>Date<input id="d" type="date" value="${editEntry?.date || iso(new Date())}" required></label><label>Amount (PKR)<input id="a" type="number" min="0.01" step="any" value="${editEntry?.amount ?? ''}" required></label>
    <label><span id="wl">Account</span><select id="w1">${wopts(0)}</select></label><label id="l2" hidden>To account<select id="w2">${wopts(0)}</select></label>
    <label id="lh">Head<input id="h" list="hl" autocomplete="off"><datalist id="hl"></datalist></label><label id="lp" hidden>Partner<select id="pn">${[...new Set([...L.partners, ...(editEntry?.pd ? [editEntry.title] : [])])].map(p => `<option>${esc(p)}`).join('')}</select></label>
    <label id="lt" hidden>Withdrawal type<select id="pt"><option>Profit distribution<option>Partner drawings / personal use<option>Capital withdrawal</select></label>
    <label>Details<input id="ti" value="${esc(editEntry?.kind === 'partner' ? '' : editEntry?.title || '')}"></label><label>Notes<input id="no" value="${esc(editEntry?.notes.replace(/Type:\s*[^|]+(?:\s*\|\s*)?/i, '') || '')}"></label><div id="er" class="err"></div><div class="row"><button type="button" class="btn" id="x">Cancel</button><button class="btn p">${editEntry ? 'Save changes' : 'Save entry'}</button></div></form>`;
    document.body.appendChild(m); const g = id => $('#' + id, m), sync = () => { const k = g('k').value; g('l2').hidden = k !== 'transfer'; g('lh').hidden = !(k === 'receipt' || k === 'payment'); g('lp').hidden = g('lt').hidden = k !== 'partner';
      g('wl').textContent = k === 'receipt' ? 'Deposit to' : k === 'payment' || k === 'partner' ? 'Paid from' : k === 'transfer' ? 'From account' : 'Account'; g('hl').innerHTML = (k === 'receipt' ? L.inc : L.exp).map(h => `<option value="${esc(h)}">`).join(''); };
    g('k').value = editEntry?.pd ? 'partner' : editEntry?.kind || 'receipt';
    g('k').onchange = sync; sync();
    if (editEntry) {
      g('w1').value = editEntry.wallet;
      if (editEntry.wallet2) g('w2').value = editEntry.wallet2;
      g('h').value = editEntry.head;
      if (editEntry.pd) {
        g('pn').value = editEntry.title;
        if (partnerType) g('pt').value = partnerType;
      }
    }
    g('x').onclick = () => m.remove();
    $('form', m).onsubmit = async ev => {
      ev.preventDefault(); const k = g('k').value, amt = parseFloat(g('a').value), w1 = g('w1').value, w2 = g('w2').value, h = g('h').value.trim(), ti = g('ti').value.trim(), no = g('no').value.trim(), d = g('d').value, er = t => { g('er').textContent = t; };
      if (!(amt > 0)) return er('Enter an amount greater than 0.'); if ((k === 'receipt' || k === 'payment') && !h) return er('Enter or choose a head.'); if (k === 'transfer' && w1 === w2) return er('From and To accounts must be different.');
      let id = editEntry?.id; if (!id) do { id = PRE[k] + Math.floor(100000 + Math.random() * 900000); } while (E.some(x => x.id === id));
      const P = { receipt: { from_account: h, to_account: w1, description: ti || h, amount_in: amt, amount_out: 0, remarks: no }, payment: { from_account: w1, to_account: h, description: ti || h, amount_in: 0, amount_out: amt, remarks: no },
        transfer: { from_account: w1, to_account: w2, description: ti || 'Account transfer', amount_in: amt, amount_out: amt, remarks: no }, opening: { from_account: 'Opening Balance', to_account: w1, description: 'Opening Balance', amount_in: amt, amount_out: 0, remarks: no },
        partner: { from_account: w1, to_account: 'Partner Drawings', description: g('pn').value, amount_in: 0, amount_out: amt, remarks: `Type: ${g('pt').value}${no ? ' | ' + no : ''}` } }[k];
      const b = $('.p', m); b.disabled = true;
      try {
        const body = { ...P, date: d };
        if (editEntry) await api('accounts?voucher_id=eq.' + encodeURIComponent(id), { method: 'PATCH', body });
        else await api('accounts', { method: 'POST', body: { voucher_id: id, ...body } });
        m.remove(); bust(); await load(); draw();
      } catch (x) { er(x.message); b.disabled = false; }
    };
  }
  draw();
}
