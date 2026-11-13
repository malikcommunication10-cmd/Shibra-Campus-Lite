import assert from 'node:assert/strict';
import test from 'node:test';
import { feeHeadReceipts } from '../js/fee-head-rules.js';

test('admission voucher receipts are allocated to each recorded fee head', () => {
  const fees = [
    { admis_no: 'A-1', student_name: 'Ali', class: 'One', voucher_id: 'V-100001', period: 'September 2026', type: 'tuition fee', payable: 3000 },
    { admis_no: 'A-1', student_name: 'Ali', class: 'One', voucher_id: 'V-100001', period: 'September 2026', type: 'annual fund', payable: 2000 },
    { admis_no: 'A-1', student_name: 'Ali', class: 'One', voucher_id: 'V-100001', period: 'September 2026', type: 'admission fee', payable: 1000 },
    { admis_no: 'A-1', student_name: 'Ali', class: 'One', voucher_id: 'V-100001', period: 'September 2026', type: 'registration fee', payable: 500 }
  ];
  const allocations = feeHeadReceipts(fees, [
    { id: 'V-100001-1790000000000-1', date: '2026-09-01', amount: 6500, account: 'Cash in Hand' }
  ], '2026-09-30');

  assert.deepEqual([...allocations].map(([head, rows]) => [head, rows.reduce((total, row) => total + row.amount, 0)]), [
    ['Fee – Tuition Fee', 3000],
    ['Fee – Annual Fund', 2000],
    ['Fee – Admission Fee', 1000],
    ['Fee – Registration Fee', 500]
  ]);
  assert.equal(allocations.get('Fee – Annual Fund')[0].student, 'Ali');
  assert.equal(allocations.get('Fee – Annual Fund')[0].period, 'September 2026');
});

test('head allocations follow oldest unpaid fee items and retain overpayment as advance', () => {
  const fees = [
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100001', period: 'September 2026', type: 'annual fund', payable: 100 },
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100002', period: 'October 2026', type: 'tuition fee', payable: 200 }
  ];
  const allocations = feeHeadReceipts(fees, [
    { id: 'V-100002-1790000000000-1', date: '2026-10-10', amount: 350, account: 'Bank' }
  ], '2026-10-31');

  assert.equal(allocations.get('Fee – Annual Fund')[0].amount, 100);
  assert.equal(allocations.get('Fee – Tuition Fee')[0].amount, 200);
  assert.equal(allocations.get('Fee advance')[0].amount, 50);
});

test('head allocations exclude future-dated receipts', () => {
  const allocations = feeHeadReceipts([
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100001', period: 'November 2026', type: 'annual fund', payable: 100 }
  ], [
    { id: 'V-100001-1790000000000-1', date: '2026-11-14', amount: 100, account: 'Bank' }
  ], '2026-11-13');

  assert.equal(allocations.size, 0);
});

test('fee receipts with missing voucher details remain visible as unallocated income', () => {
  const allocations = feeHeadReceipts([], [
    { id: 'V-100001-1790000000000-1', date: '2026-09-01', amount: 250, account: 'Cash in Hand' }
  ], '2026-09-30');

  assert.equal(allocations.get('Fee unallocated')[0].amount, 250);
});

test('current receipts do not mark future-period fee heads as received', () => {
  const allocations = feeHeadReceipts([
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100001', period: 'November 2026', type: 'tuition fee', payable: 100 },
    { admis_no: 'A-1', student_name: 'Ali', voucher_id: 'V-100002', period: 'December 2026', type: 'annual fund', payable: 100 }
  ], [
    { id: 'V-100002-1790000000000-1', date: '2026-11-12', amount: 150, account: 'Bank' }
  ], '2026-11-13');

  assert.equal(allocations.get('Fee – Tuition Fee')[0].amount, 100);
  assert.equal(allocations.has('Fee – Annual Fund'), false);
  assert.equal(allocations.get('Fee advance')[0].amount, 50);
});
