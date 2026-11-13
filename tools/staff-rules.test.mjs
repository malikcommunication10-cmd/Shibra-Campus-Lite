import assert from 'node:assert/strict';
import test from 'node:test';
import { calcStaffPayroll, eligibleStaffMonthDays, monthDays, qualifiesForNoLeaveBonus, summarizeAttendance } from '../js/staff-rules.js';

test('payroll calculation uses a 30-day salary basis and caps deductions at zero net', () => {
  const result = calcStaffPayroll({ baseSalary: 30000, leaves: 2, lateCount: 6, bonus: 1000, fine: 500 });
  assert.equal(result.daily, 1000);
  assert.equal(result.leaveDeduction, 2000);
  assert.equal(result.lateDeduction, 2000);
  assert.equal(result.net, 26500);
  assert.equal(calcStaffPayroll({ baseSalary: 1000, leaves: 30 }).net, 0);
});

test('working dates exclude Sundays and validate the month format', () => {
  const dates = monthDays('2026-11');
  assert.equal(dates.length, 25);
  assert.ok(dates.every(date => new Date(`${date}T00:00:00`).getDay() !== 0));
  assert.throws(() => monthDays('2026-13'), /YYYY-MM/);
});

test('payroll attendance dates honor joining dates and leaving status', () => {
  assert.deepEqual(eligibleStaffMonthDays('2026-11', '2026-11-03', null, 'Active')[0], '2026-11-03');
  assert.equal(eligibleStaffMonthDays('2026-11', null, '2026-11-06', 'Left').at(-1), '2026-11-06');
  assert.equal(eligibleStaffMonthDays('2026-11', null, '2026-10-31', 'Left').length, 0);
});

test('attendance summary counts unique expected dates and exemptions', () => {
  const expected = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
  const result = summarizeAttendance([
    { attendance_date: '2026-11-02', status: 'present' },
    { attendance_date: '2026-11-03', status: 'absent', absence_exempt: true },
    { attendance_date: '2026-11-04', status: 'late' },
    { attendance_date: '2026-11-05', status: 'late' },
    { attendance_date: '2026-11-06', status: 'late', late_exempt: true },
    { attendance_date: '2026-11-07', status: 'absent' },
  ], expected);
  assert.deepEqual(result, {
    workingDays: 5, attendanceDays: 4, absenceCount: 1, excusedLeaves: 1, leaves: 0,
    lateCount: 2, excusedLates: 1, lateDeductionDays: 0
  });
});

test('no-leave bonus requires zero absences, exemptions, and entered leave', () => {
  assert.equal(qualifiesForNoLeaveBonus({ absenceCount: 0, excusedLeaves: 0, leaves: 0 }), true);
  assert.equal(qualifiesForNoLeaveBonus({ absenceCount: 1, excusedLeaves: 0, leaves: 1 }), false);
  assert.equal(qualifiesForNoLeaveBonus({ absenceCount: 1, excusedLeaves: 1, leaves: 0 }), false);
});
