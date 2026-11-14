import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFollowupPerformance } from '../js/followup-performance.js';

test('family assignment is one call unit while each individual student assignment is separate', () => {
  const [staff] = buildFollowupPerformance({
    assignees: [{ email: 'caller@example.com', name: 'Caller' }],
    assignments: [
      { assignee_email: 'caller@example.com', family_key: 'fam-1', scope_type: 'family' },
      { assignee_email: 'caller@example.com', family_key: 'fam-1', scope_type: 'student', scope_key: 'student-1' },
      { assignee_email: 'caller@example.com', family_key: 'fam-1', scope_type: 'student', scope_key: 'student-2' }
    ]
  });
  assert.equal(staff.assignedFamilies, 1);
  assert.equal(staff.familyUnits, 1);
  assert.equal(staff.studentUnits, 2);
  assert.equal(staff.units.size, 3);
});

test('attributes calls by caller, counts reached outcomes, and respects date filters', () => {
  const [staff] = buildFollowupPerformance({
    assignees: [{ email: 'caller@example.com', name: 'Caller' }],
    assignments: [{ assignee_email: 'caller@example.com', family_key: 'fam-1', scope_type: 'family' }],
    logs: [
      { family_key: 'fam-1', caller: 'Caller', call_date: '2026-11-02T10:00:00Z', outcome: 'no_answer' },
      { family_key: 'fam-1', caller: 'caller@example.com', call_date: '2026-11-10T10:00:00Z', outcome: 'promised', promise_date: '2026-11-12' },
      { family_key: 'fam-1', caller: 'Caller', call_date: '2026-11-11T09:00:00Z', outcome: 'no_answer', spoke_with: 'Father' },
      { family_key: 'fam-1', caller: 'Other staff', call_date: '2026-11-11T10:00:00Z', outcome: 'paid' }
    ],
    from: '2026-11-05'
  });
  assert.equal(staff.callsCount, 2);
  assert.equal(staff.reached, 1);
  assert.equal(staff.notReached, 1);
  assert.equal(staff.contactRate, 50);
  assert.equal(staff.promises, 1);
  assert.ok(staff.avgGapDays > 0 && staff.avgGapDays < 1);
});

test('collection recovery is credited once per family to the latest caller', () => {
  const result = buildFollowupPerformance({
    assignees: [
      { email: 'first@example.com', name: 'First' },
      { email: 'second@example.com', name: 'Second' }
    ],
    assignments: [
      { assignee_email: 'first@example.com', family_key: 'fam-1', scope_type: 'family' },
      { assignee_email: 'second@example.com', family_key: 'fam-1', scope_type: 'student', scope_key: 'student-1' }
    ],
    logs: [{ family_key: 'fam-1', caller: 'Second', call_date: '2026-11-10T10:00:00Z', outcome: 'promised', pending_at_call: 175 }],
    families: [{ key: 'fam-1', pending: 100, paidSince: 75, kids: [{ key: 'student-1', name: 'Student One', net: 100 }] }]
  });
  const first = result.find(row => row.email === 'first@example.com');
  const second = result.find(row => row.email === 'second@example.com');
  assert.equal(first.collected, 0);
  assert.equal(second.pendingBefore, 175);
  assert.equal(second.collected, 75);
  assert.equal(first.balance, 100);
  assert.equal(second.balance, 0);
  assert.equal(second.assignedDetails.length, 1);
});

test('family-level call and collection data appears once for family plus student assignments', () => {
  const [staff] = buildFollowupPerformance({
    assignees: [{ email: 'caller@example.com', name: 'Caller' }],
    assignments: [
      { assignee_email: 'caller@example.com', family_key: 'fam-1', scope_type: 'student', scope_key: 'student-1' },
      { assignee_email: 'caller@example.com', family_key: 'fam-1', scope_type: 'family' }
    ],
    logs: [{ family_key: 'fam-1', caller: 'Caller', call_date: '2026-11-10T10:00:00Z', outcome: 'paid', pending_at_call: 200 }],
    families: [{ key: 'fam-1', title: 'Family F-1', names: 'Student One', pending: 0, paidSince: 200, kids: [{ key: 'student-1', name: 'Student One' }] }],
    from: '2026-11-01',
    to: '2026-11-30',
    today: '2026-11-14'
  });
  assert.equal(staff.assignedDetails.length, 2);
  assert.equal(staff.assignedDetails[0].scopeType, 'family');
  assert.equal(staff.assignedDetails[0].representative, true);
  assert.equal(staff.assignedDetails[0].pendingBefore, 200);
  assert.equal(staff.assignedDetails[0].collected, 200);
  assert.equal(staff.assignedDetails[0].balance, 0);
  assert.equal(staff.assignedDetails[1].representative, false);
  assert.equal(staff.assignedDetails[1].pendingBefore, null);
});

