import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStudentLedger, getLatestPayment, sortPeriods } from '../js/ledger-rules.js';

test('voucher period options sort chronologically, not alphabetically', () => {
  assert.deepEqual(sortPeriods(['March 2026', 'January 2025', 'February 2026', 'January 2026']), [
    'January 2025', 'January 2026', 'February 2026', 'March 2026'
  ]);
});

test('latest payment combines split receipt rows and ignores future receipts', () => {
  const latest = getLatestPayment([
    { voucher_id: 'V-100001-1790000000000-1', amount_in: 20, date: '2026-01-05' },
    { voucher_id: 'V-100001-1791000000000-1', amount_in: 60, date: '2026-02-05' },
    { voucher_id: 'V-100002-1791000000000-2', amount_in: 40, date: '2026-02-05' },
    { voucher_id: 'V-100002-1792000000000-1', amount_in: 500, date: '2026-12-01' }
  ], '2026-11-13');
  assert.deepEqual({ date: latest.date, amount: latest.amount }, { date: '2026-02-05', amount: 100 });
});

test('student ledger keeps voucher allocations FIFO and combines split receipts', () => {
  const fees = [
    { admis_no: 'A-1', student_name: 'Ali', class: 'One', voucher_id: 'V-100001', period: 'January 2026', type: 'tuition fee', payable: 100, discount: 0 },
    { admis_no: 'A-1', student_name: 'Ali', class: 'One', voucher_id: 'V-100002', period: 'February 2026', type: 'tuition fee', payable: 80, discount: 10 }
  ];
  const transactions = [
    { voucher_id: 'V-100001-1790000000000-1', amount_in: 60, date: '2026-01-05', to_account: 'cash' },
    { voucher_id: 'V-100001-1791000000000-1', amount_in: 40, date: '2026-02-05', to_account: 'bank', description: 'Monthly fee' },
    { voucher_id: 'V-100002-1791000000000-2', amount_in: 30, date: '2026-02-05', to_account: 'bank', description: 'Monthly fee' }
  ];
  const ledger = buildStudentLedger(fees, transactions, 'A-1', 'Ali');
  assert.deepEqual(ledger.vouchers.map(row => [row.id, row.charge, row.paid, row.balance]), [
    ['V-100001', 100, 100, 0],
    ['V-100002', 70, 30, 40]
  ]);
  assert.equal(ledger.events.filter(event => event.receipt).length, 2);
  const bulkReceipt = ledger.events.find(event => event.receipt?.parts.length === 2);
  assert.equal(bulkReceipt.credit, 70);
  assert.equal(bulkReceipt.receipt.parts[0].voucherId, 'V-100001');
  assert.equal(bulkReceipt.receipt.parts[1].voucherId, 'V-100002');
  assert.equal(ledger.charged, 170);
  assert.equal(ledger.paid, 130);
  assert.equal(ledger.balance, 40);
});

test('student ledger matches by name when admission number is missing', () => {
  const ledger = buildStudentLedger([
    { student_name: '  Sara Noor ', voucher_id: 'V-123456', period: 'March 2026', type: 'tuition fee', payable: 500, discount: 25 }
  ], [], '', 'sara noor');
  assert.equal(ledger.vouchers.length, 1);
  assert.equal(ledger.balance, 475);
  assert.equal(ledger.vouchers[0].status, 'Unpaid');
});

test('student ledger outstanding includes charges and receipts only through the current date', () => {
  const fees = [
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100001', period: 'January 2026', payable: 100 },
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100002', period: 'November 2026', payable: 200 },
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100003', period: 'December 2026', payable: 300 }
  ];
  const transactions = [
    { voucher_id: 'V-100001-1', amount_in: 50, date: '2026-11-13' },
    { voucher_id: 'V-100001-2', amount_in: 25, date: '2026-11-14' }
  ];
  const ledger = buildStudentLedger(fees, transactions, 'A-1', 'Ali', new Date(2026, 10, 13));

  assert.deepEqual(ledger.vouchers.map(row => row.id), ['V-100001', 'V-100002']);
  assert.equal(ledger.charged, 300);
  assert.equal(ledger.paid, 50);
  assert.equal(ledger.balance, 250);
});

test('student ledger excludes future abbreviated periods at the selected month cutoff', () => {
  const ledger = buildStudentLedger([
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100001', period: 'Nov 2026', payable: 3000 },
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100002', period: 'Dec 2026', payable: 3000 },
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100003', period: 'Dec 2026', payable: 0 }
  ], [], 'A-1', 'Ali', new Date(2026, 10, 30, 23, 59, 59, 999));

  assert.deepEqual(ledger.vouchers.map(row => [row.period, row.charge, row.status]), [
    ['Nov 2026', 3000, 'Unpaid']
  ]);
  assert.equal(ledger.charged, 3000);
});

test('student ledger shows zero-value vouchers without counting them as paid charges', () => {
  const ledger = buildStudentLedger([
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100001', period: 'September 2026', payable: 3000 },
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100002', period: 'December 2026', payable: 0 }
  ], [], 'A-1', 'Ali', new Date(2026, 11, 31));

  assert.deepEqual(ledger.vouchers.map(row => [row.id, row.charge, row.status]), [
    ['V-100001', 3000, 'Unpaid'],
    ['V-100002', 0, 'Zero charge']
  ]);
  assert.equal(ledger.vouchers[1].paid, 0);
  assert.equal(ledger.vouchers[1].balance, 0);
  assert.equal(ledger.charged, 3000);
});

test('payments linked to a newer voucher settle the oldest outstanding months first', () => {
  const fees = [
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100001', period: 'September 2026', payable: 7400 },
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100002', period: 'October 2026', payable: 3000 },
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100003', period: 'November 2026', payable: 3000 }
  ];
  const ledger = buildStudentLedger(fees, [
    { voucher_id: 'V-100003-1794470000000', amount_in: 10400, date: '2026-11-12', to_account: 'cash' }
  ], 'A-1', 'Ali', new Date(2026, 10, 13));

  assert.deepEqual(ledger.vouchers.map(row => [row.period, row.paid, row.balance, row.status]), [
    ['September 2026', 7400, 0, 'Cleared'],
    ['October 2026', 3000, 0, 'Cleared'],
    ['November 2026', 0, 3000, 'Unpaid']
  ]);
  assert.equal(ledger.charged, 13400);
  assert.equal(ledger.paid, 10400);
  assert.equal(ledger.balance, 3000);
  assert.deepEqual(ledger.events.find(event => event.receipt).receipt.parts.map(part => [part.period, part.amount]), [
    ['September 2026', 7400],
    ['October 2026', 3000]
  ]);
});

test('payment tagged to a future voucher counts as advance without negative monthly paid', () => {
  const ledger = buildStudentLedger([
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100001', period: 'November 2026', payable: 3000 },
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100002', period: 'December 2026', payable: 3000 }
  ], [
    { voucher_id: 'V-100002-1794470000000', amount_in: 4000, date: '2026-11-12', to_account: 'cash' }
  ], 'A-1', 'Ali', new Date(2026, 10, 13));

  assert.equal(ledger.vouchers.length, 1);
  assert.equal(ledger.vouchers[0].paid, 3000);
  assert.equal(ledger.vouchers[0].balance, 0);
  assert.equal(ledger.paid, 4000);
  assert.equal(ledger.balance, -1000);
  assert.equal(ledger.events.find(event => event.receipt).receipt.advance, 1000);
});
