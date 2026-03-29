import { describe, expect, it } from 'vitest';
import { normalizeGatewayBind, shouldSkipAgentHook, shouldUseGatewaySession } from '../bin/notification-action-helpers.mjs';

describe('notification routing', () => {
  it('routes milestone work events to local structured fallback, not gateway', () => {
    expect(shouldUseGatewaySession('milestone_plan_confirmed')).toBe(false);
    expect(shouldUseGatewaySession('milestone_submitted')).toBe(false);
    expect(shouldUseGatewaySession('milestone_verified')).toBe(false);
    expect(shouldUseGatewaySession('milestone_rejected')).toBe(false);
    expect(shouldUseGatewaySession('p2p_task')).toBe(true);
  });

  it('keeps order_accepted on direct execution path', () => {
    expect(shouldUseGatewaySession('order_accepted')).toBe(false);
    expect(shouldSkipAgentHook('order_accepted', true)).toBe(true);
  });

  it('normalizes loopback-style gateway bind values', () => {
    expect(normalizeGatewayBind('loopback')).toBe('127.0.0.1');
    expect(normalizeGatewayBind('localhost')).toBe('127.0.0.1');
    expect(normalizeGatewayBind('0.0.0.0')).toBe('127.0.0.1');
    expect(normalizeGatewayBind('192.168.1.2')).toBe('192.168.1.2');
  });
});
