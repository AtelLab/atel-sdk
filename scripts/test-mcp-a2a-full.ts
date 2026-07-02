// Full A2A end-to-end test going entirely through MCP tools.
//
// Two ATEL identities (lobster1 = requester, lobster2 = executor) connect
// to atel-mcp via DID-Sig (same path the OpenClaw plugin uses). Every
// step calls a real MCP tool — no SDK shortcuts, no platform-direct calls.
//
// Flow:
//   1. Both connect → bearer tokens
//   2. lobster1 atel_balance (sanity)
//   3. lobster1 atel_order_create → ord-xxx
//   4. lobster2 atel_order_accept
//   5. Both atel_milestone_plan_feedback approved=true (advances to executing)
//   6. For each of N milestones:
//      - lobster2 atel_milestone_submit
//      - lobster1 atel_milestone_verify
//   7. lobster1 atel_order_complete
//   8. lobster1 atel_order_confirm → settled
//
// If any step fails the script throws with the exact MCP error code +
// hint so we can drill in.

import { connectMcp } from '../src/mcp/index.js';

const MCP_URL = process.env.MCP_URL || 'http://144.202.53.72:8787/mcp';
const PLATFORM_URL = process.env.PLATFORM_URL || 'http://144.202.53.72:8200';

const LOBSTER1 = {
  did: 'did:atel:ed25519:Cd7aKPnFr5ZVqBtbgVPnum1VCNKHGFxtx9kBTUE81w6R',
  secretHex: '7b9e421a0dc9baf600b96ef881cc0b9a05bcf45a4026867f7b19d8127aba272bacb0e62840e9eac9abb363e56eaf66e01da4df9d933b73688769be0663a4a522',
};
const LOBSTER2 = {
  did: 'did:atel:ed25519:9MG292qspkEZpgSfMbTYgY9FJT29S1ueaBHJ7xzpbD3K',
  secretHex: process.env.LOBSTER2_SECRET_HEX || '',
};

function hex2bytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

interface Session { token: string; mcpUrl: string; did: string; }

async function callTool(session: Session, name: string, args: unknown): Promise<unknown> {
  const res = await fetch(session.mcpUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
      params: { name, arguments: args ?? {} },
    }),
  });
  const text = await res.text();
  let envelope: { result?: { content?: { text: string }[]; isError?: boolean }; error?: unknown } | undefined;
  for (const line of text.split('\n')) {
    if (line.startsWith('data:')) {
      try { envelope = JSON.parse(line.slice(5).trim()); break; } catch { /* */ }
    }
  }
  if (!envelope) throw new Error(`tool ${name} returned no parsable response: ${text.slice(0, 200)}`);
  if (envelope.error) throw new Error(`tool ${name} JSON-RPC error: ${JSON.stringify(envelope.error)}`);
  const result = envelope.result;
  if (!result?.content?.length) return null;
  const inner = JSON.parse(result.content[0].text);
  if (result.isError) {
    throw new Error(`tool ${name} returned error: code=${inner.code} message=${inner.message} hint=${inner.hint ?? ''} details=${JSON.stringify(inner.details ?? {})}`);
  }
  return inner;
}

async function getSession(label: string, did: string, secretHex: string): Promise<Session> {
  const session = await connectMcp({
    mcpUrl: MCP_URL,
    platformUrl: PLATFORM_URL,
    identity: { did, secretKey: hex2bytes(secretHex) },
  });
  console.log(`  [${label}] connected, did=${did.slice(0, 30)}... token=${session.accessToken.slice(0, 24)}...`);
  return { token: session.accessToken, mcpUrl: MCP_URL, did };
}

