export async function requestFeeDiscount(api, feeSeq, discount, reason = '') {
  if (!Number.isSafeInteger(Number(feeSeq)) || Number(feeSeq) < 1) throw Error('The fee line has no valid database sequence number.');
  const amount = Number(discount);
  if (!Number.isFinite(amount) || amount < 0) throw Error('Enter a non-negative discount amount.');
  const result = await api('rpc/app_request_fee_discount', {
    method: 'POST',
    body: { p_fee_seq: Number(feeSeq), p_discount: amount, p_reason: String(reason || '').trim() },
    cache: false
  });
  const id = Number(result.rows);
  if (!Number.isSafeInteger(id) || id < 1) throw Error('The database did not return a valid discount request ID.');
  return id;
}

export async function reviewFeeDiscountRequest(api, requestId, approve, adminNote = null) {
  if (!Number.isSafeInteger(Number(requestId)) || Number(requestId) < 1) throw Error('This discount request has an invalid ID.');
  await api('rpc/app_review_fee_discount_request', {
    method: 'POST',
    body: { p_request_id: Number(requestId), p_approve: !!approve, p_admin_note: adminNote },
    cache: false
  });
}
