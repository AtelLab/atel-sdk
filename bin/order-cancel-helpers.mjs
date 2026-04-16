const TERMINAL_ORDER_STATUSES = new Set(['cancelled', 'settled', 'rejected', 'expired']);

function normalizeOrderCancelContext(orderInfo = {}) {
  const orderId = orderInfo.orderId || orderInfo.OrderID || orderInfo.id || orderInfo.ID || '';
  const orderStatus = String(orderInfo.status || orderInfo.Status || '').trim().toLowerCase();
  const requesterDid = orderInfo.requesterDid || orderInfo.RequesterDID || orderInfo.requester_did || '';
  const executorDid = orderInfo.executorDid || orderInfo.ExecutorDID || orderInfo.executor_did || '';

  return {
    orderId,
    orderStatus,
    requesterDid,
    executorDid,
  };
}

function parseOrderCancelArgs(restArgs = []) {
  const args = Array.isArray(restArgs) ? restArgs : [String(restArgs || '')];
  const reasonParts = [];
  let dryRun = false;

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg) reasonParts.push(arg);
  }

  return {
    dryRun,
    reason: reasonParts.join(' ').trim(),
  };
}

function preflightOrderCancel(orderInfo, currentDid) {
  const ctx = normalizeOrderCancelContext(orderInfo);
  const isExecutor = ctx.executorDid && currentDid ? ctx.executorDid === currentDid : false;
  const isRequester = ctx.requesterDid && currentDid ? ctx.requesterDid === currentDid : false;

  if (!ctx.orderId) {
    return { ok: false, code: 'missing_order_id', error: 'Order info is missing an order ID.', ...ctx, currentDid, isRequester, isExecutor, terminal: false };
  }

  if (!ctx.orderStatus) {
    return { ok: false, code: 'missing_status', error: `Unable to determine order status for ${ctx.orderId}.`, ...ctx, currentDid, isRequester, isExecutor, terminal: false };
  }

  if (TERMINAL_ORDER_STATUSES.has(ctx.orderStatus)) {
    return { ok: false, code: 'terminal_status', error: `Order ${ctx.orderId} is already ${ctx.orderStatus}.`, ...ctx, currentDid, isRequester, isExecutor, terminal: true };
  }

  if (!currentDid) {
    return { ok: false, code: 'missing_identity', error: 'Current DID is not initialized.', ...ctx, currentDid: '', isRequester, isExecutor, terminal: false };
  }

  if (!ctx.requesterDid) {
    return { ok: false, code: 'missing_requester', error: `Order ${ctx.orderId} is missing requester DID; cannot verify cancel permission.`, ...ctx, currentDid, isRequester: false, isExecutor, terminal: false };
  }

  if (!isRequester) {
    return {
      ok: false,
      code: 'not_requester',
      error: `Only the requester can cancel order ${ctx.orderId}. Current DID ${currentDid} does not match requester DID ${ctx.requesterDid}.`,
      ...ctx,
      currentDid,
      isRequester: false,
      isExecutor,
      terminal: false,
    };
  }

  return { ok: true, ...ctx, currentDid, isRequester: true, isExecutor, terminal: false };
}

export { TERMINAL_ORDER_STATUSES, normalizeOrderCancelContext, parseOrderCancelArgs, preflightOrderCancel };
