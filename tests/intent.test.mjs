/**
 * AVIP Intent Tests
 * Verifies: createIntent, verifyIntent, serialization consistency
 */

import { AgentIdentity, serializePayload, verify, parseDID } from '../dist/identity/index.js';
import { createIntent, verifyIntent } from '../dist/intent/index.js';

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}`);
    failed++;
  }
}

console.log('\n=== AVIP Intent Tests ===\n');

// Test 1: Create Intent
console.log('Test 1: createIntent generates valid structure');
const alice = new AgentIdentity();
const bobDid = 'did:atel:ed25519:' + Buffer.from(new Uint8Array(32).fill(1)).toString('base64url').replace(/=/g, '');
// Use a proper bob DID
const bob = new AgentIdentity();

const intent = createIntent(alice, bob.did, 'execute_task', {
  maxAmount: 500,
  milestoneCount: 5,
  deadline: '2026-04-15T00:00:00.000Z',
  scope: ['data_analysis', 'report'],
});

assert(intent.intentId.startsWith('intent_'), 'intentId starts with intent_');
assert(intent.issuerDid === alice.did, 'issuerDid matches alice');
assert(intent.subjectDid === bob.did, 'subjectDid matches bob');
assert(intent.action === 'execute_task', 'action is execute_task');
assert(intent.constraints.maxAmount === 500, 'maxAmount is 500');
assert(intent.constraints.milestoneCount === 5, 'milestoneCount is 5');
assert(intent.constraints.scope.length === 2, 'scope has 2 items');
assert(intent.signature.length > 0, 'signature is not empty');
assert(intent.delegationChain.length === 1, 'delegation chain has 1 step');
assert(intent.timestamp.length > 0, 'timestamp is set');

// Test 2: Verify Intent signature
console.log('\nTest 2: verifyIntent validates signature');
const isValid = verifyIntent(intent, alice.publicKey);
assert(isValid === true, 'signature valid with correct key');

// Test 3: Wrong key should fail
console.log('\nTest 3: Wrong key rejects signature');
const charlie = new AgentIdentity();
const isInvalid = verifyIntent(intent, charlie.publicKey);
assert(isInvalid === false, 'signature invalid with wrong key');

// Test 4: Tampered intent should fail
console.log('\nTest 4: Tampered intent rejects');
const tampered = { ...intent, action: 'steal_money' };
const isTampered = verifyIntent(tampered, alice.publicKey);
assert(isTampered === false, 'tampered intent rejected');

// Test 5: Serialization consistency (critical for SDK/Platform alignment)
console.log('\nTest 5: Serialization determinism');
const obj1 = { z: 1, a: 2, m: { y: 3, x: 4 } };
const obj2 = { a: 2, m: { x: 4, y: 3 }, z: 1 };
const s1 = serializePayload(obj1);
const s2 = serializePayload(obj2);
assert(s1 === s2, 'different key order produces same serialization');
assert(s1 === '{"a":2,"m":{"x":4,"y":3},"z":1}', 'serialized format matches expected');

// Test 6: Intent constraints with defaults
console.log('\nTest 6: Default milestoneCount');
const intent2 = createIntent(alice, bob.did, 'execute_task', {});
assert(intent2.constraints.milestoneCount === 5, 'default milestoneCount is 5');

// Test 7: Verify round-trip (create → serialize → verify)
console.log('\nTest 7: Full round-trip');
const signable = {
  action: intent.action,
  constraints: intent.constraints,
  issuerDid: intent.issuerDid,
  subjectDid: intent.subjectDid,
  timestamp: intent.timestamp,
};
const manualVerify = verify(signable, intent.signature, alice.publicKey);
assert(manualVerify === true, 'manual verify matches verifyIntent');

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
