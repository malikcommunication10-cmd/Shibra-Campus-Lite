export const PAYROLL_DIVISOR = 30;

export function qualifiesForNoLeaveBonus({ absenceCount, excusedLeaves, leaves }) {
  return Number(absenceCount) === 0 && Number(excusedLeaves) === 0 && Number(leaves) === 0;
}

export function calcStaffPayroll({ baseSalary, leaves = 0, bonus = 0, fine = 0, advance = 0, lateCount = 0, salaryDays = PAYROLL_DIVISOR, security = 0, lateDeductionDays }) {
  const base = Math.max(0, Number(baseSalary) || 0);
  const daily = base / PAYROLL_DIVISOR;
  const billableLeaves = Math.max(0, Number(leaves) || 0);
  const leaveDeduction = Math.round(daily * billableLeaves);
  const lateDays = lateDeductionDays === null || lateDeductionDays === undefined
    ? Math.floor(Math.max(0, Number(lateCount) || 0) / 3)
    : Math.max(0, Number(lateDeductionDays) || 0);
  const lateDeduction = Math.round(daily * lateDays);
  const salaryAmount = Math.round(daily * Math.min(PAYROLL_DIVISOR, Math.max(0, Number(salaryDays) || 0)));
  const beforeSecurity = Math.max(0, Math.round(salaryAmount - leaveDeduction - lateDeduction + (Number(bonus) || 0) - (Number(fine) || 0) - (Number(advance) || 0)));
  const securityDeduction = Math.max(0, Number(security) || 0);
  return {
    daily,
    leaves: billableLeaves,
    leaveDeduction,
    lateDays,
    lateDeduction,
    salaryAmount,
    securityDeduction,
    net: Math.max(0, beforeSecurity - securityDeduction)
  };
}

export function monthDays(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) throw Error('Salary month must use YYYY-MM format.');
  const [year, value] = month.split('-').map(Number);
  const days = [];
  for (let day = 1; day <= new Date(year, value, 0).getDate(); day++) {
    const date = new Date(year, value - 1, day);
    if (date.getDay() !== 0) days.push(`${month}-${String(day).padStart(2, '0')}`);
  }
  return days;
}

export function eligibleStaffMonthDays(month, joiningDate, leavingDate, status = 'Active') {
  const joined = String(joiningDate || '').slice(0, 10);
  const left = String(leavingDate || '').slice(0, 10);
  const active = String(status || 'Active').trim().toLowerCase() === 'active';
  return monthDays(month).filter(date =>
    (!joined || joined <= date) && (active || (left && left >= date))
  );
}

export function summarizeAttendance(rows, expectedDates) {
  const expected = new Set(expectedDates);
  const presentDates = new Set(), absentDates = new Set(), lateDates = new Set();
  let excusedLeaves = 0, excusedLates = 0;
  rows.forEach(row => {
    const date = String(row.attendance_date || '').slice(0, 10);
    if (!expected.has(date)) return;
    if (row.status === 'present') presentDates.add(date);
    else if (row.status === 'absent') {
      absentDates.add(date);
      if (row.absence_exempt) excusedLeaves++;
    } else if (row.status === 'late') {
      lateDates.add(date);
      if (row.late_exempt) excusedLates++;
    }
  });
  return {
    workingDays: expectedDates.length,
    attendanceDays: presentDates.size + lateDates.size,
    absenceCount: absentDates.size,
    excusedLeaves,
    leaves: Math.max(0, absentDates.size - excusedLeaves),
    lateCount: Math.max(0, lateDates.size - excusedLates),
    excusedLates,
    lateDeductionDays: Math.floor(Math.max(0, lateDates.size - excusedLates) / 3)
  };
}
