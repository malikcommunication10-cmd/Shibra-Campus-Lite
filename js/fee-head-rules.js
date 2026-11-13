const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const norm = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function periodRank(period, defaultYear = new Date().getFullYear()) {
  const match = String(period || '').trim().match(/^([a-z]+)(?:\s+(\d{4}))?$/i);
  const month = match ? MONTHS.indexOf(match[1].toLowerCase()) : -1;
  return month < 0 ? null : (Number(match[2]) || defaultYear) * 12 + month;
}

function displayHead(type) {
  return String(type || 'Tuition fee').trim().replace(/\b\w/g, char => char.toUpperCase());
}

export function feeHeadReceipts(feeRows, transactions, asOfDate) {
  const vouchers = new Map();
  const [asOfYear, asOfMonth] = asOfDate.slice(0, 7).split('-').map(Number);
  const asOfRank = asOfYear * 12 + asOfMonth - 1;
  feeRows.forEach(row => {
    const id = String(row.voucher_id || '').trim();
    if (!id) return;
    const admission = norm(row.admis_no), name = norm(row.student_name);
    const studentKey = admission || name || id;
    const voucher = vouchers.get(id) || {
      id, studentKey, adm: String(row.admis_no || '').trim(), student: String(row.student_name || '').trim(),
      cls: String(row.class || '').trim(), period: String(row.period || '').trim(), items: []
    };
    const itemRank = periodRank(row.period, asOfYear);
    if (itemRank === null || itemRank <= asOfRank) {
      const payable = Number(row.payable) || 0, discount = Number(row.discount) || 0;
      voucher.items.push({ type: displayHead(row.type), balance: Math.max(0, round(payable - discount)) });
    }
    vouchers.set(id, voucher);
  });

  const byStudent = new Map();
  vouchers.forEach(voucher => {
    const list = byStudent.get(voucher.studentKey) || [];
    list.push(voucher);
    byStudent.set(voucher.studentKey, list);
  });
  byStudent.forEach(list => list.sort((a, b) => {
    const arrears = item => item.items.length && item.items.every(row => norm(row.type) === 'arrears');
    return Number(arrears(b)) - Number(arrears(a)) ||
      (periodRank(a.period) ?? Number.MAX_SAFE_INTEGER) - (periodRank(b.period) ?? Number.MAX_SAFE_INTEGER) ||
      a.id.localeCompare(b.id, undefined, { numeric: true });
  }));

  const receipts = new Map(), unmatched = [];
  transactions.forEach(transaction => {
    const id = String(transaction.id || transaction.voucher_id || '').trim();
    if (!/^V-\d+/i.test(id)) return;
    const voucherId = id.split('-').slice(0, 2).join('-'), voucher = vouchers.get(voucherId);
    const date = String(transaction.date || '').slice(0, 10);
    if (!date || date > asOfDate) return;
    const amount = Number(transaction.amount) || 0;
    if (amount <= 0) return;
    if (!voucher) {
      unmatched.push({ date, voucher: voucherId, sourceVoucher: id, period: '', student: '', adm: '', cls: '', account: String(transaction.account || '').trim(), amount });
      return;
    }
    const rest = id.split('-').slice(2).join('-'), nonce = (rest.match(/^(\d{10,})/) || [])[1];
    const key = `${voucher.studentKey}|${date}|${nonce || id}`;
    if (!receipts.has(key)) receipts.set(key, {
      studentKey: voucher.studentKey, date, sequence: Number(nonce) || 0, amount: 0,
      account: String(transaction.account || '').trim(), sourceVouchers: new Set()
    });
    const receipt = receipts.get(key);
    receipt.amount = round(receipt.amount + amount);
    receipt.sourceVouchers.add(voucherId);
  });

  const allocations = new Map();
  const add = (head, detail) => {
    const rows = allocations.get(head) || [];
    rows.push(detail);
    allocations.set(head, rows);
  };
  unmatched.forEach(detail => add('Fee unallocated', detail));
  byStudent.forEach((studentVouchers, studentKey) => {
    const studentReceipts = [...receipts.values()]
      .filter(receipt => receipt.studentKey === studentKey)
      .sort((a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence);
    const lines = studentVouchers.flatMap(voucher => voucher.items.map(item => ({
      voucher, item, balance: item.balance
    })));
    let lineIndex = 0;
    studentReceipts.forEach(receipt => {
      let remaining = receipt.amount;
      while (remaining > 0.004 && lineIndex < lines.length) {
        const line = lines[lineIndex];
        if (line.balance <= 0.004) { lineIndex++; continue; }
        const amount = round(Math.min(remaining, line.balance));
        line.balance = round(line.balance - amount);
        remaining = round(remaining - amount);
        add(`Fee – ${line.item.type}`, {
          date: receipt.date, voucher: line.voucher.id, sourceVoucher: [...receipt.sourceVouchers].join(', '),
          period: line.voucher.period, student: line.voucher.student, adm: line.voucher.adm,
          cls: line.voucher.cls, account: receipt.account, amount
        });
        if (line.balance <= 0.004) lineIndex++;
      }
      if (remaining > 0.004) {
        add('Fee advance', {
          date: receipt.date, voucher: [...receipt.sourceVouchers].join(', '), sourceVoucher: [...receipt.sourceVouchers].join(', '),
          period: '', student: studentVouchers[0]?.student || '', adm: studentVouchers[0]?.adm || '',
          cls: studentVouchers[0]?.cls || '', account: receipt.account, amount: remaining
        });
      }
    });
  });
  return allocations;
}
