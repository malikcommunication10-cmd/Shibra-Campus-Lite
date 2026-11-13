import { api, all, bust, can, flag, me, ask, esc, $ } from '../core.js';
import { fmt, iso } from '../util.js';
import { buildStudentLedger, getLatestPayment } from '../ledger-rules.js';

const OUT = {
  promised: 'Spoke – promise taken',
  callback: 'Asked to call back later',
  no_answer: 'Did not answer',
  off_wrong: 'Phone off / wrong number',
  refused: 'Refused / raised an issue',
  paid: 'Payment received',
  other: 'Other'
};
const ST = {
  overdue: ['Overdue promise', 'u', 0],
  today: ['Promise today', 'pt', 1],
  new: ['Not called yet', '', 2],
  nopromise: ['No promise', 'pt', 3],
  upcoming: ['Promise upcoming', '', 4],
  clear: ['Clear', '', 5]
};
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const PAGE_SIZE = 50;
const norm = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const digits = value => String(value || '').replace(/\D/g, '');
const phoneForWhatsApp = value => {
  const number = digits(value);
  return number.startsWith('92') ? number : number.startsWith('0') ? '92' + number.slice(1) : '92' + number;
};
const childKey = (adm, name) => norm(adm) ? 'a:' + norm(adm) : 'n:' + norm(name);
const familyKey = (sibling, key) => {
  const code = norm(sibling).replace(/\s/g, '');
  return code ? 'fam:' + code : 'solo:' + key;
};
const periodRank = period => {
  const value = norm(period);
  if (value.includes('arrear')) return -1;
  const parts = value.split(/\s+/), month = MONTHS.indexOf(parts[0]);
  return month < 0 ? Number.MAX_SAFE_INTEGER : (parseInt(parts[1], 10) || 0) * 12 + month;
};
const statusClass = status => ST[status] || ST.clear;
const kidKind = kid => {
  if (!kid.inStudents) return 'other';
  const status = norm(kid.status);
  if (!status || status === 'active') return 'active';
  return status.includes('left') || kid.leftDate ? 'left' : 'other';
};
const familyHasStatus = (family, value) => value === 'all' || family.kids.some(kid => kidKind(kid) === value);
const dateText = value => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const dateTimeText = value => value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default async function (el) {
  const response = await api('rpc/app_followup_data').catch(error => {
    throw Error(/404/.test(error.message)
      ? 'Restricted Follow-up access is not installed. Ask the administrator to run supabase_followups_access.sql.'
      : error.message);
  });
  let D = response.rows;
  if (!D || !Array.isArray(D.students) || !Array.isArray(D.fees) || !Array.isArray(D.accounts)) {
    throw Error('Follow-up access is not set up. Ask the administrator to run supabase_followups_access.sql, then refresh.');
  }

  const canAssign = flag('assign');
  let logs = [], noLogs = false, families = [], familyByKey = {}, assignments = [], assignees = [];
  let page = 0, historyTab = false, activeModal = null;
  const today = iso(new Date()), currentRank = new Date().getFullYear() * 12 + new Date().getMonth();
  const updateAssignmentData = data => {
    assignments = Array.isArray(data.assignments) ? data.assignments : [];
    assignees = Array.isArray(data.assignees) ? data.assignees : [];
  };
  updateAssignmentData(D);

  const loadLogs = async () => {
    try {
      logs = await all('call_logs?select=id,family_key,family_label,children,student_keys,call_date,outcome,spoke_with,promise_date,promise_amount,remarks,pending_at_call,caller&order=call_date.desc');
      noLogs = false;
    } catch {
      logs = [];
      noLogs = true;
    }
  };

  function buildFamilies() {
    const paidByVoucher = {}, transactionsByVoucher = new Map();
    D.accounts.forEach(row => {
      const id = String(row.voucher_id || '').trim(), voucher = id.split('-').slice(0, 2).join('-');
      if (!voucher) return;
      paidByVoucher[voucher] = (paidByVoucher[voucher] || 0) + (Number(row.amount_in) || 0);
      if (!transactionsByVoucher.has(voucher)) transactionsByVoucher.set(voucher, []);
      transactionsByVoucher.get(voucher).push(row);
    });

    const children = new Map();
    const addChild = (key, values = {}) => {
      if (!children.has(key)) children.set(key, {
        key, adm: '', name: '', cls: '', sibling: '', contacts: [], parent: '', status: '',
        leftDate: '', inStudents: false, vouchers: new Map(), rows: [], net: 0, monthlyFee: 0
      });
      return Object.assign(children.get(key), values);
    };

    D.students.forEach(student => {
      const key = childKey(student.admis_no, student.student_name), contacts = [], seen = new Set();
      let parent = '';
      Object.entries(student).forEach(([field, value]) => {
        const text = String(value ?? '').trim();
        if (!text) return;
        if (/phone|mobile|contact|whatsapp|cell|\btel\b/i.test(field)) {
          const number = digits(text);
          if (number.length >= 7 && !seen.has(number)) {
            seen.add(number);
            contacts.push({ label: field.replace(/_/g, ' '), number: text });
          }
        } else if (/father|guardian|parent/i.test(field) && !parent && /[^\d\s]/.test(text)) parent = text;
      });
      addChild(key, {
        adm: student.admis_no || '', name: student.student_name || '', cls: student.class || '',
        sibling: String(student.siblings || '').trim(), contacts, parent, inStudents: true,
        status: String(student.status || ''), leftDate: String(student.left_date || ''),
        monthlyFee: Number(student.monthly_tution_fee) || 0
      });
    });

    D.fees.forEach(row => {
      const key = childKey(row.admis_no, row.student_name);
      const child = addChild(key, {
        adm: row.admis_no || '', name: row.student_name || '', cls: row.class || '',
        sibling: String(row.siblings || '').trim()
      });
      const voucherId = String(row.voucher_id || '').trim();
      const charge = (Number(row.payable) || 0) - (Number(row.discount) || 0);
      const rank = periodRank(row.period);
      const voucher = child.vouchers.get(voucherId) || {
        id: voucherId, period: row.period || '', charge: 0, paid: 0,
        future: rank !== Number.MAX_SAFE_INTEGER && rank > currentRank, items: []
      };
      voucher.charge += charge;
      voucher.paid = paidByVoucher[voucherId] || 0;
      voucher.items.push({ type: row.type || 'Tuition fee', amount: charge });
      child.vouchers.set(voucherId, voucher);
    });

    const familiesMap = new Map();
    children.forEach(child => {
      const vouchers = [...child.vouchers.values()].sort((a, b) => periodRank(a.period) - periodRank(b.period) || a.id.localeCompare(b.id));
      const allPaid = vouchers.reduce((sum, voucher) => sum + voucher.paid, 0);
      const chargesDue = vouchers.filter(voucher => !voucher.future).reduce((sum, voucher) => sum + voucher.charge, 0);
      let balancePool = allPaid;
      child.rows = vouchers.filter(voucher => !voucher.future).map(voucher => {
        const applied = Math.min(Math.max(balancePool, 0), Math.max(voucher.charge, 0));
        balancePool -= applied;
        return {
          period: voucher.period, voucherId: voucher.id,
          fee: voucher.items.map(item => item.type).join(', '),
          charge: voucher.charge, paid: applied,
          due: Math.round((voucher.charge - applied) * 100) / 100
        };
      });
      child.net = Math.round((chargesDue - allPaid) * 100) / 100;
      child.voucherList = vouchers;

      const key = familyKey(child.sibling, child.key);
      if (!familiesMap.has(key)) familiesMap.set(key, {
        key, label: child.sibling, kids: [], pending: 0, contacts: [], parent: '', logs: []
      });
      const family = familiesMap.get(key);
      family.kids.push(child);
      family.pending += child.net;
      if (!family.parent && child.parent) family.parent = child.parent;
      child.contacts.forEach(contact => {
        if (!family.contacts.some(item => digits(item.number) === digits(contact.number))) family.contacts.push(contact);
      });
    });

    logs.forEach(log => {
      const family = familiesMap.get(log.family_key);
      if (family) family.logs.push(log);
    });

    families = [...familiesMap.values()].map(family => {
      family.kids.sort((a, b) => a.name.localeCompare(b.name));
      family.logs.sort((a, b) => new Date(b.call_date) - new Date(a.call_date));
      family.last = family.logs[0] || null;
      family.promise = family.last?.promise_date ? String(family.last.promise_date).slice(0, 10) : '';
      family.pending = Math.round(family.pending * 100) / 100;
      family.status = family.pending <= 0 ? 'clear' : !family.last ? 'new' : !family.promise ? 'nopromise' : family.promise > today ? 'upcoming' : family.promise === today ? 'today' : 'overdue';
      family.title = family.label ? `Family ${family.label}` : 'Individual';
      family.names = family.kids.map(kid => kid.name).join(', ');
      family.classes = [...new Set(family.kids.map(kid => kid.cls).filter(Boolean))];
      family.paidSince = family.last && Number.isFinite(Number(family.last.pending_at_call))
        ? Math.max(0, Number(family.last.pending_at_call) - family.pending) : 0;
      const familyTransactions = [], seenTransactions = new Set();
      family.kids.forEach(kid => kid.voucherList.forEach(voucher => {
        const prefix = voucher.id.split('-').slice(0, 2).join('-');
        (transactionsByVoucher.get(prefix) || []).forEach(transaction => {
          if (seenTransactions.has(transaction)) return;
          seenTransactions.add(transaction);
          familyTransactions.push(transaction);
        });
      }));
      family.lastPayment = getLatestPayment(familyTransactions, today);
      return family;
    });
    familyByKey = Object.fromEntries(families.map(family => [family.key, family]));
  }

  await loadLogs();
  buildFamilies();
  const classes = [...new Set([
    ...D.students.map(student => String(student.class || '').trim()),
    ...D.fees.map(row => String(row.class || '').trim())
  ].filter(Boolean))].sort();
  el.innerHTML = `${noLogs ? '<div class="card msg err">Call history table is missing or restricted. Ask the administrator to run supabase_followups_access.sql.</div>' : ''}
    ${canAssign && (!Array.isArray(D.assignments) || !Array.isArray(D.assignees)) ? '<div class="card msg">Assignment controls need the updated follow-up access SQL installed.</div>' : ''}
    <div class="kpis" id="kpis"></div>
    <div class="tabs"><button class="btn p" id="familiesTab">📞 Families</button><button class="btn" id="historyTab">🗂 Call history</button></div>
    <section id="familiesPane">
      <div class="bar">
        <input id="q" type="search" placeholder="Family code, student, admission no, phone" aria-label="Search">
        <select id="c" aria-label="Class"><option value="">All classes</option>${classes.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('')}</select>
        <select id="s" aria-label="Student status"><option value="active">Active students</option><option value="left">Left students</option><option value="other">Inactive / other</option><option value="all">All students</option></select>
        <select id="status" aria-label="Follow-up status"><option value="">All statuses</option><option value="calltoday">Call today (today + overdue)</option>${Object.entries(ST).map(([key, value]) => `<option value="${key}">${esc(value[0])}</option>`).join('')}</select>
        <select id="sort" aria-label="Sort"><option value="priority">Sort: Call priority</option><option value="pending">Sort: Highest pending</option><option value="code">Sort: Family code</option></select>
        <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pendingOnly" checked> Just pending</label>
      </div>
      <div class="row"><span id="familyCount" class="sub"></span><div class="row">
        <button class="btn" id="expandAll">Expand all</button><button class="btn" id="collapseAll">Collapse all</button><button class="btn" id="printCalls">Print call sheet</button>
      </div></div>
      <div id="familyList"></div>
      <div class="pager"><button class="btn" id="prev">‹ Prev</button><span id="pageInfo"></span><button class="btn" id="next">Next ›</button></div>
    </section>
    <section id="historyPane" hidden>
      <div class="bar"><input id="historySearch" type="search" placeholder="Search family, student, caller or remarks" aria-label="Search call history">
        <select id="historyOutcome" aria-label="Outcome"><option value="">All outcomes</option>${Object.entries(OUT).map(([key, value]) => `<option value="${key}">${esc(value)}</option>`).join('')}</select>
        <label>From <input id="historyFrom" type="date" aria-label="From date"></label><label>To <input id="historyTo" type="date" aria-label="To date"></label>
        <button class="btn p" id="exportHistory">⬇ Excel / CSV</button>
      </div><div class="sub" id="historyCount"></div><div class="card"><div class="tw" id="historyTable"></div></div>
    </section>`;

  function filteredFamilies() {
    const query = $('#q').value.trim().toLowerCase(), queryDigits = digits(query);
    const list = families.filter(family => {
      if ($('#pendingOnly').checked && family.pending <= 0.004) return false;
      if (!familyHasStatus(family, $('#s').value)) return false;
      if ($('#c').value && !family.classes.includes($('#c').value)) return false;
      const status = $('#status').value;
      if (status === 'calltoday' && !['today', 'overdue'].includes(family.status)) return false;
      if (status && status !== 'calltoday' && family.status !== status) return false;
      if (query) {
        const text = `${family.label} ${family.parent} ${family.names} ${family.kids.map(kid => kid.adm).join(' ')}`.toLowerCase();
        const phoneMatch = queryDigits.length >= 3 && family.contacts.some(contact => digits(contact.number).includes(queryDigits));
        if (!text.includes(query) && !phoneMatch) return false;
      }
      return true;
    });
    return list.sort((a, b) => $('#sort').value === 'pending'
      ? b.pending - a.pending
      : $('#sort').value === 'code'
        ? a.label.localeCompare(b.label, undefined, { numeric: true })
        : statusClass(a.status)[2] - statusClass(b.status)[2] || b.pending - a.pending);
  }

  function contactLinks(family) {
    if (!family.contacts.length) return '<span class="sub">No contact number on file.</span>';
    return family.contacts.map(contact => `<span class="followup-contact"><span>contact ${esc(contact.label)}</span>
      <a href="tel:${esc(digits(contact.number))}">${esc(contact.number)}</a>
      <button type="button" class="followup-contact-wa" data-wa-contact="${esc(family.key)}" data-wa-phone="${esc(contact.number)}">WA</button></span>`).join('');
  }

  function familyCard(family) {
    const label = family.pending > 0.004 ? `PKR ${fmt(family.pending)}` : family.pending < -0.004 ? `Advance PKR ${fmt(-family.pending)}` : 'Clear';
    const promiseDelta = family.promise
      ? Math.round((new Date(`${family.promise}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000) : null;
    const promiseRelative = promiseDelta === null ? '' : promiseDelta === 0 ? 'today'
      : promiseDelta > 0 ? `in ${promiseDelta} day${promiseDelta === 1 ? '' : 's'}`
        : `${Math.abs(promiseDelta)} day${promiseDelta === -1 ? '' : 's'} ago`;
    const promise = family.promise
      ? `Promise ${dateText(family.promise)}${family.last?.promise_amount ? ` · PKR ${fmt(family.last.promise_amount)}` : ''}`
      : family.last ? 'No promise date on last call' : 'No calls recorded';
    const studentRows = family.kids.map(kid => {
      const dueRows = kid.rows.filter(row => row.due > 0.004);
      return `<tr><td><button class="text-link" data-ledger="${esc(kid.key)}">${esc(kid.name || 'Student')}</button><br><small>${esc(kid.adm || '—')} · ${esc(kid.cls || '—')}</small></td>
        <td>${kid.monthlyFee ? fmt(kid.monthlyFee) : '—'}</td>
        <td>${dueRows.map(row => `<span class="tag">${esc(row.period)}: ${fmt(row.due)}</span>`).join(' ') || '<span class="sub">No unpaid months</span>'}</td>
        <td class="r"><b>${fmt(kid.net)}</b></td></tr>`;
    }).join('');
    const historyRows = family.logs.map(log => `<tr><td>${esc(dateTimeText(log.call_date))}</td><td>${esc(OUT[log.outcome] || log.outcome || '—')}</td>
      <td>${esc(log.spoke_with || '—')}</td><td>${log.promise_date ? esc(dateText(log.promise_date)) : '—'}</td><td>${esc(log.remarks || '—')}</td>
      <td>${can('followups', 'd') ? `<button class="btn" data-delete-log="${esc(log.id)}" aria-label="Delete call record">Delete</button>` : ''}</td></tr>`).join('');
    const assigned = assignments.filter(item => item.family_key === family.key).map(item => {
      const user = assignees.find(person => norm(person.email) === norm(item.assignee_email));
      const target = item.scope_type === 'family' ? 'Whole family' : family.kids.find(kid => kid.key === item.scope_key)?.name || 'Student';
      return `<span>${esc(target)} → ${esc(user?.name || item.assignee_email)}</span>`;
    });
    const dueClass = family.pending > 0.004 ? 'due' : family.pending < -0.004 ? 'advance' : 'clear';
    const paymentDate = family.lastPayment ? dateText(family.lastPayment.date) : '—';
    const paymentAmount = family.lastPayment ? `PKR ${fmt(family.lastPayment.amount)}` : '—';
    return `<article class="card followup-card"><div class="followup-card-main">
      <div class="followup-card-content">
        <div class="followup-heading">
          <b class="followup-family-name">${esc(family.title)}</b>
          <span class="followup-status ${esc(family.status)}">${esc(statusClass(family.status)[0])}</span>
          ${assigned.length ? `<span class="followup-assignees">👥 ${assigned.join(' · ')}</span>` : ''}
        </div>
        <div class="followup-kids">${family.kids.map(kid => `<span class="followup-kid">
          <button class="text-link" data-ledger="${esc(kid.key)}">${esc(kid.name)}</button>
          <span class="followup-kid-class">${esc(kid.cls || '—')}</span>
          <b class="${kid.net > 0.004 ? 'kid-due' : 'kid-clear'}">${kid.net > 0.004 ? fmt(kid.net) : kid.net < -0.004 ? `Adv ${fmt(-kid.net)}` : 'Clear'}</b>
        </span>`).join('')}</div>
        ${family.parent ? `<div class="followup-parent">Parent / guardian: ${esc(family.parent)}</div>` : ''}
        <div class="followup-contacts">${contactLinks(family)}</div>
        <div class="followup-promise">${esc(promise)}${promiseRelative ? ` <span>(${esc(promiseRelative)})</span>` : ''}</div>
        <div class="followup-last-call">${family.last ? `Last call: ${esc(dateTimeText(family.last.call_date))} · ${esc(OUT[family.last.outcome] || family.last.outcome || '')}` : 'No calls recorded yet'}</div>
        ${family.paidSince > 0 ? `<div class="followup-paid-since">PKR ${fmt(family.paidSince)} received since last call</div>` : ''}
      </div>
      <div class="followup-total">
        <span>Total due</span><b class="${dueClass}">${esc(label)}</b>
        <small>LPD: <strong>${esc(paymentDate)}</strong></small>
        <small>LPA: <strong>${esc(paymentAmount)}</strong></small>
      </div>
      </div>
      <div class="followup-actions">
        <button class="btn followup-action record" data-call="${esc(family.key)}">📞 Record call</button>
        ${canAssign ? `<button class="btn followup-action assign" data-assign="${esc(family.key)}">👥 Manage assignments</button>` : ''}
        <button class="btn followup-action reminder" data-whatsapp="${esc(family.key)}">💬 WhatsApp reminder</button>
        <button class="btn followup-action details" aria-expanded="false" data-toggle-details="${esc(family.key)}">▼ Details &amp; call history (${family.logs.length})</button>
      </div>
      <details class="followup-details"><summary class="visually-hidden">Details &amp; call history (${family.logs.length})</summary>
        <div class="tw"><table><thead><tr><th>Student</th><th>Monthly fee</th><th>Unpaid months</th><th class="r">Total</th></tr></thead><tbody>${studentRows}</tbody></table></div>
        <h4>Call history</h4><div class="tw"><table><thead><tr><th>Date / time</th><th>Outcome</th><th>Spoke with</th><th>Promise</th><th>Remarks</th><th></th></tr></thead><tbody>${historyRows || '<tr><td colspan="6">No calls recorded.</td></tr>'}</tbody></table></div>
      </details></article>`;
  }

  function drawSummary() {
    const filtered = filteredFamilies();
    const withDues = filtered.filter(family => family.pending > 0.004);
    const kpis = [
      ['Families with dues', withDues.length, ''],
      ['Total pending', `PKR ${fmt(withDues.reduce((sum, family) => sum + family.pending, 0))}`, 'a'],
      ['Call today', filtered.filter(family => ['today', 'overdue'].includes(family.status)).length, 'pt'],
      ['Overdue promises', filtered.filter(family => family.status === 'overdue').length, 'u'],
      ['Not called yet', filtered.filter(family => family.status === 'new').length, '']
    ];
    $('#kpis').innerHTML = kpis.map(([title, value, cls]) => `<div class="kpi ${cls}"><span>${esc(title)}</span><b>${value}</b></div>`).join('');
  }

  function drawHistory() {
    const query = $('#historySearch').value.trim().toLowerCase(), outcome = $('#historyOutcome').value,
      from = $('#historyFrom').value, to = $('#historyTo').value;
    const list = logs.filter(log => {
      const date = String(log.call_date || '').slice(0, 10);
      if (outcome && log.outcome !== outcome) return false;
      if (from && date < from) return false;
      if (to && date > to) return false;
      const text = `${log.family_label || ''} ${log.children || ''} ${log.spoke_with || ''} ${log.caller || ''} ${log.remarks || ''}`.toLowerCase();
      return !query || text.includes(query);
    });
    $('#historyCount').textContent = `${list.length} call record(s)`;
    $('#historyTable').innerHTML = list.length ? `<table><thead><tr><th>Date / time</th><th>Family / students</th><th>Outcome</th><th>Spoke with</th><th>Promise</th><th>Remarks</th><th>Pending then</th><th>Caller</th><th></th></tr></thead><tbody>${list.map(log => `<tr>
      <td>${esc(dateTimeText(log.call_date))}</td><td>${esc(log.family_label || '—')}<br><small>${esc(log.children || '')}</small></td>
      <td>${esc(OUT[log.outcome] || log.outcome || '—')}</td><td>${esc(log.spoke_with || '—')}</td>
      <td>${log.promise_date ? `${esc(dateText(log.promise_date))}${log.promise_amount ? `<br>PKR ${fmt(log.promise_amount)}` : ''}` : '—'}</td>
      <td>${esc(log.remarks || '—')}</td><td>PKR ${fmt(log.pending_at_call)}</td><td>${esc(log.caller || '—')}</td>
      <td>${can('followups', 'd') ? `<button class="btn" data-delete-log="${esc(log.id)}">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="msg">No call records match these filters.</div>';
  }

  function refreshView() {
    drawSummary();
    $('#familiesPane').hidden = historyTab;
    $('#historyPane').hidden = !historyTab;
    $('#familiesTab').classList.toggle('p', !historyTab);
    $('#historyTab').classList.toggle('p', historyTab);
    if (historyTab) { drawHistory(); return; }
    const list = filteredFamilies(), maxPage = Math.max(0, Math.ceil(list.length / PAGE_SIZE) - 1);
    page = Math.min(page, maxPage);
    $('#familyCount').textContent = `${list.length} families · filtered pending PKR ${fmt(list.reduce((sum, family) => sum + Math.max(family.pending, 0), 0))}`;
    $('#familyList').innerHTML = list.length
      ? list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).map(familyCard).join('')
      : '<div class="msg">No families match. Clear a filter or untick “Just pending”.</div>';
    $('#pageInfo').textContent = list.length ? `${page * PAGE_SIZE + 1}-${Math.min(list.length, (page + 1) * PAGE_SIZE)} of ${list.length}` : '0 families';
    $('#prev').disabled = page === 0;
    $('#next').disabled = page >= maxPage;
  }

  function appendModal(content, className = 'box') {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="${className}" style="max-width:760px;max-height:94vh;overflow:auto">${content}</div>`;
    document.body.appendChild(modal);
    activeModal = modal;
    return modal;
  }

  function openLedger(key) {
    const child = families.flatMap(family => family.kids).find(kid => kid.key === key);
    if (!child) return;
    const cutoff = new Date(), ledger = buildStudentLedger(D.fees, D.accounts, child.adm, child.name, cutoff);
    const monthly = ledger.vouchers.map(voucher => `<tr><td>${esc(voucher.period || '—')}</td><td>${esc(voucher.id)}</td><td>${voucher.items.map(item => esc(item.type)).join(', ')}</td>
      <td class="r">${fmt(voucher.charge)}</td><td class="r">${fmt(voucher.paid)}</td><td class="r">${voucher.balance > 0.004 ? fmt(voucher.balance) : '—'}</td><td>${esc(voucher.status)}</td></tr>`).join('');
    const transactions = ledger.events.map(event => `<tr><td>${esc(event.date || '—')}</td><td>${esc(event.voucherId || '—')}</td><td>${esc(event.description || event.period || '')}</td>
      <td class="r">${event.debit ? fmt(event.debit) : '—'}</td><td class="r">${event.credit ? fmt(event.credit) : '—'}</td><td class="r">${fmt(event.balance)}</td></tr>`).join('');
    const modal = appendModal(`<div class="row"><div><h2>Student fee ledger</h2><div class="sub">${esc(child.name)} · Adm ${esc(child.adm || '—')}</div></div><button class="btn" data-close>Close</button></div>
      <div class="kpis"><div class="kpi"><span>Total charged</span><b>PKR ${fmt(ledger.charged)}</b></div><div class="kpi"><span>Total received</span><b>PKR ${fmt(ledger.paid)}</b></div><div class="kpi a"><span>Outstanding / advance</span><b>PKR ${fmt(Math.abs(ledger.balance))}</b></div></div>
      <div class="row"><button class="btn p" data-ledger-view="monthly">Monthly view</button><button class="btn" data-ledger-view="transactions">Transaction statement</button><button class="btn" data-print>Print</button></div>
      <div class="tw" data-ledger-panel="monthly"><table><thead><tr><th>Month</th><th>Voucher</th><th>Fee</th><th class="r">Charged</th><th class="r">Paid</th><th class="r">Pending</th><th>Status</th></tr></thead><tbody>${monthly || '<tr><td colspan="7">No vouchers found.</td></tr>'}</tbody></table></div>
      <div class="tw" data-ledger-panel="transactions" hidden><table><thead><tr><th>Date</th><th>Voucher</th><th>Description</th><th class="r">Charge</th><th class="r">Paid</th><th class="r">Balance</th></tr></thead><tbody>${transactions || '<tr><td colspan="6">No transactions.</td></tr>'}</tbody></table></div>`);
    modal.onclick = event => {
      if (event.target === modal || event.target.closest('[data-close]')) { modal.remove(); activeModal = null; return; }
      const view = event.target.closest('[data-ledger-view]');
      if (view) modal.querySelectorAll('[data-ledger-panel]').forEach(panel => { panel.hidden = panel.dataset.ledgerPanel !== view.dataset.ledgerView; });
      if (event.target.closest('[data-print]')) window.print();
    };
  }

  function quickPromiseDate(days) {
    if (days === null) return '';
    const date = new Date();
    date.setDate(date.getDate() + days);
    return iso(date);
  }

  function openCall(key) {
    const family = familyByKey[key];
    if (!family || noLogs || !can('followups', 'a')) return;
    const modal = appendModal(`<div class="row"><div><h2>Record call</h2><div class="sub">${esc(family.title)} · ${esc(family.names)}</div></div><button class="btn" data-close>Close</button></div>
      <div class="kpis"><div class="kpi a"><span>Current balance due</span><b>PKR ${fmt(Math.max(0, family.pending))}</b></div></div>
      <div>${family.contacts.map(contact => `<a class="btn" href="tel:${esc(digits(contact.number))}">${esc(contact.number)}</a>`).join(' ') || '<span class="sub">No phone number saved.</span>'}</div>
      ${family.last ? `<div class="card"><b>Last call:</b> ${esc(OUT[family.last.outcome] || family.last.outcome || '—')} · ${esc(dateTimeText(family.last.call_date))}<div>${esc(family.last.remarks || '')}</div></div>` : ''}
      <form id="callForm"><label>Call outcome<select id="outcome">${Object.entries(OUT).map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join('')}</select></label>
        <label>Spoke with<input id="spokeWith" placeholder="Father / Mother / guardian"></label>
        <label>Promise date</label><div class="row"><input id="promiseDate" type="date"><button class="btn" type="button" data-promise="0">Today</button><button class="btn" type="button" data-promise="1">Tomorrow</button><button class="btn" type="button" data-promise="3">3 days</button><button class="btn" type="button" data-promise="7">1 week</button><button class="btn" type="button" data-promise="clear">Clear</button></div>
        <label>Promised amount (optional)<input id="promiseAmount" type="number" min="0" step="any" placeholder="PKR"></label>
        <label>Remarks<textarea id="remarks" rows="4" placeholder="Call notes"></textarea></label>
        <label>Caller name<input id="caller" value="${esc(localStorage.getItem('caller_name') || me()?.name || '')}"></label>
        <div class="err" id="callError"></div><div class="row"><button type="button" class="btn" data-close>Cancel</button><button class="btn p">Save call</button></div>
      </form>`);
    const form = $('#callForm', modal);
    modal.onclick = event => {
      if (event.target === modal || event.target.closest('[data-close]')) { modal.remove(); activeModal = null; return; }
      const promise = event.target.closest('[data-promise]');
      if (promise) $('#promiseDate', modal).value = promise.dataset.promise === 'clear' ? '' : quickPromiseDate(Number(promise.dataset.promise));
    };
    form.onsubmit = async event => {
      event.preventDefault();
      const outcome = $('#outcome', modal).value, promiseDate = $('#promiseDate', modal).value,
        remarks = $('#remarks', modal).value.trim(), caller = $('#caller', modal).value.trim();
      if ((outcome === 'promised' || outcome === 'callback') && !promiseDate) { $('#callError', modal).textContent = 'Promise / call-back date is required for this outcome.'; return; }
      if (outcome === 'other' && !remarks && !promiseDate) { $('#callError', modal).textContent = 'Enter remarks or a promise date.'; return; }
      const submit = $('button.p', form); submit.disabled = true;
      try {
        if (caller) localStorage.setItem('caller_name', caller);
        await api('call_logs', { method: 'POST', body: {
          family_key: family.key, family_label: family.title,
          children: family.kids.map(kid => `${kid.name} (${kid.cls || '-'})`).join(', '),
          student_keys: family.kids.map(kid => kid.key), call_date: new Date().toISOString(),
          outcome, spoke_with: $('#spokeWith', modal).value.trim() || null,
          promise_date: promiseDate || null,
          promise_amount: $('#promiseAmount', modal).value ? Number($('#promiseAmount', modal).value) : null,
          remarks: remarks || null, pending_at_call: family.pending, caller: caller || null
        } });
        modal.remove(); activeModal = null;
        bust(); await loadLogs(); buildFamilies(); refreshView();
      } catch (error) {
        $('#callError', modal).textContent = `Could not save call: ${error.message}`;
        submit.disabled = false;
      }
    };
  }

  function buildWhatsAppMessage(family, language) {
    const kids = family.kids.filter(kid => kid.net > 0.004);
    const lines = kids.map(kid => `• ${kid.name} (${kid.cls || '-'}): PKR ${fmt(kid.net)}`).join('\n');
    return language === 'ur'
      ? `Assalam-o-Alaikum! Concept School (Shibra Campus) ki taraf se fee reminder.\n\nAap ke bachon ki fee ka baqaya:\n${lines}\n\nTotal baqaya: PKR ${fmt(family.pending)}\n\nMeherbani farma kar jald ada kar dein. Shukriya!`
      : `Assalam-o-Alaikum! This is a fee reminder from Concept School (Shibra Campus).\n\nOutstanding fee for your children:\n${lines}\n\nTotal outstanding: PKR ${fmt(family.pending)}\n\nKindly clear the dues at your earliest convenience. Thank you!`;
  }
  function openWhatsApp(key, selectedPhone = '') {
    const family = familyByKey[key];
    if (!family || family.pending <= 0.004) return alert('This family has no outstanding dues.');
    const contacts = family.contacts;
    const selectedNumber = selectedPhone ? phoneForWhatsApp(selectedPhone) : '';
    const modal = appendModal(`<div class="row"><div><h2>WhatsApp fee reminder</h2><div class="sub">${esc(family.title)} · ${esc(family.names)}</div></div><button class="btn" data-close>Close</button></div>
      <label>Send to<select id="waNumber">${contacts.map(contact => {
        const number = phoneForWhatsApp(contact.number);
        return `<option value="${esc(number)}" ${number === selectedNumber ? 'selected' : ''}>${esc(contact.label)}: ${esc(contact.number)}</option>`;
      }).join('') || '<option value="">Choose a contact in WhatsApp</option>'}</select></label>
      <div class="row"><button class="btn p" data-language="en">English</button><button class="btn" data-language="ur">Roman Urdu</button></div>
      <label>Message<textarea id="waMessage" rows="9"></textarea></label><div class="row"><button class="btn" data-close>Cancel</button><button class="btn p" data-send>Open WhatsApp</button></div>`);
    let language = localStorage.getItem('followup_wa_language') === 'ur' ? 'ur' : 'en';
    $('#waMessage', modal).value = buildWhatsAppMessage(family, language);
    modal.onclick = event => {
      if (event.target === modal || event.target.closest('[data-close]')) { modal.remove(); activeModal = null; return; }
      const languageButton = event.target.closest('[data-language]');
      if (languageButton) {
        language = languageButton.dataset.language;
        localStorage.setItem('followup_wa_language', language);
        $('#waMessage', modal).value = buildWhatsAppMessage(family, language);
      }
      if (event.target.closest('[data-send]')) {
        const message = $('#waMessage', modal).value.trim(), number = $('#waNumber', modal).value;
        if (!message) return alert('Message is empty.');
        window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
        modal.remove(); activeModal = null;
      }
    };
  }

  function openAssignments(key) {
    const family = familyByKey[key];
    if (!family || !canAssign) return;
    if (!Array.isArray(D.assignments) || !Array.isArray(D.assignees)) return alert('Please install the updated follow-up assignment SQL before managing assignments.');
    const rows = assignments.filter(item => item.family_key === key), familyAssignment = rows.find(item => item.scope_type === 'family');
    const options = selected => `<option value="">Not assigned</option>${assignees.map(user => {
      const email = String(user.email || '').toLowerCase();
      return `<option value="${esc(email)}" ${email === norm(selected) ? 'selected' : ''}>${esc(user.name || email)}${user.role ? ` · ${esc(user.role)}` : ''}</option>`;
    }).join('')}`;
    const modal = appendModal(`<div class="row"><div><h2>Manage follow-up assignments</h2><div class="sub">${esc(family.title)} · ${esc(family.names)}</div></div><button class="btn" data-close>Close</button></div>
      <label>Assign entire family<select id="familyAssignee">${options(familyAssignment?.assignee_email)}</select></label>
      <h3>Individual student assignments</h3>${family.kids.map(kid => {
        const assignment = rows.find(item => item.scope_type === 'student' && item.scope_key === kid.key);
        return `<label>${esc(kid.name)} · ${esc(kid.cls || '—')}<select data-student-assignment="${esc(kid.key)}">${options(assignment?.assignee_email)}</select></label>`;
      }).join('')}
      <div class="sub">A student can have an individual assignee; a family assignment applies to the whole family.</div>
      <div class="err" id="assignmentError"></div><div class="row"><button class="btn" data-close>Cancel</button><button class="btn p" data-save-assignment>Save assignments</button></div>`);
    modal.onclick = async event => {
      if (event.target === modal || event.target.closest('[data-close]')) { modal.remove(); activeModal = null; return; }
      if (!event.target.closest('[data-save-assignment]')) return;
      const button = event.target.closest('[data-save-assignment]'); button.disabled = true;
      try {
        await api('rpc/app_followup_save_assignments', { method: 'POST', body: {
          p_family_key: key,
          p_family_email: $('#familyAssignee', modal).value || null,
          p_students: [...modal.querySelectorAll('[data-student-assignment]')].map(select => ({
            student_key: select.dataset.studentAssignment, email: select.value || null
          }))
        } });
        modal.remove(); activeModal = null;
        bust();
        const refreshed = await api('rpc/app_followup_data', { cache: false });
        D = refreshed.rows;
        updateAssignmentData(D);
        await loadLogs(); buildFamilies(); refreshView();
      } catch (error) {
        $('#assignmentError', modal).textContent = `Could not save assignments: ${error.message}`;
        button.disabled = false;
      }
    };
  }

  async function deleteLog(id) {
    if (!can('followups', 'd') || !await ask('Delete this call record permanently?')) return;
    try {
      await api(`call_logs?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      bust(); await loadLogs(); buildFamilies(); refreshView();
    } catch (error) { alert(`Could not delete call: ${error.message}`); }
  }

  function exportHistory() {
    const query = $('#historySearch').value.trim().toLowerCase(), outcome = $('#historyOutcome').value,
      from = $('#historyFrom').value, to = $('#historyTo').value;
    const rows = logs.filter(log => {
      const day = String(log.call_date || '').slice(0, 10);
      const text = `${log.family_label || ''} ${log.children || ''} ${log.spoke_with || ''} ${log.caller || ''} ${log.remarks || ''}`.toLowerCase();
      return (!outcome || log.outcome === outcome) && (!from || day >= from) && (!to || day <= to) && (!query || text.includes(query));
    });
    if (!rows.length) return alert('No call records to export.');
    const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const data = [['Date / time', 'Family', 'Students', 'Outcome', 'Spoke with', 'Promise date', 'Promise amount', 'Remarks', 'Pending at call', 'Caller'],
      ...rows.map(log => [dateTimeText(log.call_date), log.family_label, log.children, OUT[log.outcome] || log.outcome, log.spoke_with, log.promise_date, log.promise_amount, log.remarks, log.pending_at_call, log.caller])];
    const blob = new Blob(['\ufeff' + data.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `follow-up-calls-${today}.csv`; link.click();
    URL.revokeObjectURL(link.href);
  }

  const searchFields = ['q', 'c', 's', 'status', 'sort', 'pendingOnly'];
  searchFields.forEach(id => $('#' + id).addEventListener(id === 'q' ? 'input' : 'change', () => { page = 0; refreshView(); }));
  $('#prev').onclick = () => { page--; refreshView(); };
  $('#next').onclick = () => { page++; refreshView(); };
  $('#familiesTab').onclick = () => { historyTab = false; refreshView(); };
  $('#historyTab').onclick = () => { historyTab = true; refreshView(); };
  ['historySearch', 'historyOutcome', 'historyFrom', 'historyTo'].forEach(id => $('#' + id).addEventListener(id === 'historySearch' ? 'input' : 'change', drawHistory));
  $('#exportHistory').onclick = exportHistory;
  $('#printCalls').onclick = () => window.print();
  $('#expandAll').onclick = () => document.querySelectorAll('#familyList details').forEach(details => { details.open = true; });
  $('#collapseAll').onclick = () => document.querySelectorAll('#familyList details').forEach(details => { details.open = false; });
  $('#familyList').onclick = event => {
    const target = event.target.closest('[data-ledger], [data-call], [data-whatsapp], [data-wa-contact], [data-assign], [data-toggle-details], [data-delete-log]');
    if (!target) return;
    if (target.dataset.ledger) openLedger(target.dataset.ledger);
    else if (target.dataset.call) openCall(target.dataset.call);
    else if (target.dataset.whatsapp) openWhatsApp(target.dataset.whatsapp);
    else if (target.dataset.waContact) openWhatsApp(target.dataset.waContact, target.dataset.waPhone);
    else if (target.dataset.assign) openAssignments(target.dataset.assign);
    else if (target.dataset.toggleDetails) {
      const card = target.closest('.followup-card'), details = card?.querySelector('.followup-details');
      if (details) {
        details.open = !details.open;
        const family = familyByKey[target.dataset.toggleDetails];
        target.setAttribute('aria-expanded', String(details.open));
        target.textContent = `${details.open ? '▲ Hide' : '▼ Details'} & call history (${family?.logs.length || 0})`;
      }
    }
    else if (target.dataset.deleteLog) deleteLog(target.dataset.deleteLog);
  };
  $('#historyTable').onclick = event => {
    const button = event.target.closest('[data-delete-log]');
    if (button) deleteLog(button.dataset.deleteLog);
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeModal) {
      activeModal.remove(); activeModal = null;
    }
  });
  refreshView();
}
