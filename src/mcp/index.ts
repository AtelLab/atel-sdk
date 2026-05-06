// MCP connection helper for headless ATEL agents.
//
// Headless agents (lobster runtime / SDK CLI / Docker container / any service
// without a browser) cannot complete the OAuth Platform Challenge flow that
// MCP's standard OAuth bridge expects. This module provides a one-call
// alternative: sign a SignedRequest envelope with the agent's DID secret,
// hand it to platform's /auth/v1/did-sig, get a JWT bearer that's accepted
// by atel-mcp's introspection layer (same jwtSecret as OAuth-issued tokens).
//
// Why this exists alongside the OAuth path:
//   - OAuth requires browser redirect — impossible for unattended agents
//   - DID signing is what every ATEL agent already does for /trade/v1
//     and /relay/v1 — no new credential to manage
//   - The token returned is shape-compatible with OAuth bearers, so any
//     downstream MCP-aware code (cached sessions, scope checks, audit DID
//     resolution) works without modification
//
// Usage (5 lines):
//   import { connectMcp } from 'atel-sdk';
//   const session = await connectMcp({
//     mcpUrl: 'https://atelai.xyz/mcp',
//     platformUrl: 'https://api.atelai.xyz',
//     identity: {did, secretKey},
//   });
//   // session.accessToken is a Bearer good for ~7 days
//   // session.expiresAt is unix ms — re-sign before this to refresh

import { sign, serializePayload } from '../identity/index.js';
import { randomBytes } from 'node:crypto';

export interface ConnectMcpInput {
  /** Public-facing MCP server URL, e.g. https://atelai.xyz/mcp */
  mcpUrl: string;
  /** Platform base URL, e.g. https://api.atelai.xyz */
  platformUrl: string;
  /** Caller's identity (DID + ed25519 secret). secretKey is the 64-byte
   *  expanded ed25519 secret (seed||pub) — same shape produced by
   *  generateKeyPair / atel_register_user. */
  identity: { did: string; secretKey: Uint8Array };
}

export interface McpSession {
  /** Bearer token. Pass as `Authorization: Bearer ${accessToken}` to MCP /mcp. */
  accessToken: string;
  /** Unix milliseconds. Re-call connectMcp before this to refresh. */
  expiresAt: number;
  /** DID this session is bound to (echo of input.identity.did). */
  did: string;
  /** Public MCP URL (echo of input.mcpUrl), for the caller's transport setup. */
  mcpUrl: string;
}

/**
 * Mint an MCP bearer token via DID-Sig (no browser, no OAuth dance).
 *
 * Throws if the platform rejects the signature (clock skew, unknown DID,
 * missing key registration). The error includes the platform response
 * verbatim — propagate it; the caller can decide whether to retry, refresh
 * the platform's known-keys cache, or surface to the user.
 */
export async function connectMcp(input: ConnectMcpInput): Promise<McpSession> {
  const timestamp = new Date().toISOString();
  // Random nonce per request — defense in depth against signature replay
  // even within the platform's 5-minute timestamp window.
  const nonce = randomBytes(16).toString('hex');
  const payload = { nonce };

  // Same canonical-JSON serialization platform's DIDAuth middleware uses
  // to verify. Any drift here = signatures rejected.
  const signable = serializePayload({ payload, did: input.identity.did, timestamp });
  const signature = sign(signable, input.identity.secretKey);

  const envelope = {
    did: input.identity.did,
    payload,
    timestamp,
    signature,
  };

  const platformBase = input.platformUrl.replace(/\/+$/, '');
  const response = await fetch(`${platformBase}/auth/v1/did-sig`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
  });

  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || typeof body?.token !== 'string') {
    const detail = body ? JSON.stringify(body) : await response.text().catch(() => '');
    throw new Error(`atel-sdk/mcp: /auth/v1/did-sig failed (${response.status}): ${detail}`);
  }

  // expiresAt comes back as unix seconds; SDK convention is ms.
  const expiresAtMs = typeof body.expiresAt === 'number'
    ? (body.expiresAt as number) * 1000
    : Date.now() + 7 * 24 * 3600 * 1000;

  return {
    accessToken: body.token,
    expiresAt: expiresAtMs,
    did: input.identity.did,
    mcpUrl: input.mcpUrl,
  };
}

/**
 * Sugar: build a Headers object an MCP HTTP transport can use directly.
 *
 *   const headers = mcpAuthHeaders(session);
 *   const res = await fetch(`${session.mcpUrl}`, { method: 'POST', headers, body });
 */
export function mcpAuthHeaders(session: McpSession): Record<string, string> {
  return {
    authorization: `Bearer ${session.accessToken}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
}
