export function explainDirectExecutionSkip(eventType, recommendedActions, payload = {}, policy = {}) {
  if (eventType !== 'order_created') return '';
  if (!Array.isArray(recommendedActions) || recommendedActions.length === 0) return 'missing_recommended_actions';
  const hasAcceptAction = recommendedActions.some((action) =>
    action?.type === 'cli' &&
    action?.action === 'accept' &&
    Array.isArray(action.command) &&
    action.command[0] === 'atel'
  );
  if (!hasAcceptAction) return 'missing_accept_action';
  const amount = Number(payload?.priceAmount || 0);
  const autoPolicy = policy?.autoPolicy || {};
  const acceptMaxAmount = Number(autoPolicy.acceptMaxAmount || 0);
  if (amount <= 0) {
    if (policy?.taskMode !== 'auto') return 'task_mode_not_auto';
    if (policy?.autoAcceptPlatform !== true) return 'auto_accept_platform_disabled';
    return '';
  }
  if (autoPolicy.acceptOrders !== true) return 'paid_auto_accept_disabled';
  if (acceptMaxAmount > 0 && amount > acceptMaxAmount) return 'price_exceeds_accept_max';
  return '';
}

export function getDirectExecutableActions(eventType, recommendedActions, payload = {}, policy = {}) {
  if (!Array.isArray(recommendedActions) || recommendedActions.length === 0) return [];

  if (eventType === 'order_created') {
    const amount = Number(payload?.priceAmount || 0);
    const autoPolicy = policy?.autoPolicy || {};
    const acceptMaxAmount = Number(autoPolicy.acceptMaxAmount || 0);
    const shouldAutoAcceptFree = policy?.taskMode === 'auto' && policy?.autoAcceptPlatform === true && amount <= 0;
    const shouldAutoAcceptByPolicy = autoPolicy.acceptOrders === true && (acceptMaxAmount <= 0 || amount <= acceptMaxAmount);
    if (shouldAutoAcceptFree || shouldAutoAcceptByPolicy) {
      return recommendedActions.filter((action) =>
        action?.type === 'cli' &&
        action?.action === 'accept' &&
        Array.isArray(action.command) &&
        action.command[0] === 'atel'
      );
    }
    return [];
  }

  if (eventType === 'order_accepted') {
    return recommendedActions.filter((action) =>
      action?.type === 'cli' &&
      action?.action === 'approve_plan' &&
      Array.isArray(action.command) &&
      action.command[0] === 'atel'
    );
  }

  return [];
}

export function shouldSkipAgentHook(eventType, directExecutionSucceeded) {
  return eventType === 'order_accepted' && directExecutionSucceeded;
}

const EXECUTOR_MILESTONE_EVENTS = new Set(['milestone_plan_confirmed', 'milestone_submitted', 'milestone_verified', 'milestone_rejected']);

export function shouldUseGatewaySession(eventType) {
  // Use isolated gateway sub-sessions for milestone executor turns so each
  // order+milestone attempt runs in a clean room instead of sharing the main
  // agent runtime context.
  return eventType === 'p2p_task' || EXECUTOR_MILESTONE_EVENTS.has(eventType);
}

export function normalizeGatewayBind(bind) {
  if (!bind) return '127.0.0.1';
  if (bind === 'loopback' || bind === 'localhost') return '127.0.0.1';
  if (bind === '0.0.0.0' || bind === '::' || bind === '::1') return '127.0.0.1';
  return bind;
}

