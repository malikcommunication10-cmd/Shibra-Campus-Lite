import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateVoucherPayments, effectiveMonth, filterFeeGenerationStudents, parseSchoolYear, periodEndDate, tuitionFeeForPeriod } from '../js/fee-rules.js';

test('school year uses the legacy current-year default only when unset', () => {
  assert.equal(parseSchoolYear([], 2026), 2026);
  assert.equal(parseSchoolYear([{ setting_key: ' School Year ', setting_value: '2026' }]), 2026);
});

test('school year rejects duplicates and malformed/out-of-range values', () => {
  assert.throws(() => parseSchoolYear([
    { setting_key: 'School Year', setting_value: '2026' },
    { setting_key: 'school year', setting_value: '2027' },
  ]), /More than one/);
  for (const value of ['2026.5', '20x6', '1999', '2101', '']) {
    assert.throws(() => parseSchoolYear([{ setting_key: 'School Year', setting_value: value }]), /whole year/);
  }
});

test('effective fee periods apply only inside the selected School Year', () => {
  assert.equal(effectiveMonth('March 2026', 2026), 3);
  assert.equal(effectiveMonth('Oct 2026', 2026), 10);
  assert.equal(effectiveMonth('10/2026', 2026), 10);
  assert.equal(effectiveMonth('2026-10', 2026), 10);
  assert.equal(effectiveMonth('March', 2026), 3);
  assert.equal(effectiveMonth('March 2025', 2026), 0);
  assert.equal(effectiveMonth('March 2027', 2026), 0);
  assert.equal(effectiveMonth('13/2026', 2026), 0);
  assert.equal(effectiveMonth('not a period', 2026), 0);
});

test('selected month includes unpaid vouchers through its end and only payments by that date', () => {
  const vouchers = [
    { id: 'V-1', adm: 'A-1', period: 'September 2026', start: '2026-09-01', net: 7400 },
    { id: 'V-2', adm: 'A-1', period: 'October 2026', start: '2026-10-01', net: 3000 },
    { id: 'V-3', adm: 'A-1', period: 'November 2026', start: '2026-11-01', net: 3000 },
    { id: 'V-4', adm: 'A-1', period: 'December 2026', start: '2026-12-01', net: 3000 }
  ];
  const transactions = [
    { voucher_id: 'V-3-1', date: '2026-11-12', amount_in: 10400 },
    { voucher_id: 'V-4-2', date: '2026-12-15', amount_in: 1000 }
  ];
  const november = allocateVoucherPayments(vouchers, transactions, periodEndDate('November 2026'));
  assert.deepEqual(november.map(v => [v.period, v.paid, v.due]), [
    ['September 2026', 7400, 0],
    ['October 2026', 3000, 0],
    ['November 2026', 0, 3000]
  ]);
  const december = allocateVoucherPayments(vouchers, transactions, periodEndDate('December 2026'));
  assert.deepEqual(december.map(v => [v.period, v.paid, v.due]), [
    ['September 2026', 7400, 0],
    ['October 2026', 3000, 0],
    ['November 2026', 1000, 2000],
    ['December 2026', 0, 3000]
  ]);
});

test('zero-value vouchers are omitted from shared fee results without absorbing receipts', () => {
  const rows = allocateVoucherPayments([
    { id: 'V-1', adm: 'A-1', period: 'November 2026', net: 3000 },
    { id: 'V-2', adm: 'A-1', period: 'December 2026', net: 0 }
  ], [
    { voucher_id: 'V-2-1', date: '2026-11-12', amount_in: 3000 }
  ], '9999-12-31');

  assert.deepEqual(rows.map(v => [v.id, v.paid, v.due, v.st]), [
    ['V-1', 3000, 0, 'Paid']
  ]);
});

test('annual-fund increments preserve tuition from old fee when student tuition is blank', () => {
  const increment = {
    fee_type: 'annual fund',
    old_fee: 3000,
    new_fee: 0,
    effective_period: 'December 2026'
  };
  assert.equal(tuitionFeeForPeriod(0, increment, 12, 2026), 3000);
});

test('tuition increments switch from old to new fee at the selected effective month', () => {
  const increment = {
    fee_type: 'tution fee',
    old_fee: 3000,
    new_fee: 3500,
    effective_period: 'December 2026'
  };
  assert.equal(tuitionFeeForPeriod(0, increment, 11, 2026), 3000);
  assert.equal(tuitionFeeForPeriod(0, increment, 12, 2026), 3500);
});

test('voucher generation can filter by class and one admission number', () => {
  const students = [
    { admis_no: '731', student_name: 'Aleezy', class: 'Pre-Nursery' },
    { admis_no: '732', student_name: 'Ali', class: 'Pre-Nursery' },
    { admis_no: '810', student_name: 'Sara', class: 'Nursery' }
  ];

  assert.deepEqual(filterFeeGenerationStudents(students, 'Pre-Nursery', '731'), [students[0]]);
  assert.deepEqual(filterFeeGenerationStudents(students, 'Nursery'), [students[2]]);
  assert.deepEqual(filterFeeGenerationStudents(students).length, 3);
});
