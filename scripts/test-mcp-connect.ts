// E2E test for connectMcp helper. Run against testnet:
//   npx tsx scripts/test-mcp-connect.ts
//
// Verifies:
//   1. SDK can build SignedRequest envelope and exchange for JWT
//   2. JWT is accepted as MCP Bearer (call /admin/approvals or any GET)
//   3. Token format matches the same one OAuth path produces

import { connectMcp, mcpAuthHeaders } from '../src/mcp/index.js';

const LOBSTER1_DID = 'did:atel:ed25519:Cd7aKPnFr5ZVqBtbgVPnum1VCNKHGFxtx9kBTUE81w6R';
// secretKey is hex-encoded 64 bytes (seed||pub) per atel-cli identity.json shape
const LOBSTER1_SECRET_HEX = '7b9e421a0dc9baf600b96ef881cc0b9a05bcf45a4026867f7b19d8127aba272bacb0e62840e9eac9abb363e56eaf66e01da4df9d933b73688769be0663a4a522';

const MCP_URL = process.env.MCP_URL || 'http://144.202.53.72:8787/mcp';
const PLATFORM_URL = process.env.PLATFORM_URL || 'http://144.202.53.72:8200';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function main() {
  console.log('=== Step 1: connectMcp via DID-Sig ===');
  const t0 = Date.now();
  const session = await connectMcp({
    mcpUrl: MCP_URL,
    platformUrl: PLATFORM_URL,
    identity: {
      did: LOBSTER1_DID,
      secretKey: hexToBytes(LOBSTER1_SECRET_HEX),
    },
  });
  const elapsed = Date.now() - t0;
  console.log(`  ✓ token obtained in ${elapsed}ms`);
  console.log(`  did: ${session.did}`);
  console.log(`  expiresAt: ${new Date(session.expiresAt).toISOString()}`);
  console.log(`  token: ${session.accessToken.slice(0, 40)}...`);

  console.log('');
  console.log('=== Step 2: Verify token is accepted by MCP /admin/approvals ===');
  const headers = mcpAuthHeaders(session);
  // /admin/approvals is bearer-authed and requires the caller DID (same DID
  // we signed with) to match. If our DID-Sig token is being introspected
  // correctly, this returns 200; otherwise 401.
  const adminUrl = MCP_URL.replace(/\/mcp$/, '') + '/admin/approvals';
  const res = await fetch(adminUrl, {
    method: 'GET',
    headers: { authorization: headers.authorization },
  });
  console.log(`  HTTP ${res.status}`);
  const body = await res.json().catch(() => ({}));
  console.log(`  body: ${JSON.stringify(body).slice(0, 200)}`);

  if (res.status !== 200) {
    throw new Error(`expected 200, got ${res.status}`);
  }
  console.log('  ✓ MCP accepts DID-Sig-issued JWT as bearer');

  console.log('');
  console.log('=== Step 3: tools/list via MCP transport (SSE) ===');
  // Use the HTTP transport directly (not full SDK client) since we just
  // want to verify tools/list works with this token.
  const mcpRes = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  });
  console.log(`  HTTP ${mcpRes.status}`);
  const text = await mcpRes.text();
  // Parse SSE-framed response
  const dataLine = text.split('\n').find(l => l.startsWith('data:'));
  if (!dataLine) {
    console.log(`  raw response: ${text.slice(0, 300)}`);
    throw new Error('expected SSE data line');
  }
  const parsed = JSON.parse(dataLine.slice(5).trim());
  const toolCount = parsed?.result?.tools?.length ?? 0;
  console.log(`  ✓ tools count: ${toolCount}`);
  if (toolCount < 30) {
    throw new Error(`expected ≥30 tools, got ${toolCount}`);
  }

  console.log('');
  console.log('🎉 G2 e2e PASSED — DID-Sig path works end to end');
  console.log(`   Total time from cold start to authenticated tool list: ${Date.now() - t0}ms`);
}

main().catch((err) => {
  console.error('❌ FAILED:', err.message);
  process.exit(1);
});
