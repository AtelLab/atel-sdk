/**
 * AVIP — ATEL Verifiable Intent Protocol
 *
 * Intent represents a signed declaration of what an agent intends to do,
 * with structured constraints (amount, deadline, scope, milestones).
 *
 * The Intent is signed by the issuer's Ed25519 key and submitted to the
 * Platform alongside the order. The Platform verifies the signature and
 * stores the Intent as-is (never reconstructed).
 */

import { randomUUID } from 'crypto';
import { AgentIdentity, serializePayload, sign, verify } from '../identity/index.js';

// ── Interfaces ──

export interface IntentConstraints {
  maxAmount?: number;       // USD upper limit
  deadline?: string;        // ISO 8601 expiry
  milestoneCount?: number;  // Default 5
  scope?: string[];         // Allowed capability types
}

export interface DelegationStep {
  from: string;
  to: string;
  attenuated: boolean;
  signature: string;
}

export interface Intent {
  intentId: string;
  issuerDid: string;
  subjectDid: string;
  action: string;
  constraints: IntentConstraints;
  delegationChain: DelegationStep[];
  timestamp: string;
  signature: string;
}

// ── Core Functions ──

/**
 * Create and sign an Intent.
 *
 * The signing input is a deterministic JSON of:
 *   { action, constraints, issuerDid, subjectDid, timestamp }
 * with keys sorted alphabetically (matching Platform's deterministicJSON).
 */
export function createIntent(
  identity: AgentIdentity,
  subjectDid: string,
  action: string,
  constraints: IntentConstraints,
): Intent {
  const milestoneCount = constraints.milestoneCount ?? 5;
  const normalizedConstraints: IntentConstraints = {
    ...constraints,
    milestoneCount,
  };

  const timestamp = new Date().toISOString();

  // Build the object to sign — keys will be sorted by serializePayload
  const signable = {
    action,
    constraints: normalizedConstraints,
    issuerDid: identity.did,
    subjectDid,
    timestamp,
  };

  // Sign using the SDK's standard sign() which calls serializePayload internally
  const signature = sign(signable, identity.secretKey);

  const intentId = 'intent_' + randomUUID();

  return {
    intentId,
    issuerDid: identity.did,
    subjectDid,
    action,
    constraints: normalizedConstraints,
    delegationChain: [{
      from: identity.did,
      to: subjectDid,
      attenuated: true,
      signature,
    }],
    timestamp,
    signature,
  };
}

/**
 * Verify an Intent's signature using the issuer's public key.
 */
export function verifyIntent(intent: Intent, publicKey: Uint8Array): boolean {
  const signable = {
    action: intent.action,
    constraints: intent.constraints,
    issuerDid: intent.issuerDid,
    subjectDid: intent.subjectDid,
    timestamp: intent.timestamp,
  };

  return verify(signable, intent.signature, publicKey);
}
