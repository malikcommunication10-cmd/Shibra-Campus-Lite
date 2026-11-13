export function sortDaybookEntries(entries, direction = 1) {
  return [...entries].sort((left, right) => {
    const dateOrder = String(left.date || '').localeCompare(String(right.date || ''));
    if (dateOrder) return dateOrder * direction;
    const leftSequence = Number(left.sequence), rightSequence = Number(right.sequence);
    if (left.sequence != null && right.sequence != null
      && Number.isFinite(leftSequence) && Number.isFinite(rightSequence) && leftSequence !== rightSequence) {
      return (leftSequence - rightSequence) * direction;
    }
    return String(left.id || '').localeCompare(String(right.id || ''), undefined, { numeric: true, sensitivity: 'base' }) * direction;
  });
}

export function daybookAmounts(entry, selectedWallet = '') {
  if (entry.kind === 'transfer') return {
    received: selectedWallet && entry.wallet2 === selectedWallet ? entry.amount : 0,
    paid: !selectedWallet || entry.wallet === selectedWallet ? entry.amount : 0,
    note: 'Account transfer'
  };
  if (entry.kind === 'bill_raised' || entry.kind === 'bill_received') return {
    received: 0,
    paid: 0,
    note: `${entry.kind === 'bill_raised' ? 'Bill raised' : 'Bill received'} · PKR ${entry.amount}`
  };
  return {
    received: entry.kind === 'receipt' || entry.kind === 'opening' ? entry.amount : 0,
    paid: entry.kind === 'payment' ? entry.amount : 0,
    note: ''
  };
}
