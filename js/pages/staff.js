import { all, api, bust, can, me, ask, $, esc, pkr } from '../core.js';
import { iso, fmt } from '../util.js';
import { calcStaffPayroll, eligibleStaffMonthDays, monthDays, qualifiesForNoLeaveBonus, summarizeAttendance } from '../staff-rules.js';

const ACTIVE = staff => String(staff.status || 'Active').trim().toLowerCase() === 'active';
const err = value => String(value?.message || value || 'Request failed');
const monthNow = () => iso(new Date()).slice(0, 7);
const amount = value => Math.max(0, Number(value) || 0);

export default async function (el) {
  let staff = [], payroll = [], allPayroll = [], attendance = [], payments = [], advances = [], increments = [];
  let advancesReady = false, incrementsReady = false, advancesError = '', incrementsError = '';
  let tab = 'directory', query = '', statusFilter = 'Active';
  let month = monthNow(), attendanceDate = iso(new Date()), notice = '';
  const root = el;
  root.innerHTML = '<div class="msg">Loading staff records...</div>';

  async function loadStaff() {
    staff = await all('staff?select=*&order=staff_name.asc');
  }
  async function loadPayroll() {
    payroll = await all(`payroll?select=*&month=eq.${encodeURIComponent(month)}&order=staff_name.asc`);
  }
  async function loadAllPayroll() {
    allPayroll = await all('payroll?select=id,staff_id,staff_name,month,net_salary,paid_amount,status,advance,advance_id&order=month.desc');
  }
  async function loadAttendance() {
    const date = encodeURIComponent(attendanceDate);
    attendance = await all(`staff_attendance?select=staff_id,staff_name,attendance_date,status,time_in,time_out,note,absence_exempt,late_exempt&attendance_date=eq.${date}`);
  }
  async function loadPayments() {
    payments = await all('staff_payroll_payments?select=*&order=payment_date.desc');
  }
  async function loadAdvances() {
    advances = await all('staff_salary_advances?select=*&order=effective_month.desc');
    advancesReady = true;
  }
  async function loadIncrements() {
    increments = await all('staff_salary_increments?select=*&order=effective_month.desc');
    incrementsReady = true;
  }
  try {
    await loadStaff();
    await Promise.all([loadPayroll(), loadAllPayroll(), loadAttendance(), loadPayments()]);
  } catch (error) {
    root.innerHTML = `<div class="msg err">Staff setup or access is unavailable: ${esc(err(error))}. Confirm the staff table and run <b>sql/supabase_staff_attendance.sql</b> in Supabase if the payroll or attendance tables are missing.</div>`;
    return;
  }
  try { await loadAdvances(); } catch (error) { advancesReady = false; advancesError = err(error); advances = []; }
  try { await loadIncrements(); } catch (error) { incrementsReady = false; incrementsError = err(error); increments = []; }

  const activeStaff = () => staff.filter(ACTIVE);
  const staffById = id => staff.find(item => String(item.staff_id) === String(id));
  const payrollFor = id => payroll.find(item => String(item.staff_id) === String(id));
  const paymentsFor = id => payments.filter(item => String(item.payroll_id) === String(id));
  const paidTotal = row => paymentsFor(row.id).reduce((sum, item) => sum + amount(item.amount), 0);
  const balance = row => Math.max(0, amount(row.net_salary) - Math.max(amount(row.paid_amount), paidTotal(row)));
  const displayName = row => row.staff_name || row.staff_id || 'Staff member';
  const salaryForMonth = (person, targetMonth) => {
    const applicable = increments
      .filter(item => String(item.staff_id) === String(person.staff_id) && item.effective_month <= targetMonth)
      .sort((a, b) => b.effective_month.localeCompare(a.effective_month))[0];
    return Number(applicable?.new_salary ?? person.base_salary ?? person.salary) || 0;
  };
  const advanceRecovered = id => allPayroll
    .filter(row => Number(row.advance_id) === Number(id))
    .reduce((sum, row) => sum + amount(row.advance), 0);
  const activeAdvance = (person, targetMonth) => advances
    .filter(item => String(item.staff_id) === String(person.staff_id) && item.effective_month <= targetMonth)
    .sort((a, b) => a.effective_month.localeCompare(b.effective_month) || Number(a.id) - Number(b.id))
    .find(item => amount(item.principal) - advanceRecovered(item.id) > 0.005);
  const message = (text, bad = false) => { notice = text ? `<div class="msg${bad ? ' err' : ''}">${esc(text)}</div>` : ''; render(); };

  function render() {
    const canAdd = can('staff', 'a'), canEdit = can('staff', 'e');
    root.innerHTML = `${notice}
      <div class="tabs">
        <button data-tab="directory" class="${tab === 'directory' ? 'on' : ''}">Staff directory</button>
        <button data-tab="attendance" class="${tab === 'attendance' ? 'on' : ''}">Daily attendance</button>
        <button data-tab="payroll" class="${tab === 'payroll' ? 'on' : ''}">Payroll</button>
        <button data-tab="increments" class="${tab === 'increments' ? 'on' : ''}">Salary increments</button>
        <button data-tab="advances" class="${tab === 'advances' ? 'on' : ''}">Salary advances</button>
        <button data-tab="history" class="${tab === 'history' ? 'on' : ''}">Payment history</button>
      </div>
      ${tab === 'directory' ? directoryMarkup(canAdd, canEdit) : ''}
      ${tab === 'attendance' ? attendanceMarkup(canEdit) : ''}
      ${tab === 'payroll' ? payrollMarkup(canAdd, canEdit) : ''}
      ${tab === 'increments' ? incrementsMarkup(canEdit) : ''}
      ${tab === 'advances' ? advancesMarkup(canAdd, canEdit) : ''}
      ${tab === 'history' ? paymentMarkup() : ''}`;
    root.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => { tab = button.dataset.tab; render(); });
    bindDirectory();
    bindAttendance();
    bindPayroll();
    bindIncrements();
    bindAdvances();
    bindHistory();
  }

  function incrementsMarkup(canEdit) {
    if (!incrementsReady) return `<div class="msg err">${esc(incrementsError)}<br>Salary increment setup may be missing; verify <b>sql/supabase_staff_increments.sql</b> is installed and your Staff view permission is enabled.</div>`;
    const active = activeStaff();
    return `<div class="bar"><label>Effective month <input id="incrementMonth" type="month" value="${esc(monthNow())}"></label>
      <select id="incrementMethod" aria-label="Increment method"><option value="percentage">Percentage</option><option value="fixed">Fixed PKR amount</option></select>
      <input id="incrementValue" type="number" min="0.01" step="0.01" placeholder="Increase amount" aria-label="Increment amount">
      <input id="incrementNote" maxlength="300" placeholder="Reason" aria-label="Reason">
      ${canEdit ? '<button class="btn p" id="scheduleIncrement">Apply increment</button>' : ''}</div>
      <div class="bar"><b>Select staff for this increment:</b><button class="btn" id="toggleAllIncrement" type="button">Select all</button></div>
      <div class="card" style="padding:12px;display:flex;flex-wrap:wrap;gap:12px">
        ${active.map(person => `<label><input type="checkbox" data-increment-staff value="${esc(person.staff_id)}"> ${esc(displayName(person))}</label>`).join('') || '<span>No active staff.</span>'}
      </div>
      <div class="card"><div class="tw"><table><thead><tr><th>Staff</th><th>Effective</th><th>Method</th><th class="r">Previous salary</th><th class="r">Increase</th><th class="r">New salary</th><th>Reason</th><th></th></tr></thead><tbody>
      ${increments.map(item => `<tr><td>${esc(item.staff_name)}</td><td>${esc(item.effective_month)}</td><td>${item.method === 'percentage' ? `${pkr(item.percentage)}%` : 'Fixed'}</td>
        <td class="r">${pkr(item.previous_salary)}</td><td class="r">${pkr(item.increase_amount)}</td><td class="r">${pkr(item.new_salary)}</td><td>${esc(item.notes)}</td>
        <td>${canEdit ? `<button class="btn" data-reschedule="${esc(item.id)}" data-current="${esc(item.effective_month)}">Change month</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8">No salary increments recorded.</td></tr>'}</tbody></table></div></div>
      <div class="card" style="padding:14px"><b>Current monthly salary</b><div class="tw"><table><thead><tr><th>Staff</th><th>Base salary</th><th>Current effective salary</th></tr></thead><tbody>
        ${active.map(person => `<tr><td>${esc(displayName(person))}</td><td class="r">${pkr(person.base_salary)}</td><td class="r">${pkr(salaryForMonth(person, monthNow()))}</td></tr>`).join('') || '<tr><td colspan="3">No active staff.</td></tr>'}</tbody></table></div></div>`;
  }

  function bindIncrements() {
    const button = $('#scheduleIncrement', root);
    if (button) button.onclick = scheduleIncrement;
    const toggleAll = $('#toggleAllIncrement', root);
    if (toggleAll) toggleAll.onclick = () => {
      const boxes = [...root.querySelectorAll('[data-increment-staff]')];
      const select = boxes.some(box => !box.checked);
      boxes.forEach(box => { box.checked = select; });
      toggleAll.textContent = select ? 'Clear selection' : 'Select all';
    };
    root.querySelectorAll('[data-reschedule]').forEach(control => control.onclick = () => rescheduleIncrement(control.dataset.reschedule, control.dataset.current));
  }

  async function scheduleIncrement() {
    const monthValue = $('#incrementMonth', root).value, method = $('#incrementMethod', root).value;
    const value = Number($('#incrementValue', root).value), notes = $('#incrementNote', root).value.trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthValue)) return message('Choose a valid effective month.', true);
    if (!Number.isFinite(value) || value <= 0 || Math.round(value * 100) / 100 !== value) return message('Enter an increment greater than zero with at most two decimal places.', true);
    if (method === 'percentage' && value > 100) return message('Percentage increment cannot exceed 100%.', true);
    if (!notes) return message('Enter the reason for this salary increment.', true);
    const ids = [...root.querySelectorAll('[data-increment-staff]:checked')].map(control => control.value);
    if (!ids.length) return message('Select at least one active staff member for this increment.', true);
    const names = ids.map(id => displayName(staffById(id))).join(', ');
    if (!await ask(`Apply a ${method === 'percentage' ? `${value}%` : `PKR ${pkr(value)}`} increment from ${monthValue} to ${names}?`)) return;
    try {
      await api('rpc/schedule_staff_salary_increment', {
        method: 'POST',
        body: { p_staff_ids: ids, p_method: method, p_value: value, p_effective_month: monthValue, p_notes: notes }
      });
      bust(); await Promise.all([loadIncrements(), loadPayroll(), loadAllPayroll()]);
      message(`Salary increments applied from ${monthValue}.`);
    } catch (error) { message(err(error), true); }
  }

  async function rescheduleIncrement(id, currentMonth) {
    const value = prompt(`Enter the new effective month (YYYY-MM). Current: ${currentMonth}`, currentMonth);
    if (value === null || !value.trim() || value.trim() === currentMonth) return;
    const target = value.trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(target)) return message('Effective month must use YYYY-MM format.', true);
    if (!await ask(`Change this increment month from ${currentMonth} to ${target}? Existing payroll is not recalculated.`)) return;
    try {
      await api('rpc/reschedule_staff_salary_increment', {
        method: 'POST', body: { p_increment_id: Number(id), p_effective_month: target }
      });
      bust(); await Promise.all([loadIncrements(), loadPayroll()]);
      message(`Increment effective month changed to ${target}. Existing payroll remains unchanged.`);
    } catch (error) { message(err(error), true); }
  }

  function advancesMarkup(canAdd, canEdit) {
    if (!advancesReady) return `<div class="msg err">${esc(advancesError)}<br>Salary advance setup may be missing; verify <b>sql/supabase_staff_advances.sql</b> is installed and your Staff view permission is enabled.</div>`;
    const outstanding = advances.map(item => ({
      ...item, recovered: advanceRecovered(item.id),
      remaining: Math.max(0, amount(item.principal) - advanceRecovered(item.id))
    }));
    return `<div class="bar">${canAdd || canEdit ? '<button class="btn p" id="newAdvance">+ Record salary advance</button>' : ''}</div>
      <p class="sub">Advances are paid from Cash or Bank, posted to Accounts, and automatically recovered from payroll starting at the effective month.</p>
      <div class="card"><div class="tw"><table><thead><tr><th>Staff</th><th>Disbursed</th><th>Effective month</th><th>Account</th><th class="r">Principal</th><th class="r">Monthly deduction</th><th class="r">Recovered</th><th class="r">Remaining</th><th>Voucher</th><th>Notes</th></tr></thead><tbody>
      ${outstanding.map(item => `<tr><td>${esc(item.staff_name)}</td><td>${esc(item.disbursed_date)}</td><td>${esc(item.effective_month)}</td><td>${esc(item.disbursement_account)}</td>
        <td class="r">${pkr(item.principal)}</td><td class="r">${pkr(item.monthly_deduction)}</td><td class="r">${pkr(item.recovered)}</td><td class="r">${pkr(item.remaining)}</td><td>${esc(item.voucher_id)}</td><td>${esc(item.notes)}</td></tr>`).join('') || '<tr><td colspan="10">No salary advances recorded.</td></tr>'}</tbody></table></div></div>`;
  }

  function bindAdvances() {
    const button = $('#newAdvance', root);
    if (button) button.onclick = openAdvanceForm;
  }

  function openAdvanceForm() {
    const people = activeStaff();
    if (!people.length) return message('No active staff members are available.', true);
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<form class="box"><h2>Record salary advance</h2>
      <label>Staff member<select id="advanceStaff">${people.map(person => `<option value="${esc(person.staff_id)}">${esc(displayName(person))} · ${esc(person.staff_id)}</option>`).join('')}</select></label>
      <label>Advance amount<input id="advancePrincipal" type="number" min="0.01" step="0.01" required></label>
      <label>Monthly recovery<input id="advanceMonthly" type="number" min="0.01" step="0.01" required></label>
      <label>Effective month<input id="advanceMonth" type="month" value="${esc(monthNow())}" required></label>
      <label>Disbursement date<input id="advanceDate" type="date" value="${iso(new Date())}" required></label>
      <label>Paid from<select id="advanceAccount"><option value="cash">Cash<option value="bank">Bank</select></label>
      <label>Notes<input id="advanceNotes" maxlength="500"></label>
      <div id="advanceError" class="err"></div><div class="row"><button class="btn" type="button" id="cancelAdvance">Cancel</button><button class="btn p">Save advance</button></div></form>`;
    document.body.appendChild(modal);
    const close = () => modal.remove(), form = $('form', modal), submit = $('.p', modal);
    $('#cancelAdvance', modal).onclick = close;
    form.onsubmit = async event => {
      event.preventDefault();
      const person = staffById($('#advanceStaff', modal).value);
      const principal = Number($('#advancePrincipal', modal).value), monthly = Number($('#advanceMonthly', modal).value);
      const effective = $('#advanceMonth', modal).value, date = $('#advanceDate', modal).value;
      const account = $('#advanceAccount', modal).value, notes = $('#advanceNotes', modal).value.trim();
      if (!person || ![principal, monthly].every(value => Number.isFinite(value) && value > 0) ||
          [principal, monthly].some(value => Math.round(value * 100) / 100 !== value) || monthly > principal) {
        return $('#advanceError', modal).textContent = 'Enter valid positive amounts with at most two decimals; monthly recovery cannot exceed the advance.';
      }
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(effective) || !date || effective < date.slice(0, 7)) {
        return $('#advanceError', modal).textContent = 'Choose a valid effective month that is not before the disbursement date.';
      }
      if (!await ask(`Record PKR ${pkr(principal)} advance for ${displayName(person)} from ${account} on ${date}? It will be posted to the accounts ledger.`)) return;
      submit.disabled = true;
      try {
        const result = await api('rpc/lite_record_staff_salary_advance', {
          method: 'POST',
          body: {
            p_staff_id: person.staff_id, p_principal: principal, p_monthly_deduction: monthly,
            p_effective_month: effective, p_disbursed_date: date, p_account: account, p_notes: notes || null
          }
        });
        const voucher = result.rows?.voucher_id;
        close(); bust();
        try {
          await Promise.all([loadAdvances(), loadAllPayroll()]);
          message(`Salary advance recorded${voucher ? ` · voucher ${voucher}` : ''}.`);
        } catch (refreshError) {
          message(`Salary advance${voucher ? ` · voucher ${voucher}` : ''} was saved, but refreshing records failed: ${err(refreshError)}`, true);
        }
      } catch (error) {
        $('#advanceError', modal).textContent = /lite_record_staff_salary_advance|schema cache|function .* not found/i.test(err(error))
          ? 'Atomic salary advance setup is missing. Run sql/supabase_staff_advances.sql in Supabase, then retry.'
          : err(error);
      } finally { if (submit.isConnected) submit.disabled = false; }
    };
  }

  function directoryMarkup(canAdd, canEdit) {
    const list = staff.filter(item => (statusFilter === 'All' || (ACTIVE(item) ? 'Active' : 'Left') === statusFilter) &&
      (!query || `${item.staff_id} ${item.staff_name} ${item.designation} ${item.phone}`.toLowerCase().includes(query.toLowerCase())));
    return `<div class="bar"><input id="staffSearch" type="search" value="${esc(query)}" placeholder="Search name, ID, designation or phone" aria-label="Search staff">
      <select id="staffStatus" aria-label="Staff status"><option ${statusFilter === 'Active' ? 'selected' : ''}>Active<option ${statusFilter === 'Left' ? 'selected' : ''}>Left<option ${statusFilter === 'All' ? 'selected' : ''}>All</select>
      ${canAdd ? '<button class="btn p" id="addStaff">+ Add staff</button>' : ''}</div>
      <div class="card"><div class="tw"><table><thead><tr><th>Staff ID</th><th>Name</th><th>Designation</th><th>Phone</th><th class="r">Base salary</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map(item => `<tr><td>${esc(item.staff_id)}</td><td>${esc(displayName(item))}</td><td>${esc(item.designation)}</td><td>${esc(item.phone)}</td><td class="r">${pkr(item.base_salary)}</td>
      <td><span class="tag ${ACTIVE(item) ? '' : 'u'}">${ACTIVE(item) ? 'Active' : 'Left'}</span></td><td>${canEdit ? `<button class="btn" data-edit="${esc(item.staff_id)}">Edit</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7">No staff match these filters.</td></tr>'}</tbody></table></div></div>`;
  }

  function bindDirectory() {
    const search = $('#staffSearch', root);
    if (search) search.oninput = () => { query = search.value; render(); const next = $('#staffSearch', root); next.focus(); next.setSelectionRange(query.length, query.length); };
    const status = $('#staffStatus', root);
    if (status) status.onchange = () => { statusFilter = status.value; render(); };
    const add = $('#addStaff', root);
    if (add) add.onclick = () => staffForm(null);
    root.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => staffForm(staffById(button.dataset.edit)));
  }

  function staffForm(person) {
    const isNew = !person;
    let staffId = person?.staff_id || '';
    if (isNew) {
      do { staffId = `STF-${Math.floor(100000 + Math.random() * 900000)}`; }
      while (staff.some(item => String(item.staff_id) === staffId));
    }
    const value = key => esc(person?.[key] ?? '');
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<form class="box" style="max-width:620px"><h2>${isNew ? 'Add staff member' : 'Edit staff member'}</h2>
      <div class="cols" style="gap:10px">
        <label>Staff ID<input id="sid" value="${esc(staffId)}" readonly required></label>
        <label>Full name<input id="sname" value="${value('staff_name')}" required></label>
        <label>Designation<input id="desig" value="${value('designation')}"></label>
        <label>Joining date<input id="joining" type="date" value="${value('joining_date')}" required></label>
        <label>Base monthly salary<input id="salary" type="number" min="0" step="0.01" value="${value('base_salary')}" required></label>
        <label>Phone<input id="phone" value="${value('phone')}"></label>
        <label>Status<select id="sstatus"><option value="Active" ${ACTIVE(person || {}) ? 'selected' : ''}>Active<option value="Left" ${person && !ACTIVE(person) ? 'selected' : ''}>Left</select></label>
        <label>Leaving date<input id="leaving" type="date" value="${value('leaving_date')}"></label>
        <label>Notes<input id="notes" value="${value('notes')}"></label>
      </div><div id="formError" class="err"></div><div class="row"><button class="btn" type="button" id="cancel">Cancel</button><button class="btn p">Save</button></div></form>`;
    document.body.appendChild(modal);
    const close = () => modal.remove(), field = id => $('#' + id, modal);
    $('#cancel', modal).onclick = close;
    $('form', modal).onsubmit = async event => {
      event.preventDefault();
      const salary = Number(field('salary').value);
      if (!Number.isFinite(salary) || salary < 0) return $('#formError', modal).textContent = 'Enter a valid non-negative salary.';
      const payload = {
        staff_id: field('sid').value.trim(), staff_name: field('sname').value.trim(),
        designation: field('desig').value.trim() || null, joining_date: field('joining').value,
        base_salary: salary,
        phone: field('phone').value.trim() || null, status: field('sstatus').value,
        leaving_date: field('leaving').value || null, notes: field('notes').value.trim() || null
      };
      if (!payload.staff_id || !payload.staff_name) return $('#formError', modal).textContent = 'Staff ID and name are required.';
      try {
        if (isNew) await api('staff', { method: 'POST', body: payload });
        else await api(`staff?staff_id=eq.${encodeURIComponent(person.staff_id)}`, { method: 'PATCH', body: payload });
        close(); bust(); await loadStaff(); message('Staff record saved.');
      } catch (error) { $('#formError', modal).textContent = err(error); }
    };
  }

  function attendanceMarkup(canEdit) {
    const canAdd = can('staff', 'a');
    const byId = new Map(attendance.map(row => [String(row.staff_id), row]));
    const people = staff.filter(item => {
      const joined = String(item.joining_date || '').slice(0, 10);
      const left = String(item.leaving_date || '').slice(0, 10);
      return (!joined || joined <= attendanceDate) && (ACTIVE(item) || (left && left >= attendanceDate));
    });
    return `<div class="bar"><label>Attendance date <input id="attendanceDate" type="date" max="${iso(new Date())}" value="${esc(attendanceDate)}"></label>
      ${canEdit || canAdd ? '<button class="btn" id="markPresent">Mark all present</button><button class="btn p" id="saveAttendance">Save attendance</button>' : ''}</div>
      <p class="sub">Sundays are off. Existing day records are loaded from Supabase; saving is subject to the configured open-day rules.</p>
      <div class="card"><div class="tw"><table><thead><tr><th>Staff</th><th>Designation</th><th>Status</th><th>Note</th></tr></thead><tbody>
      ${people.map(item => { const row = byId.get(String(item.staff_id)); const allowed = row ? canEdit : canAdd; return `<tr><td>${esc(displayName(item))}</td><td>${esc(item.designation)}</td><td><select data-att-status="${esc(item.staff_id)}" ${!allowed || new Date(`${attendanceDate}T00:00:00`).getDay() === 0 ? 'disabled' : ''}>
        <option value="">Not marked</option><option value="present" ${row?.status === 'present' ? 'selected' : ''}>Present</option><option value="absent" ${row?.status === 'absent' ? 'selected' : ''}>Absent</option><option value="late" ${row?.status === 'late' ? 'selected' : ''}>Late</option></select></td>
        <td><input data-att-note="${esc(item.staff_id)}" value="${esc(row?.note || '')}" aria-label="Attendance note for ${esc(displayName(item))}" ${!allowed ? 'disabled' : ''}></td></tr>`; }).join('') || '<tr><td colspan="4">No active staff members.</td></tr>'}</tbody></table></div></div>`;
  }

  function bindAttendance() {
    const date = $('#attendanceDate', root);
    if (date) date.onchange = async () => {
      attendanceDate = date.value;
      try { await loadAttendance(); render(); } catch (error) { message(err(error), true); }
    };
    const mark = $('#markPresent', root);
    if (mark) mark.onclick = () => root.querySelectorAll('[data-att-status]').forEach(select => { if (!select.disabled) select.value = 'present'; });
    const save = $('#saveAttendance', root);
    if (save) save.onclick = async () => {
      if (!attendanceDate || attendanceDate > iso(new Date()) || new Date(`${attendanceDate}T00:00:00`).getDay() === 0) return message('Choose a working day today or earlier; Sundays do not have attendance.', true);
      const rows = [...root.querySelectorAll('[data-att-status]')].filter(select => select.value && !select.disabled).map(select => {
        const person = staffById(select.dataset.attStatus);
        const existing = attendance.find(item => String(item.staff_id) === String(person.staff_id));
        return {
          staff_id: person.staff_id, staff_name: displayName(person), attendance_date: attendanceDate,
          status: select.value, note: $(`[data-att-note="${CSS.escape(String(person.staff_id))}"]`, root)?.value.trim() || null,
          absence_exempt: existing?.absence_exempt || false, late_exempt: existing?.late_exempt || false
        };
      });
      if (!rows.length) return message('Select an attendance status for at least one staff member.', true);
      save.disabled = true;
      let inserted = 0, updated = 0;
      try {
        const inserts = rows.filter(row => !attendance.some(item => String(item.staff_id) === String(row.staff_id)));
        const updates = rows.filter(row => attendance.some(item => String(item.staff_id) === String(row.staff_id)));
        if (inserts.length) {
          await api('staff_attendance', { method: 'POST', body: inserts });
          inserted = inserts.length;
        }
        for (const row of updates) {
          await api(`staff_attendance?staff_id=eq.${encodeURIComponent(row.staff_id)}&attendance_date=eq.${encodeURIComponent(row.attendance_date)}`, {
            method: 'PATCH', body: { staff_name: row.staff_name, status: row.status, note: row.note }
          });
          updated++;
        }
        bust(); await loadAttendance(); message(`Attendance saved for ${rows.length} staff member${rows.length === 1 ? '' : 's'}.`);
      } catch (error) {
        let reloadIssue = '';
        bust();
        try { await loadAttendance(); } catch (reloadError) { reloadIssue = ` Could not refresh attendance: ${err(reloadError)}`; }
        const partial = inserted + updated ? `Saved ${inserted} new and ${updated} updated record(s) before the next write failed. ` : '';
        message(partial + err(error) + reloadIssue, true);
      }
      finally { if ($('#saveAttendance', root)) $('#saveAttendance', root).disabled = false; }
    };
  }

  function payrollMarkup(canAdd, canEdit) {
    const active = activeStaff();
    return `<div class="bar"><label>Salary month <input id="payMonth" type="month" value="${esc(month)}"></label>
      ${canAdd ? '<button class="btn p" id="generatePayroll">Generate missing payroll</button>' : ''}<button class="btn" id="refreshPayroll">Refresh</button></div>
      <p class="sub">Only completed months can be generated. Sundays and dates before joining/after leaving are excluded. Unmarked eligible workdays are recorded as Present; scheduled increments and advance recovery are applied. Existing payroll rows are never overwritten.</p>
      <div class="card"><div class="tw"><table><thead><tr><th>Staff</th><th>Work days</th><th>Present</th><th>Absent</th><th>Late</th><th class="r">Base</th><th class="r">Leave deduction</th><th class="r">Late deduction</th><th class="r">Bonus / fine</th><th class="r">Net salary</th><th>Status</th><th></th></tr></thead><tbody>
      ${active.map(person => {
        const row = payrollFor(person.staff_id);
        return row ? `<tr><td>${esc(displayName(person))}<small style="display:block;color:var(--mut)">${esc(person.designation)}</small></td>
          <td class="r">${esc(row.working_days)}</td><td class="r">${esc(row.attendance_days)}</td><td class="r">${esc(row.absence_count)}</td><td class="r">${esc(row.late_count)}</td>
          <td class="r">${pkr(row.base_salary)}</td><td class="r">${pkr(row.leave_deduction)}</td><td class="r">${pkr(row.late_deduction)}</td><td class="r">${pkr((Number(row.bonus) || 0) - (Number(row.fine) || 0))}</td>
          <td class="r"><b>${pkr(row.net_salary)}</b>${amount(row.paid_amount) ? `<small style="display:block;color:var(--mut)">Balance ${pkr(balance(row))}</small>` : ''}</td><td><span class="tag ${row.status === 'Paid' ? '' : 'pt'}">${esc(row.status || 'Unpaid')}</span></td>
          <td>${canEdit ? `<button class="btn" data-pay="${esc(row.id)}" ${balance(row) <= 0 ? 'disabled' : ''}>Pay</button> <button class="btn" data-adjust="${esc(row.id)}">Adjust</button>` : ''}</td></tr>` :
          `<tr><td>${esc(displayName(person))}<small style="display:block;color:var(--mut)">${esc(person.designation)}</small></td><td colspan="10" style="color:var(--mut)">Not generated</td><td></td></tr>`;
      }).join('') || '<tr><td colspan="12">No active staff members.</td></tr>'}</tbody></table></div></div>
      <div id="paySummary" class="sub"></div>`;
  }

  function bindPayroll() {
    const picker = $('#payMonth', root);
    if (picker) picker.onchange = async () => {
      month = picker.value;
      try { await loadPayroll(); render(); } catch (error) { message(err(error), true); }
    };
    const refresh = $('#refreshPayroll', root);
    if (refresh) refresh.onclick = async () => {
      try { await Promise.all([loadPayroll(), loadAllPayroll(), loadPayments()]); render(); } catch (error) { message(err(error), true); }
    };
    const generate = $('#generatePayroll', root);
    if (generate) generate.onclick = generateMissingPayroll;
    root.querySelectorAll('[data-pay]').forEach(button => button.onclick = () => openPay(payroll.find(row => String(row.id) === button.dataset.pay)));
    root.querySelectorAll('[data-adjust]').forEach(button => button.onclick = () => adjustPayroll(payroll.find(row => String(row.id) === button.dataset.adjust)));
    const total = payroll.reduce((sum, row) => sum + amount(row.net_salary), 0);
    const generated = payroll.reduce((sum, row) => sum + amount(row.paid_amount), 0);
    const summary = $('#paySummary', root);
    if (summary) summary.textContent = `Generated: ${payroll.length} · Net salary: PKR ${fmt(total)} · Paid: PKR ${fmt(generated)} · Outstanding: PKR ${fmt(Math.max(0, total - generated))}`;
  }

  async function generateMissingPayroll() {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return message('Choose a valid salary month.', true);
    const [year, value] = month.split('-').map(Number);
    const lastDate = `${month}-${String(new Date(year, value, 0).getDate()).padStart(2, '0')}`;
    if (lastDate > iso(new Date())) return message('Generate payroll only after the selected salary month has ended.', true);
    const expectedDates = monthDays(month);
    const missing = staff.filter(person =>
      eligibleStaffMonthDays(month, person.joining_date, person.leaving_date, person.status).length > 0 &&
      !payrollFor(person.staff_id)
    );
    if (!missing.length) return message('Payroll already exists for every active staff member in this month.');
    const from = `${month}-01`, to = `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()).padStart(2, '0')}`;
    let backfilled = 0;
    try {
      const monthAttendance = await all(`staff_attendance?select=staff_id,attendance_date,status,absence_exempt,late_exempt&attendance_date=gte.${from}&attendance_date=lte.${to}`);
      const attendanceKeys = new Set(monthAttendance.map(row => `${row.staff_id}|${String(row.attendance_date).slice(0, 10)}`));
      const attendanceBackfill = [];
      const datesByStaff = new Map(missing.map(person => [
        String(person.staff_id),
        eligibleStaffMonthDays(month, person.joining_date, person.leaving_date, person.status)
      ]));
      missing.forEach(person => datesByStaff.get(String(person.staff_id)).forEach(date => {
        const key = `${person.staff_id}|${date}`;
        if (!attendanceKeys.has(key)) attendanceBackfill.push({
          staff_id: person.staff_id, staff_name: displayName(person), attendance_date: date,
          status: 'present', note: null, absence_exempt: false, late_exempt: false
        });
      }));
      const completeAttendance = [...monthAttendance, ...attendanceBackfill];
      const rows = missing.map(person => {
        const personDates = datesByStaff.get(String(person.staff_id));
        const summary = summarizeAttendance(completeAttendance.filter(row => String(row.staff_id) === String(person.staff_id)), personDates);
        if (summary.excusedLates > 0 && me()?.role !== 'Admin') {
          throw Error(`Admin review is required to apply late exemptions for ${displayName(person)}.`);
        }
        const bonus = qualifiesForNoLeaveBonus(summary) ? Math.round(amount(person.base_salary) / 30) : 0;
        const baseSalary = salaryForMonth(person, month);
        const dueAdvance = activeAdvance(person, month);
        const preAdvance = calcStaffPayroll({ baseSalary, ...summary, bonus, lateDeductionDays: summary.lateDeductionDays });
        const advanceAmount = dueAdvance
          ? Math.min(amount(dueAdvance.monthly_deduction), amount(dueAdvance.principal) - advanceRecovered(dueAdvance.id), preAdvance.net)
          : 0;
        const computed = calcStaffPayroll({ baseSalary, ...summary, bonus, advance: advanceAmount, lateDeductionDays: summary.lateDeductionDays });
        return {
          staff_id: person.staff_id, staff_name: displayName(person), designation: person.designation || null, month,
          base_salary: baseSalary, leaves: summary.leaves, leave_deduction: computed.leaveDeduction,
          working_days: 30, absence_count: summary.absenceCount, excused_leaves: summary.excusedLeaves,
          late_count: summary.lateCount, excused_lates: summary.excusedLates, late_deduction_days: summary.lateDeductionDays,
          late_deduction: computed.lateDeduction, attendance_days: summary.attendanceDays, salary_days: 30,
          security_deduction: 0, bonus, fine: 0, advance: advanceAmount, ...(dueAdvance ? { advance_id: dueAdvance.id } : {}),
          net_salary: computed.net, paid_amount: 0,
          status: 'Unpaid', notes: `Generated from saved attendance${bonus ? '; includes no-leave bonus.' : '.'}`
        };
      });
      if (!await ask(`Generate ${rows.length} payroll records for ${month}? ${attendanceBackfill.length} unmarked workdays will be saved as Present. Existing payroll records will not be changed.`)) return;
      for (let index = 0; index < attendanceBackfill.length; index += 250) {
        await api('staff_attendance?on_conflict=staff_id,attendance_date', {
          method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
          body: attendanceBackfill.slice(index, index + 250)
        });
        backfilled += Math.min(250, attendanceBackfill.length - index);
      }
      await api('payroll?on_conflict=staff_id,month', {
        method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: rows
      });
      bust(); await Promise.all([loadPayroll(), loadAllPayroll(), loadPayments()]);
      message(`Generated payroll for ${rows.length} staff member${rows.length === 1 ? '' : 's'}; ${backfilled} missing attendance days were marked Present.`);
    } catch (error) { message(`${backfilled ? `Saved ${backfilled} attendance backfill row(s). ` : ''}${err(error)}`, true); }
  }

  function openPay(row) {
    if (!row) return;
    const due = balance(row);
    if (due <= 0) return message('There is no outstanding salary balance for this payroll record.');
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<form class="box"><h2>Record salary payment</h2><p>${esc(row.staff_name)} · ${esc(row.month)} · Outstanding PKR ${pkr(due)}</p>
      <label>Payment amount<input id="paymentAmount" type="number" min="0.01" max="${due}" step="0.01" value="${due}" required></label>
      <label>Payment date<input id="paymentDate" type="date" value="${iso(new Date())}" required></label>
      <label>Paid from<select id="paymentMode"><option value="cash">Cash<option value="bank">Bank<option value="online">Online</select></label>
      <label>Notes<input id="paymentNotes" maxlength="500"></label>
      <div id="paymentError" class="err"></div><div class="row"><button class="btn" type="button" id="cancelPayment">Cancel</button><button class="btn p">Save payment</button></div></form>`;
    document.body.appendChild(modal);
    const close = () => modal.remove(), form = $('form', modal), submit = $('.p', modal);
    $('#cancelPayment', modal).onclick = close;
    form.onsubmit = async event => {
      event.preventDefault();
      const payment = Number($('#paymentAmount', modal).value), date = $('#paymentDate', modal).value;
      const mode = $('#paymentMode', modal).value, notes = $('#paymentNotes', modal).value.trim();
      if (!Number.isFinite(payment) || payment <= 0 || Math.round(payment * 100) / 100 !== payment) {
        return $('#paymentError', modal).textContent = 'Enter a positive amount with at most two decimal places.';
      }
      if (payment > due) return $('#paymentError', modal).textContent = 'Payment cannot exceed the outstanding salary balance.';
      if (!date) return $('#paymentError', modal).textContent = 'Choose a payment date.';
      submit.disabled = true;
      try {
        const result = await api('rpc/lite_pay_staff_salary', {
          method: 'POST',
          body: {
            p_payroll_id: Number(row.id), p_amount: payment, p_payment_date: date,
            p_payment_mode: mode, p_notes: notes || null
          }
        });
        const voucher = result.rows?.voucher_no;
        close(); bust(); await Promise.all([loadPayroll(), loadAllPayroll(), loadPayments()]);
        message(`Salary payment recorded${voucher ? ` · voucher ${voucher}` : ''}.`);
      } catch (error) {
        const detail = err(error);
        $('#paymentError', modal).textContent = /lite_pay_staff_salary|schema cache|function .* not found/i.test(detail)
          ? 'Salary payment setup is missing. Run sql/supabase_staff_payments_lite.sql in Supabase, then retry.'
          : detail;
      } finally {
        if (submit.isConnected) submit.disabled = false;
      }
    };
  }

  function adjustPayroll(row) {
    if (!row) return;
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<form class="box"><h2>Adjust payroll</h2><p>${esc(row.staff_name)} · ${esc(row.month)}</p>
      <label>Salary days<input id="salaryDays" type="number" min="0" max="30" step="1" value="${Number(row.salary_days) || 0}" required></label>
      <label>Bonus<input id="bonus" type="number" min="0" step="0.01" value="${amount(row.bonus)}"></label>
      <label>Fine<input id="fine" type="number" min="0" step="0.01" value="${amount(row.fine)}"></label>
      <label>Reason / notes<input id="notes" value="${esc(row.notes || '')}" required></label>
      <div id="adjustError" class="err"></div><div class="row"><button class="btn" type="button" id="cancelAdjust">Cancel</button><button class="btn p">Save adjustment</button></div></form>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    $('#cancelAdjust', modal).onclick = close;
    $('form', modal).onsubmit = async event => {
      event.preventDefault();
      const salaryDays = Number($('#salaryDays', modal).value), bonus = Number($('#bonus', modal).value), fine = Number($('#fine', modal).value);
      if (!Number.isInteger(salaryDays) || salaryDays < 0 || salaryDays > 30) return $('#adjustError', modal).textContent = 'Salary days must be a whole number between 0 and 30.';
      if (![bonus, fine].every(value => Number.isFinite(value) && value >= 0)) return $('#adjustError', modal).textContent = 'Bonus and fine must be non-negative amounts.';
      const notes = $('#notes', modal).value.trim();
      if (!notes) return $('#adjustError', modal).textContent = 'Enter a reason for the adjustment.';
      const calculated = calcStaffPayroll({
        baseSalary: row.base_salary, leaves: row.leaves, bonus, fine, advance: row.advance,
        lateCount: row.late_count, salaryDays, security: row.security_deduction,
        lateDeductionDays: row.late_deduction_days
      });
      if (amount(row.paid_amount) > calculated.net) return $('#adjustError', modal).textContent = 'The adjusted net cannot be less than the amount already paid.';
      try {
        await api(`payroll?id=eq.${encodeURIComponent(row.id)}`, {
          method: 'PATCH',
          body: {
            salary_days: salaryDays, bonus, fine, notes, leave_deduction: calculated.leaveDeduction,
            late_deduction: calculated.lateDeduction, net_salary: calculated.net,
            status: amount(row.paid_amount) >= calculated.net && calculated.net > 0 ? 'Paid' : 'Unpaid'
          }
        });
        close(); bust(); await loadPayroll(); message('Payroll adjustment saved.');
      } catch (error) { $('#adjustError', modal).textContent = err(error); }
    };
  }

  function paymentMarkup() {
    const rows = payments.slice().sort((a, b) => String(b.payment_date).localeCompare(String(a.payment_date)));
    return `<div class="card"><div class="tw"><table><thead><tr><th>Date</th><th>Staff</th><th>Salary month</th><th>Voucher</th><th>Mode</th><th class="r">Amount</th><th>Notes</th></tr></thead><tbody>
      ${rows.map(item => {
        const row = allPayroll.find(pay => String(pay.id) === String(item.payroll_id));
        const person = row ? staffById(row.staff_id) : null;
        return `<tr><td>${esc(item.payment_date)}</td><td>${esc(person?.staff_name || row?.staff_name || '—')}</td><td>${esc(row?.month || '—')}</td><td>${esc(item.voucher_no)}</td><td>${esc(item.payment_mode)}</td><td class="r">${pkr(item.amount)}</td><td>${esc(item.notes)}</td></tr>`;
      }).join('') || '<tr><td colspan="7">No staff salary payments found.</td></tr>'}</tbody></table></div></div>
      <p class="sub">Lite records salary payments in the salary expense account, payment history and payroll balance through one atomic database function. Payment reversals and security refunds still require the original app.</p>`;
  }

  function bindHistory() {}

  render();
}