test('does not credit a call when caller name matches multiple staff members', () => {
  const result = buildFollowupPerformance({
    assignees: [
      { email: 'one@example.com', name: 'Same Name' },
      { email: 'two@example.com', name: 'Same Name' }
    ],
    logs: [{ family_key: 'fam-1', caller: 'Same Name', call_date: '2026-11-10T10:00:00Z', outcome: 'paid' }]
  });
  assert.equal(result[0].callsCount, 0);
  assert.equal(result[1].callsCount, 0);
});

test('reports overdue promises and credits family-level recovery once in the chosen period', () => {
  const [staff] = buildFollowupPerformance({
    assignees: [{ email: 'caller@example.com', name: 'Caller' }],
    assignments: [
      { assignee_email: 'caller@example.com', family_key: 'fam-1', scope_type: 'family' },
      { assignee_email: 'caller@example.com', family_key: 'fam-1', scope_type: 'student', scope_key: 'student-1' }
    ],
    logs: [{ family_key: 'fam-1', caller: 'Caller', call_date: '2026-11-10T10:00:00Z', outcome: 'promised', promise_date: '2026-11-11' }],
    families: [{ key: 'fam-1', pending: 25, paidSince: 75, kids: [{ key: 'student-1', name: 'Student One', net: 25 }] }],
    from: '2026-11-01',
    to: '2026-11-30',
    today: '2026-11-14'
  });
  assert.equal(staff.overdue, 1);
  assert.equal(staff.collected, 75);
});

test('assigned and unassigned current balances reconcile to all family dues without double counting', () => {
  const rows = buildFollowupPerformance({
    assignees: [
      { email: 'family-owner@example.com', name: 'Family Owner' },
      { email: 'student-owner@example.com', name: 'Student Owner' }
    ],
    assignments: [
      { assignee_email: 'family-owner@example.com', family_key: 'fam-1', scope_type: 'family' },
      { assignee_email: 'student-owner@example.com', family_key: 'fam-1', scope_type: 'student', scope_key: 's-1' },
      { assignee_email: 'student-owner@example.com', family_key: 'fam-2', scope_type: 'student', scope_key: 's-2' }
    ],
    families: [
      { key: 'fam-1', title: 'Family One', pending: 200, kids: [{ key: 's-1', name: 'One', net: 120 }, { key: 's-1b', name: 'Sibling', net: 80 }] },
      { key: 'fam-2', title: 'Family Two', pending: 130, kids: [{ key: 's-2', name: 'Two', net: 50 }, { key: 's-2b', name: 'Sibling Two', net: 80 }] },
      { key: 'fam-3', title: 'Family Three', pending: 70, kids: [{ key: 's-3', name: 'Three', net: 70 }] }
    ]
  });
  assert.equal(rows.find(row => row.email === 'family-owner@example.com').balance, 200);
  assert.equal(rows.find(row => row.email === 'student-owner@example.com').balance, 50);
  const unassigned = rows.find(row => row.email === '__unassigned__');
  assert.equal(unassigned.balance, 150);
  assert.equal(unassigned.unassignedUnits, 2);
  assert.equal(rows.reduce((sum, row) => sum + row.balance, 0), 400);
});

test('current balance follows the Follow-up family filters while retaining all family details', () => {
  const rows = buildFollowupPerformance({
    assignees: [{ email: 'staff@example.com', name: 'Staff' }],
    assignments: [
      { assignee_email: 'staff@example.com', family_key: 'active', scope_type: 'family' },
      { assignee_email: 'staff@example.com', family_key: 'excluded', scope_type: 'family' }
    ],
    families: [
      { key: 'active', pending: 100, kids: [] },
      { key: 'excluded', pending: 200, kids: [] }
    ],
    balanceFamilies: [{ key: 'active', pending: 100, kids: [] }]
  });
  const staff = rows.find(row => row.email === 'staff@example.com');
  assert.equal(staff.balance, 100);
  assert.equal(staff.assignedDetails.find(item => item.familyKey === 'excluded').balance, 0);
  assert.equal(rows.find(row => row.email === '__unassigned__'), undefined);
  assert.equal(rows.reduce((sum, row) => sum + row.balance, 0), 100);
});

