const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const norm = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function sortPeriods(periods) {
  const rank = period => {
    const match = String(period || '').trim().match(/^([a-z]+)(?:\s+(\d{4}))?$/i);
    const month = match ? MONTHS.indexOf(match[1].toLowerCase()) : -1;
    return month < 0 ? Number.MAX_SAFE_INTEGER : (Number(match[2]) || 0) * 12 + month;
  };
  return [...periods].sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
}

function periodDate(period, defaultYear = new Date().getFullYear()) {
  const match = String(period || '').trim().match(/^([a-z]+)(?:\s+(\d{4}))?$/i);
  const month = match ? MONTHS.findIndex(name =>
    name === match[1].toLowerCase() || name.slice(0, 3) === match[1].toLowerCase()
  ) : -1;
  if (month < 0) return '';
  const year = Number(match[2]) || defaultYear;
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

export function allocateFifo(charges, receipts) {
  const paidByVoucher = new Map(charges.map(charge => [charge.id, 0]));
  const balances = charges.map(charge => Math.max(0, round(charge.charge)));
  let voucherIndex = 0;
  const allocatedReceipts = receipts.map(receipt => {
    let remaining = Math.max(0, round(receipt.amount));
    const parts = [];
    while (remaining > 0.004 && voucherIndex < charges.length) {
      const charge = charges[voucherIndex], due = balances[voucherIndex];
      if (due <= 0.004) { voucherIndex++; continue; }
      const applied = round(Math.min(remaining, due));
      balances[voucherIndex] = round(due - applied);
      paidByVoucher.set(charge.id, round((paidByVoucher.get(charge.id) || 0) + applied));
      parts.push({ voucherId: charge.id, period: charge.period || '', amount: applied });
      remaining = round(remaining - applied);
      if (balances[voucherIndex] <= 0.004) voucherIndex++;
    }
    return { ...receipt, parts, advance: remaining };
  });
  return { paidByVoucher, receipts: allocatedReceipts };
}

export function getLatestPayment(transactions, asOf = new Date()) {
  const asOfDate = typeof asOf === 'string'
    ? asOf.slice(0, 10)
    : `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, '0')}-${String(asOf.getDate()).padStart(2, '0')}`;
  const receipts = new Map();
  transactions.forEach(row => {
    const id = String(row.voucher_id || '').trim();
    if (!/^V-\d+/i.test(id)) return;
    const date = String(row.date || '').slice(0, 10);
    const amount = Number(row.amount_in) || 0;
    if (!date || date > asOfDate || amount <= 0) return;
    const suffix = id.split('-').slice(2).join('-');
    const nonce = (suffix.match(/^(\d{10,})/) || [])[1];
    const key = `${date}|${nonce || id}`;
    if (!receipts.has(key)) receipts.set(key, { date, sequence: Number(nonce) || 0, amount: 0, id });
    const receipt = receipts.get(key);
    receipt.amount = round(receipt.amount + amount);
  });
  return [...receipts.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || a.sequence - b.sequence || a.id.localeCompare(b.id)
  ).pop() || null;
}

export function buildStudentLedger(feeRows, transactions, admissionNo, studentName, asOf = new Date()) {
  const asOfDate = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, '0')}-${String(asOf.getDate()).padStart(2, '0')}`;
  const adm = norm(admissionNo), name = norm(studentName);
  const selected = feeRows.filter(row => {
    const matchesStudent = adm
      ? norm(row.admis_no) === adm
      : norm(row.student_name) === name;
    return matchesStudent;
  });
  const allGrouped = new Map();
  selected.forEach(row => {
    const id = String(row.voucher_id || '').trim();
    if (!id) return;
    if (!allGrouped.has(id)) allGrouped.set(id, { id, period: row.period || '', cls: row.class || '', items: [], charge: 0 });
    const voucher = allGrouped.get(id);
    const payable = Number(row.payable) || 0, discount = Number(row.discount) || 0;
    voucher.charge = round(voucher.charge + payable - discount);
    voucher.items.push({ type: row.type || 'Tuition fee', payable, discount });
  });
  const grouped = new Map([...allGrouped].filter(([, voucher]) => {
    const date = periodDate(voucher.period, asOf.getFullYear());
    return !date || date <= asOfDate;
  }));

  const receipts = new Map();
  transactions.forEach(row => {
    const id = String(row.voucher_id || '').trim();
    if (!/^V-\d+/i.test(id)) return;
    const voucherId = id.split('-').slice(0, 2).join('-');
    const voucher = allGrouped.get(voucherId);
    if (!voucher) return;
    const date = String(row.date || '').slice(0, 10) || periodDate(voucher.period, asOf.getFullYear());
    if (date && date > asOfDate) return;
    const amount = Number(row.amount_in) || 0;
    if (amount <= 0) return;
    const rest = id.split('-').slice(2).join('-');
    const nonce = (rest.match(/^(\d{10,})/) || [])[1];
    const receiptKey = `${date}|${nonce || id}`;
    if (!receipts.has(receiptKey)) receipts.set(receiptKey, {
      date, sequence: Number(nonce) || 0, amount: 0, account: String(row.to_account || '').trim(),
      note: String(row.description || row.remarks || '').trim(), sourceVouchers: new Set(), parts: []
    });
    const receipt = receipts.get(receiptKey);
    receipt.amount = round(receipt.amount + amount);
    receipt.sourceVouchers.add(voucherId);
  });

  const vouchers = [...grouped.values()].map(voucher => ({
      ...voucher, paid: 0, balance: voucher.charge, date: periodDate(voucher.period, asOf.getFullYear()),
    })).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const charges = vouchers.map(voucher => ({ id: voucher.id, period: voucher.period, charge: voucher.charge }));
  const allocated = allocateFifo(charges, [...receipts.values()].sort((a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence));
  const paidByVoucher = allocated.paidByVoucher;
  const receiptRows = allocated.receipts;
  vouchers.forEach(voucher => {
    voucher.paid = paidByVoucher.get(voucher.id) || 0;
    voucher.balance = round(voucher.charge - voucher.paid);
    if (voucher.balance < 0.004 && voucher.balance > -0.004) voucher.balance = 0;
    voucher.status = voucher.charge <= 0.004 ? 'Zero charge' : voucher.balance < -0.004 ? 'Advance' : voucher.balance <= 0.004 ? 'Cleared' : voucher.paid > 0 ? 'Part paid' : 'Unpaid';
  });

  const events = [
    ...vouchers.map(voucher => ({
      date: voucher.date, order: 0, voucherId: voucher.id, period: voucher.period,
      description: voucher.items.map(item => item.type).join(' + '), debit: voucher.charge, credit: 0
    })),
    ...receiptRows.map(receipt => ({
      date: receipt.date, order: 1, voucherId: receipt.parts[0]?.voucherId || [...receipt.sourceVouchers][0] || '',
      period: '', description: 'Payment received', debit: 0, credit: receipt.amount, receipt
    }))
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.voucherId.localeCompare(b.voucherId));

  let running = 0;
  events.forEach(event => { running = round(running + event.debit - event.credit); event.balance = running; });
  return {
    vouchers, events,
    charged: round(vouchers.reduce((sum, voucher) => sum + voucher.charge, 0)),
    paid: round(receiptRows.reduce((sum, receipt) => sum + receipt.amount, 0)),
    balance: round(vouchers.reduce((sum, voucher) => sum + voucher.charge, 0) - receiptRows.reduce((sum, receipt) => sum + receipt.amount, 0))
  };
}
