const norm = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const UNASSIGNED_EMAIL = '__unassigned__';
const createPerson = (email, name) => ({
  email, name, units: new Map(), familyKeys: new Set(), calls: [],
  overdue: 0, pendingBefore: 0, collected: 0, currentBalance: 0
});

const isReached = log => {
  const outcome = norm(log.outcome);
  if (['no_answer', 'off_wrong'].includes(outcome)) return false;
  return ['promised', 'callback', 'refused', 'paid'].includes(outcome) || !!String(log.spoke_with || '').trim();
};

export function buildFollowupPerformance({ assignments = [], assignees = [], logs = [], families = [], balanceFamilies = families, from = '', to = '', today = new Date().toISOString().slice(0, 10) }) {
  const people = new Map();
  assignees.forEach(person => {
    const email = norm(person.email);
    if (email) people.set(email, createPerson(email, String(person.name || person.email)));
  });

  const seenAssignments = new Set();
  assignments.forEach(item => {
    const email = norm(item.assignee_email), familyKey = String(item.family_key || '');
    if (!email || !familyKey || !['family', 'student'].includes(item.scope_type)) return;
    if (!people.has(email)) people.set(email, createPerson(email, String(item.assignee_email)));
    const scopeKey = item.scope_type === 'family' ? familyKey : String(item.scope_key || '');
    if (!scopeKey) return;
    const assignmentKey = `${email}|${item.scope_type}|${familyKey}|${scopeKey}`;
    if (seenAssignments.has(assignmentKey)) return;
    seenAssignments.add(assignmentKey);
    const person = people.get(email);
    person.units.set(assignmentKey, item);
    person.familyKeys.add(familyKey);
  });

  const familyMap = new Map(families.map(family => [String(family.key), family]));
  const ensureUnassigned = () => {
    if (!people.has(UNASSIGNED_EMAIL)) people.set(UNASSIGNED_EMAIL, createPerson(UNASSIGNED_EMAIL, 'Unassigned'));
    return people.get(UNASSIGNED_EMAIL);
  };
  balanceFamilies.forEach(family => {
    const familyKey = String(family.key), familyDue = Math.max(0, Number(family.pending) || 0);
    const units = [...people.values()].flatMap(person => [...person.units.values()]
      .filter(item => String(item.family_key) === familyKey)
      .map(item => ({ person, item })));
    const familyUnit = units.find(entry => entry.item.scope_type === 'family');
    if (familyUnit) {
      familyUnit.item.currentBalance = familyDue;
      familyUnit.person.currentBalance += familyDue;
      return;
    }

    const studentUnits = new Map();
    units.filter(entry => entry.item.scope_type === 'student').forEach(entry => {
      const key = String(entry.item.scope_key || '');
      if (key && !studentUnits.has(key)) studentUnits.set(key, entry);
    });
    let remainingDue = familyDue;
    const unassignedKids = [];
    (family.kids || []).forEach(kid => {
      const assigned = studentUnits.get(String(kid.key));
      if (!assigned) { unassignedKids.push(kid); return; }
      const amount = Math.min(remainingDue, Math.max(0, Number(kid.net) || 0));
      assigned.item.currentBalance = amount;
      assigned.person.currentBalance += amount;
      remainingDue = Math.max(0, remainingDue - amount);
    });

    if (!studentUnits.size) {
      if (familyDue > 0.004) {
        const person = ensureUnassigned();
        const item = { family_key: familyKey, scope_type: 'unassigned_family', currentBalance: familyDue };
        person.units.set(`${UNASSIGNED_EMAIL}|family|${familyKey}`, item);
        person.familyKeys.add(familyKey);
        person.currentBalance += familyDue;
      }
      return;
    }

    if (unassignedKids.length || remainingDue > 0.004) {
      const person = ensureUnassigned();
      const item = {
        family_key: familyKey, scope_type: 'unassigned_family',
        unassigned_names: unassignedKids.map(kid => kid.name).filter(Boolean).join(', '),
        currentBalance: remainingDue
      };
      person.units.set(`${UNASSIGNED_EMAIL}|family|${familyKey}`, item);
      person.familyKeys.add(familyKey);
      person.currentBalance += remainingDue;
    }
  });

  const aliases = new Map();
  people.forEach(person => {
    if (person.email === UNASSIGNED_EMAIL) return;
    [person.email, person.name].map(norm).filter(Boolean).forEach(alias => {
      if (!aliases.has(alias)) aliases.set(alias, new Set());
      aliases.get(alias).add(person.email);
    });
  });
  const callerEmail = value => {
    const matches = aliases.get(norm(value));
    return matches?.size === 1 ? [...matches][0] : '';
  };
  const inRange = log => {
    const date = String(log.call_date || '').slice(0, 10);
    return (!from || date >= from) && (!to || date <= to);
  };
  const sortedLogs = [...logs].sort((a, b) => new Date(a.call_date) - new Date(b.call_date));
  sortedLogs.filter(inRange).forEach(log => {
    const email = callerEmail(log.caller);
    if (email) people.get(email)?.calls.push(log);
  });

  const latestByFamily = new Map();
  sortedLogs.forEach(log => {
    const key = String(log.family_key || '');
    if (key) latestByFamily.set(key, log);
  });
  people.forEach(person => {
    person.familyKeys.forEach(key => {
      const family = familyMap.get(key), last = latestByFamily.get(key);
      if (!family || !last || callerEmail(last.caller) !== person.email) return;
      const promiseDate = String(last.promise_date || '').slice(0, 10);
      if (family.pending > 0.004 && promiseDate && promiseDate < today) person.overdue++;
      if (inRange(last)) {
        const snapshot = last.pending_at_call != null && Number.isFinite(Number(last.pending_at_call))
          ? Number(last.pending_at_call) : Number(family.pending) || 0;
        person.pendingBefore += Math.max(0, snapshot);
        person.collected += Math.max(0, Number(family.paidSince) || 0);
      }
    });
  });

  return [...people.values()].map(person => {
    const calls = person.calls;
    const gaps = new Map();
    calls.forEach(log => {
      const key = String(log.family_key || '');
      if (!key) return;
      if (!gaps.has(key)) gaps.set(key, []);
      gaps.get(key).push(new Date(log.call_date).getTime());
    });
    const intervals = [...gaps.values()].flatMap(dates => {
      dates.sort((a, b) => a - b);
      return dates.slice(1).map((date, index) => (date - dates[index]) / 86400000);
    }).filter(days => Number.isFinite(days) && days >= 0);
    const reached = calls.filter(isReached).length;
    const assignedDetails = [];
    person.familyKeys.forEach(familyKey => {
      const family = familyMap.get(familyKey), familyAssignments = [...person.units.values()]
        .filter(item => String(item.family_key) === familyKey)
        .sort((a, b) => (a.scope_type === 'family' ? 0 : 1) - (b.scope_type === 'family' ? 0 : 1));
      const last = latestByFamily.get(familyKey) || null;
      const familyCalls = calls.filter(log => String(log.family_key || '') === familyKey);
      const familyCallDates = familyCalls.map(log => new Date(log.call_date).getTime()).sort((a, b) => a - b);
      const familyCallGaps = familyCallDates.slice(1).map((date, index) => (date - familyCallDates[index]) / 86400000)
        .filter(days => Number.isFinite(days) && days >= 0);
      familyAssignments.forEach((item, index) => {
        const student = item.scope_type === 'student'
          ? (family?.kids || []).find(kid => String(kid.key) === String(item.scope_key)) : null;
        const ownsLatestCall = !!last && callerEmail(last.caller) === person.email;
        const ownsLatestCallInRange = ownsLatestCall && inRange(last);
        const snapshot = last && last.pending_at_call != null && Number.isFinite(Number(last.pending_at_call))
          ? Number(last.pending_at_call) : Number(family?.pending) || 0;
        const pendingBefore = index === 0 && ownsLatestCallInRange ? Math.max(0, snapshot) : null;
        const collected = index === 0 && ownsLatestCallInRange ? Math.max(0, Number(family?.paidSince) || 0) : null;
        assignedDetails.push({
          familyKey,
          familyTitle: family?.title || family?.label || 'Family',
          familyNames: family?.names || '',
          target: item.scope_type === 'family' ? 'Whole family'
            : item.scope_type === 'unassigned_family' ? 'Unassigned family / students'
              : student?.name || 'Student',
          scopeType: item.scope_type,
          representative: index === 0,
          callsCount: familyCalls.length,
          reached: familyCalls.filter(isReached).length,
          notReached: familyCalls.filter(log => ['no_answer', 'off_wrong'].includes(norm(log.outcome))).length,
          contactRate: familyCalls.length ? Math.round(familyCalls.filter(isReached).length * 100 / familyCalls.length) : 0,
          promises: familyCalls.filter(log => !!log.promise_date).length,
          avgGapDays: familyCallGaps.length ? familyCallGaps.reduce((sum, days) => sum + days, 0) / familyCallGaps.length : null,
          overdue: ownsLatestCall && family?.pending > 0.004 && last.promise_date && String(last.promise_date).slice(0, 10) < today ? 1 : 0,
          lastCall: last,
          pendingBefore,
          collected,
          balance: Number(item.currentBalance) || 0,
          unassignedNames: item.unassigned_names || ''
        });
      });
    });
    return {
      ...person,
      assignedDetails,
      assignedFamilies: person.familyKeys.size,
      familyUnits: [...person.units.values()].filter(item => item.scope_type === 'family').length,
      studentUnits: [...person.units.values()].filter(item => item.scope_type === 'student').length,
      unassignedUnits: [...person.units.values()].filter(item => item.scope_type === 'unassigned_family').length,
      callsCount: calls.length,
      reached,
      notReached: calls.filter(log => ['no_answer', 'off_wrong'].includes(norm(log.outcome))).length,
      contactRate: calls.length ? Math.round(reached * 100 / calls.length) : 0,
      promises: calls.filter(log => !!log.promise_date).length,
      avgGapDays: intervals.length ? intervals.reduce((sum, days) => sum + days, 0) / intervals.length : null,
      pendingBefore: Math.round(person.pendingBefore * 100) / 100,
      collected: Math.round(person.collected * 100) / 100,
      balance: Math.round(person.currentBalance * 100) / 100
    };
  }).sort((a, b) => Number(a.email === UNASSIGNED_EMAIL) - Number(b.email === UNASSIGNED_EMAIL)
    || b.units.size - a.units.size || b.callsCount - a.callsCount || a.name.localeCompare(b.name));
}
