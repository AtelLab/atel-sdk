/**
 * Generate and save an ATEL agent identity (key pair + DID)
 * Usage: npx tsx scripts/generate-identity.ts <agent-name> <output-file>
 */
import { AgentIdentity } from '../src/index.js';
import fs from 'node:fs';

const name = process.argv[2] || 'agent';
const outFile = process.argv[3] || `${name}-identity.json`;

const agent = new AgentIdentity({
  agent_id: name,
  metadata: { name, version: '1.0.0' },
});

const identityData = {
  agent_id: name,
  did: agent.did,
  publicKey: Buffer.from(agent.publicKey).toString('hex'),
  secretKey: Buffer.from(agent.secretKey).toString('hex'),
  createdAt: new Date().toISOString(),
};

fs.writeFileSync(outFile, JSON.stringify(identityData, null, 2));
console.log(`✅ Identity saved to ${outFile}`);
console.log(`   DID: ${agent.did}`);
console.log(`   Agent: ${name}`);