async function main() {
  if (!LOBSTER2.secretHex) {
    console.error('Set LOBSTER2_SECRET_HEX env var to run this test');
    process.exit(1);
  }

  console.log('=== Step 1: Connect both lobsters ===');
  const t0 = Date.now();
  const r1 = await getSession('requester(lobster1)', LOBSTER1.did, LOBSTER1.secretHex);
  const r2 = await getSession('executor(lobster2)', LOBSTER2.did, LOBSTER2.secretHex);

  console.log('\n=== Step 2: Balance sanity ===');
  const bal = await callTool(r1, 'atel_balance', {}) as { balance: number; chainBalances: Record<string, number> };
  console.log(`  lobster1 total: ${bal.balance} USDC, base=${bal.chainBalances.base}`);
  const PRICE = Number(process.env.E2E_PRICE_USDC ?? 0.001);
  if (bal.chainBalances.base < PRICE * 1.2) {
    throw new Error(`lobster1 base balance ${bal.chainBalances.base} insufficient for ${PRICE} USDC order + buffer`);
  }

  console.log(`\n=== Step 3: lobster1 creates order (price ${PRICE} USDC) ===`);
  const order = await callTool(r1, 'atel_order_create', {
    executorDid: LOBSTER2.did,
    capabilityType: 'coding',
    description: 'G1 e2e test: write a small bash one-liner that prints all USB devices on Linux',
    priceUsdc: PRICE,
  }) as { orderId: string; status: string };
  console.log(`  order: ${order.orderId} status=${order.status}`);
  const orderId = order.orderId;

  console.log('\n=== Step 4: lobster2 accepts ===');
  const accepted = await callTool(r2, 'atel_order_accept', { orderId }) as { status: string };
  console.log(`  status=${accepted.status}`);

  console.log('\n=== Step 5: both approve milestone plan ===');
  await callTool(r1, 'atel_milestone_plan_feedback', { orderId, approved: true });
  console.log(`  lobster1 approved`);
  await callTool(r2, 'atel_milestone_plan_feedback', { orderId, approved: true });
  console.log(`  lobster2 approved`);

  console.log('\n=== Step 6: list milestones ===');
  const ms = await callTool(r1, 'atel_milestone_list', { orderId }) as { milestones: { index: number; title?: string }[] };
  console.log(`  ${ms.milestones.length} milestones`);
  ms.milestones.forEach(m => console.log(`    [${m.index}] ${m.title ?? '(no title)'}`));

  console.log('\n=== Step 7: submit + verify each milestone ===');
  for (const m of ms.milestones) {
    console.log(`  --- milestone ${m.index} ---`);
    await callTool(r2, 'atel_milestone_submit', {
      orderId,
      index: m.index,
      content: `Milestone ${m.index} deliverable: snow falls / packets refract / consensus blooms (G1 e2e auto-content, ${new Date().toISOString()})`,
    });
    console.log(`    lobster2 submitted`);
    await callTool(r1, 'atel_milestone_verify', { orderId, index: m.index });
    console.log(`    lobster1 verified ✓`);
  }

  console.log('\n=== Step 8: poll for auto-settle ===');
  // After all milestones verified, platform auto-transitions to settled.
  // No explicit confirm/complete needed (matches 5/1 v2 plan's design:
  // "atel_order_release 内部用，不暴露给 host").
  let finalStatus: string | undefined;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const detail = await callTool(r1, 'atel_order_get', { orderId }) as { status?: string; Status?: string };
    finalStatus = detail.status ?? detail.Status;
    if (finalStatus === 'settled' || finalStatus === 'completed') break;
    console.log(`  poll ${i+1}: status=${finalStatus}`);
  }

  if (finalStatus !== 'settled' && finalStatus !== 'completed') {
    throw new Error(`Order did not auto-settle within 15s. Last status: ${finalStatus}`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n🎉 G1 a2a e2e PASSED in ${elapsed}s — full path through atel-mcp tools`);
  console.log(`   order: ${orderId}`);
  console.log(`   final status: ${finalStatus}`);
}

main().catch((err) => {
  console.error('\n❌ FAILED:', err.message);
  process.exit(1);
});
