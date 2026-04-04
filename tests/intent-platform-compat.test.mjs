/**
 * SDK/Platform Serialization Compatibility Test
 *
 * Verifies that the SDK's serializePayload produces the exact same output
 * as the Platform's deterministicJSON for Intent signing.
 *
 * If this test fails, the Platform will reject SDK-signed Intents.
 */

import { serializePayload } from '../dist/identity/index.js';

let passed = 0;
let failed = 0;

function assert(condition, name, detail) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}`);
    if (detail) console.error(`     ${detail}`);
    failed++;
  }
}

console.log('\n=== SDK/Platform Serialization Compatibility Tests ===\n');

// These test cases must match the Go deterministicJSON output exactly.
// If any fail, the Platform will reject Intent signatures.

// Case 1: Simple sorted keys
console.log('Case 1: Simple key sorting');
const c1 = serializePayload({ z: 1, a: 2, m: 3 });
assert(c1 === '{"a":2,"m":3,"z":1}', 'sorted keys', `got: ${c1}`);

// Case 2: Nested objects
console.log('Case 2: Nested object sorting');
const c2 = serializePayload({ b: { y: 2, x: 1 }, a: 'hello' });
assert(c2 === '{"a":"hello","b":{"x":1,"y":2}}', 'nested sorted', `got: ${c2}`);

// Case 3: Intent-shaped object (the actual signing input)
console.log('Case 3: Intent signing input');
const intentSignable = {
  action: 'execute_task',
  constraints: {
    maxAmount: 500,
    milestoneCount: 5,
    scope: ['data_analysis', 'report'],
  },
  issuerDid: 'did:atel:ed25519:abc123',
  subjectDid: 'did:atel:ed25519:def456',
  timestamp: '2026-04-01T10:00:00.000Z',
};
const c3 = serializePayload(intentSignable);
// Go output should be:
// {"action":"execute_task","constraints":{"maxAmount":500,"milestoneCount":5,"scope":["data_analysis","report"]},"issuerDid":"did:atel:ed25519:abc123","subjectDid":"did:atel:ed25519:def456","timestamp":"2026-04-01T10:00:00.000Z"}
const expected3 = '{"action":"execute_task","constraints":{"maxAmount":500,"milestoneCount":5,"scope":["data_analysis","report"]},"issuerDid":"did:atel:ed25519:abc123","subjectDid":"did:atel:ed25519:def456","timestamp":"2026-04-01T10:00:00.000Z"}';
assert(c3 === expected3, 'intent signable matches expected', `\n  expected: ${expected3}\n  got:      ${c3}`);

// Case 4: Float precision (potential divergence point)
console.log('Case 4: Float precision');
const c4 = serializePayload({ amount: 500.0 });
// JS: 500 (no .0), Go: 500 (no .0 for integer-valued floats)
assert(c4 === '{"amount":500}', 'integer float renders without .0', `got: ${c4}`);

// Case 5: Small float
const c5 = serializePayload({ amount: 0.5 });
assert(c5 === '{"amount":0.5}', 'small float renders correctly', `got: ${c5}`);

// Case 6: Null value
console.log('Case 5: Null handling');
const c6 = serializePayload({ a: null, b: 1 });
assert(c6 === '{"a":null,"b":1}', 'null preserved', `got: ${c6}`);

// Case 7: Empty object
const c7 = serializePayload({ constraints: {} });
assert(c7 === '{"constraints":{}}', 'empty object', `got: ${c7}`);

// Case 8: Array (should not be sorted, just kept in order)
console.log('Case 6: Array preservation');
const c8 = serializePayload({ items: ['c', 'a', 'b'] });
assert(c8 === '{"items":["c","a","b"]}', 'array order preserved', `got: ${c8}`);

// Case 9: Boolean
const c9 = serializePayload({ flag: true, other: false });
assert(c9 === '{"flag":true,"other":false}', 'booleans', `got: ${c9}`);

// Case 10: Deeply nested
console.log('Case 7: Deep nesting');
const c10 = serializePayload({
  z: { z: { z: 1, a: 2 }, a: 3 },
  a: 4,
});
assert(c10 === '{"a":4,"z":{"a":3,"z":{"a":2,"z":1}}}', 'deep nesting sorted', `got: ${c10}`);

// Case 11: Intent with no optional fields
console.log('Case 8: Minimal intent');
const minIntent = {
  action: 'execute_task',
  constraints: { milestoneCount: 5 },
  issuerDid: 'did:atel:ed25519:x',
  subjectDid: 'did:atel:ed25519:y',
  timestamp: '2026-04-01T00:00:00.000Z',
};
const c11 = serializePayload(minIntent);
assert(c11.startsWith('{"action":"execute_task"'), 'minimal intent starts correctly', `got: ${c11}`);
assert(c11.includes('"milestoneCount":5'), 'contains milestoneCount', `got: ${c11}`);

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.error('\n⚠️  SERIALIZATION MISMATCH: Platform will reject SDK-signed Intents!');
  console.error('    Fix deterministicJSON in Go or serializePayload in TS to match.\n');
}
process.exit(failed > 0 ? 1 : 0);
