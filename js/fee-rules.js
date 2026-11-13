export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function periodEndDate(period, defaultYear = new Date().getFullYear()) {
  const value = String(period || '').trim();
  const match = value.match(/^([A-Za-z]+)(?:\s+(20\d{2}))?$/);
  if (!match) return '';
  const month = MONTHS.findIndex(item =>
    item.toLowerCase() === match[1].toLowerCase() ||
    item.slice(0, 3).toLowerCase() === match[1].toLowerCase()
  );
  if (month < 0) return '';
  const year = Number(match[2]) || defaultYear;
  const day = new Date(year, month + 1, 0).getDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function allocateVoucherPayments(vouchers, transactions = [], asOfDate = '9999-12-31', fallbackPaid = {}) {
  const norm = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const rank = period => {
    const value = String(period || '').trim();
    const match = value.match(/^([A-Za-z]+)(?:\s+(20\d{2}))?$/);
    if (!match) return null;
    const month = MONTHS.findIndex(item =>
      item.toLowerCase() === match[1].toLowerCase() ||
      item.slice(0, 3).toLowerCase() === match[1].toLowerCase()
    );
    return month < 0 ? null : (Number(match[2]) || new Date().getFullYear()) * 12 + month;
  };
  const [cutYear, cutMonth] = asOfDate.slice(0, 7).split('-').map(Number);
  const cutRank = cutYear * 12 + cutMonth - 1;
  const voucherById = new Map(vouchers.map(voucher => [voucher.id, voucher]));
  const groups = new Map();
  vouchers.forEach(voucher => {
    const key = norm(voucher.adm || voucher.student || voucher.id);
    const group = groups.get(key) || { all: [], eligible: [] };
    group.all.push(voucher);
    const month = rank(voucher.period);
    if (month === null || month <= cutRank) group.eligible.push(voucher);
    groups.set(key, group);
  });
  const received = new Map();
  transactions.forEach(row => {
    const id = String(row.voucher_id || '').trim();
    if (!/^V-\d+/i.test(id)) return;
    const source = voucherById.get(id.split('-').slice(0, 2).join('-'));
    if (!source) return;
    const date = String(row.date || '').slice(0, 10) || source.start && `${source.start.slice(0, 7)}-01`;
    if (date && date > asOfDate) return;
    const amount = Number(row.amount_in) || 0;
    if (amount <= 0) return;
    const key = norm(source.adm || source.student || source.id);
    received.set(key, (received.get(key) || 0) + amount);
  });
  const result = [];
  groups.forEach((group, key) => {
    const ordered = group.eligible.slice().sort((a, b) => {
      const arrears = voucher => voucher.items?.length && voucher.items.every(item => norm(item.type) === 'arrears');
      return Number(arrears(b)) - Number(arrears(a)) ||
        (rank(a.period) ?? Number.MAX_SAFE_INTEGER) - (rank(b.period) ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id, undefined, { numeric: true });
    });
    const fallback = group.all.reduce((sum, voucher) => sum + (Number(fallbackPaid[voucher.id]) || 0), 0);
    const totalReceived = transactions.length ? received.get(key) || 0 : fallback;
    let remaining = Math.round((totalReceived + Number.EPSILON) * 100) / 100;
    ordered.forEach(voucher => {
      const charge = Math.max(0, Number(voucher.net) || 0);
      if (charge <= 0.004) return;
      const paid = Math.round((Math.min(charge, remaining) + Number.EPSILON) * 100) / 100;
      remaining = Math.round((remaining - paid + Number.EPSILON) * 100) / 100;
      const due = Math.round((charge - paid + Number.EPSILON) * 100) / 100;
      result.push({ ...voucher, paid, due, st: due <= 0.004 ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid' });
    });
  });
  return result;
}

export function parseSchoolYear(rows, currentYear = new Date().getFullYear()) {
  const configured = rows
    .filter(row => String(row.setting_key || '').trim().toLowerCase() === 'school year')
    .map(row => String(row.setting_value ?? '').trim());

  if (configured.length > 1) throw Error('More than one School Year setting exists. Resolve the duplicate before continuing.');
  if (configured.length === 0) {
    if (!Number.isInteger(currentYear) || currentYear < 2000 || currentYear > 2100) {
      throw Error('The current year is outside the supported School Year range.');
    }
    return currentYear;
  }

  if (!/^(20\d{2}|2100)$/.test(configured[0])) {
    throw Error('School Year must be a whole year from 2000 to 2100.');
  }
  return Number(configured[0]);
}

export function effectiveMonth(period, schoolYear) {
  const value = String(period || '').trim();
  if (!value) return 0;

  let month = -1;
  let year = schoolYear;
  const named = value.match(/^([A-Za-z]+)(?:\s+(20\d{2}))?$/);
  if (named) {
    month = MONTHS.findIndex(item =>
      item.toLowerCase() === named[1].toLowerCase() ||
      item.slice(0, 3).toLowerCase() === named[1].toLowerCase()
    ) + 1;
    if (named[2]) year = Number(named[2]);
  } else {
    const monthFirst = value.match(/^(0?[1-9]|1[0-2])[/.-](20\d{2})$/);
    const yearFirst = value.match(/^(20\d{2})[/.-](0?[1-9]|1[0-2])$/);
    if (monthFirst) {
      month = Number(monthFirst[1]);
      year = Number(monthFirst[2]);
    } else if (yearFirst) {
      month = Number(yearFirst[2]);
      year = Number(yearFirst[1]);
    }
  }

  return month >= 1 && month <= 12 && year === schoolYear ? month : 0;
}

export function tuitionFeeForPeriod(studentFee, increment, month, schoolYear) {
  const fallback = parseFloat(studentFee) || 0;
  if (!increment) return fallback;
  const oldTuition = parseFloat(increment.old_fee) || fallback;
  if (String(increment.fee_type || '').trim().toLowerCase() === 'annual fund') return oldTuition;
  const effective = effectiveMonth(increment.effective_period, schoolYear);
  return effective > 0 && month >= effective
    ? parseFloat(increment.new_fee) || oldTuition
    : oldTuition;
}

export function filterFeeGenerationStudents(students, className = '', admissionNo = '') {
  const classFilter = String(className || '').trim().toLowerCase();
  const studentFilter = String(admissionNo || '').trim().toLowerCase();
  return students.filter(student =>
    (!classFilter || String(student.class || '').trim().toLowerCase() === classFilter) &&
    (!studentFilter || String(student.admis_no || student.sr_no || student.student_name || '').trim().toLowerCase() === studentFilter)
  );
}
