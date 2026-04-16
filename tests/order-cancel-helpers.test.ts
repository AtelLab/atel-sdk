import { describe, expect, it } from 'vitest';
import { parseOrderCancelArgs, preflightOrderCancel } from '../bin/order-cancel-helpers.mjs';

describe('order cancel helpers', () => {
  it('parses dry-run and reason from raw args', () => {
    expect(parseOrderCancelArgs(['--dry-run', 'cleanup', 'regression'])).toEqual({
      dryRun: true,
      reason: 'cleanup regression',
    });

    expect(parseOrderCancelArgs(['cleanup', 'regression', '--dry-run'])).toEqual({
      dryRun: true,
      reason: 'cleanup regression',
    });
  });

  it('accepts active requester-owned orders', () => {
    const result = preflightOrderCancel(
      {
        orderId: 'ord-1',
        status: 'executing',
        requesterDid: 'did:atel:ed25519:requester',
        executorDid: 'did:atel:ed25519:executor',
      },
      'did:atel:ed25519:requester',
    );

    expect(result.ok).toBe(true);
    expect(result.orderId).toBe('ord-1');
    expect(result.orderStatus).toBe('executing');
    expect(result.isRequester).toBe(true);
    expect(result.isExecutor).toBe(false);
  });

  it('rejects terminal orders before calling cancel', () => {
    const result = preflightOrderCancel(
      {
        OrderID: 'ord-2',
        Status: 'settled',
        requesterDid: 'did:atel:ed25519:requester',
      },
      'did:atel:ed25519:requester',
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe('terminal_status');
    expect(result.terminal).toBe(true);
  });

  it('rejects non-requester callers', () => {
    const result = preflightOrderCancel(
      {
        orderId: 'ord-3',
        status: 'created',
        requesterDid: 'did:atel:ed25519:requester',
        executorDid: 'did:atel:ed25519:executor',
      },
      'did:atel:ed25519:executor',
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe('not_requester');
    expect(result.isRequester).toBe(false);
  });
});
