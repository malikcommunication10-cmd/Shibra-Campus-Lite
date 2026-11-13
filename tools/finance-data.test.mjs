import assert from 'node:assert/strict';
import test from 'node:test';
import { daybookAmounts, sortDaybookEntries } from '../js/daybook-rules.js';

test('daybook date sorting keeps the database transaction order on matching dates', () => {
  const entries = [
    { id: 'later-date', sequence: 20, date: '2025-02-02' },
    { id: 'second-same-day', sequence: 12, date: '2025-02-01' },
    { id: 'first-same-day', sequence: 11, date: '2025-02-01' }
  ];

  assert.deepEqual(sortDaybookEntries(entries).map(entry => entry.id), [
    'first-same-day', 'second-same-day', 'later-date'
  ]);
  assert.deepEqual(sortDaybookEntries(entries, -1).map(entry => entry.id), [
    'later-date', 'second-same-day', 'first-same-day'
  ]);
});

test('daybook shows a transfer once while respecting the selected wallet direction', () => {
  const transfer = { kind: 'transfer', wallet: 'cash', wallet2: 'bank', amount: 15070 };

  assert.deepEqual(daybookAmounts(transfer), {
    received: 0,
    paid: 15070,
    note: 'Account transfer'
  });
  assert.deepEqual(daybookAmounts(transfer, 'cash'), {
    received: 0,
    paid: 15070,
    note: 'Account transfer'
  });
  assert.deepEqual(daybookAmounts(transfer, 'bank'), {
    received: 15070,
    paid: 0,
    note: 'Account transfer'
  });
});

test('daybook exposes amounts for bill entries that do not move cash', () => {
  const bill = { kind: 'bill_received', amount: 1250 };
  assert.deepEqual(daybookAmounts(bill), {
    received: 0,
    paid: 0,
    note: 'Bill received · PKR 1250'
  });
});