function normalizeIndex(value, fallback = 0) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeResult(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeOrderId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function extractForeignOrderId(text, expectedOrderId) {
  const current = normalizeOrderId(expectedOrderId);
  if (!current) return '';
  const found = Array.from(String(text || '').matchAll(/ord-[a-f0-9-]+/g)).map((m) => m[0]);
  return found.find((item) => item !== current) || '';
}

function validateExecutorMilestoneBody(eventType, payload, body) {
  if (!EXECUTOR_MILESTONE_EVENTS.has(eventType)) return { ok: true };
  const expectedOrderId = normalizeOrderId(payload?.orderId);
  if (!expectedOrderId) return { ok: false, error: 'missing_order_id' };
  const actualOrderId = normalizeOrderId(body?.orderId);
  if (!actualOrderId) return { ok: false, error: 'missing_result_order_id' };
  if (actualOrderId !== expectedOrderId) return { ok: false, error: 'mismatched_result_order_id' };

  const expectedIndex = eventType === 'milestone_plan_confirmed'
    ? normalizeIndex(payload?.milestoneIndex, 0)
    : normalizeIndex(payload?.currentMilestone ?? payload?.milestoneIndex, 0);
  if (!Number.isFinite(Number(body?.milestoneIndex))) return { ok: false, error: 'missing_result_milestone_index' };
  const actualIndex = normalizeIndex(body?.milestoneIndex, -1);
  if (actualIndex !== expectedIndex) return { ok: false, error: 'mismatched_result_milestone_index' };

  const result = normalizeResult(body?.result || body?.summary);
  if (!result) return { ok: false, error: 'missing_result' };
  const lowered = result.toLowerCase();
  if (lowered.includes('invalid_cross_order_reference')) return { ok: false, error: 'invalid_cross_order_reference' };
  if (lowered.includes('context overflow')) return { ok: false, error: 'context_overflow_output' };
  if (lowered.includes('plugin register() called') || lowered.includes('plugin registration complete')) return { ok: false, error: 'plugin_noise_output' };
  if (lowered.includes('session file locked') || lowered.includes('session locked')) return { ok: false, error: 'session_locked_output' };
  const foreign = extractForeignOrderId(result, expectedOrderId);
  if (foreign) return { ok: false, error: 'foreign_order_reference_detected' };
  return { ok: true, result, orderId: expectedOrderId, milestoneIndex: expectedIndex };
}

export function buildAgentCallbackAction(eventType, payload, body) {
  if (eventType === 'p2p_task') {
    const taskId = payload?.taskId;
    if (!taskId) return { ok: false, error: 'missing_task_id' };
    const result = normalizeResult(body?.result || body?.summary);
    if (!result) return { ok: false, error: 'missing_result' };
    return {
      ok: true,
      action: {
        type: 'local_result',
        action: 'complete_p2p_task',
        taskId,
        result,
      },
    };
  }

  const orderId = payload?.orderId;
  if (!orderId) return { ok: false, error: 'missing_order_id' };

  if (eventType === 'milestone_plan_confirmed') {
    const validated = validateExecutorMilestoneBody(eventType, payload, body);
    if (!validated.ok) return validated;
    return {
      ok: true,
      action: {
        type: 'cli',
        action: 'submit_milestone',
        command: ['atel', 'milestone-submit', orderId, String(validated.milestoneIndex), '--result', validated.result],
      },
    };
  }

  if (eventType === 'milestone_verified') {
    if (payload?.allComplete) return { ok: false, skipped: true, reason: 'all_complete' };
    const validated = validateExecutorMilestoneBody(eventType, payload, body);
    if (!validated.ok) return validated;
    return {
      ok: true,
      action: {
        type: 'cli',
        action: 'submit_milestone',
        command: ['atel', 'milestone-submit', orderId, String(validated.milestoneIndex), '--result', validated.result],
      },
    };
  }

  if (eventType === 'milestone_rejected') {
    const validated = validateExecutorMilestoneBody(eventType, payload, body);
    if (!validated.ok) return validated;
    return {
      ok: true,
      action: {
        type: 'cli',
        action: 'resubmit',
        command: ['atel', 'milestone-submit', orderId, String(validated.milestoneIndex), '--result', validated.result],
      },
    };
  }

  if (eventType === 'milestone_submitted') {
    const index = normalizeIndex(payload?.milestoneIndex, 0);
    const decision = String(body?.decision || '').trim().toLowerCase();
    if (decision === 'pass' || decision === 'approve' || decision === 'approved') {
      return {
        ok: true,
        action: {
          type: 'cli',
          action: 'pass',
          command: ['atel', 'milestone-verify', orderId, String(index), '--pass'],
        },
      };
    }

    if (decision === 'reject' || decision === 'rejected' || decision === 'fail' || decision === 'failed') {
      const reason = normalizeResult(body?.reason || body?.rejectReason || body?.summary);
      if (!reason) return { ok: false, error: 'missing_reject_reason' };
      return {
        ok: true,
        action: {
          type: 'cli',
          action: 'reject',
          command: ['atel', 'milestone-verify', orderId, String(index), '--reject', reason],
        },
      };
    }

    return { ok: false, error: 'missing_decision' };
  }

  return { ok: false, skipped: true, reason: 'event_not_supported' };
}
