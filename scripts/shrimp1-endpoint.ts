/**
 * 虾米1 (Shrimp1) — ATEL Endpoint
 * 角色: 任务委托方 (Task Requestor)
 * 
 * 启动后等待与虾米2建立连接
 */
import fs from 'node:fs';
import {
  AgentIdentity,
  AgentEndpoint,
  AgentClient,
  HandshakeManager,
  createMessage,
  ExecutionTrace,
  ProofVerifier,
} from '../src/index.js';

const PORT = 14001;

// Load identity
const idData = JSON.parse(fs.readFileSync('shrimp1-identity.json', 'utf-8'));

const shrimp1 = new AgentIdentity({
  agent_id: idData.agent_id,
  metadata: { name: '虾米1', version: '1.0.0' },
  secretKey: Buffer.from(idData.secretKey, 'hex'),
});

console.log('🦐 虾米1 启动中...');
console.log(`   DID: ${shrimp1.did}`);

// Create endpoint
const endpoint = new AgentEndpoint(shrimp1, {
  port: PORT,
  host: '0.0.0.0',
});

// Handle incoming tasks (虾米1 also can receive tasks)
endpoint.onTask(async (message, session) => {
  console.log(`📥 收到任务: ${JSON.stringify(message.payload)}`);
  console.log(`   来自: ${message.from}`);
  console.log(`   加密: ${session?.encrypted ?? false}`);
  return { status: 'received', message: '虾米1 收到了！🦐' };
});

// Start
await endpoint.start();
console.log(`\n✅ 虾米1 ATEL Endpoint 运行中`);
console.log(`   本地: http://localhost:${PORT}`);
console.log(`   公网: http://43.160.230.129:${PORT}`);
console.log(`   Health: http://43.160.230.129:${PORT}/atel/v1/health`);
console.log('\n⏳ 等待虾米2 连接...\n');

// Keep alive
process.on('SIGINT', async () => {
  console.log('\n🛑 虾米1 关闭中...');
  await endpoint.stop();
  process.exit(0);
});
