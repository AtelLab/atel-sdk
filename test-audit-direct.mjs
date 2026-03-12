#!/usr/bin/env node

/**
 * 直接测试审计功能 - 模拟包含 thinking chain 的结果
 */

import { TieredAuditVerifier } from './dist/audit/tiered-verifier.js';
import { LLMThinkingVerifier } from './dist/audit/llm-verifier.js';

console.log('🧪 直接测试审计功能\n');

// 模拟一个包含 thinking chain 的结果
const mockResult = {
  done: true,
  response: `<thinking>
Step 1: 理解问题
需要计算 89 × 34 的乘积，这是一个两位数乘法问题。

Step 2: 选择计算方法
使用分解法：89 × 34 = 89 × (30 + 4) = 89 × 30 + 89 × 4

Step 3: 执行计算过程
- 首先计算 89 × 30 = 2670
- 然后计算 89 × 4 = 356
- 最后相加：2670 + 356 = 3026

Step 4: 验证答案
使用另一种方法验证：89 × 34 = (90 - 1) × 34 = 3060 - 34 = 3026 ✓

Conclusion: 经过计算和验证，89 × 34 = 3026
</thinking>

答案：3026`
};

// 提取 thinking chain（模拟 executor 的逻辑）
const thinkingMatch = mockResult.response.match(/<thinking>([\s\S]*?)<\/thinking>/);
if (!thinkingMatch) {
  console.log('❌ 未找到 thinking 标签');
  process.exit(1);
}

const thinkingText = thinkingMatch[1];
const steps = [];
const stepMatches = thinkingText.matchAll(/Step \d+[：:]\s*([^\n]+)/g);
for (const match of stepMatches) {
  steps.push(match[1].trim());
}

const conclusionMatch = thinkingText.match(/Conclusion[：:]\s*([^\n]+)/);
const conclusion = conclusionMatch ? conclusionMatch[1].trim() : '';

const thinkingChain = {
  steps,
  reasoning: thinkingText.trim(),
  conclusion,
};

console.log('✅ Thinking Chain 提取成功：');
console.log(`  步骤数: ${steps.length}`);
console.log(`  步骤: ${steps.join(' | ')}`);
console.log(`  结论: ${conclusion}\n`);

// 创建审计验证器
const llmVerifier = new LLMThinkingVerifier({
  endpoint: 'http://localhost:11434',
  modelName: 'qwen2.5:0.5b',
});

const auditVerifier = new TieredAuditVerifier(llmVerifier, {
  requireThinkingCapability: false,
});

// 模拟任务
const task = {
  task_id: 'direct-audit-test',
  version: 'task.v0.1',
  issuer: 'test',
  intent: {
    type: 'calculation',
    goal: '计算 89 乘以 34 等于多少？需要展示计算过程和验证步骤。', // 更多关键词
  },
  risk: {
    level: 'low', // 使用规则验证
  },
  nonce: Date.now().toString(),
};

const modelInfo = {
  name: 'claude-sonnet-4',
  provider: 'anthropic',
};

console.log('🔍 开始审计...\n');

// 调试：查看关键词提取
const taskGoal = task.intent.goal.toLowerCase();
const STOPWORDS = ['the', 'is', 'a', 'an', 'and', 'or', 'but', '的', '是', '了', '在', '有', '个', '这', '那'];
const keywords = taskGoal
  .split(/\s+/)
  .filter(w => w.length > 2)
  .filter(w => !STOPWORDS.includes(w));

console.log('📝 调试信息：');
console.log(`  任务目标: ${task.intent.goal}`);
console.log(`  提取的关键词: ${keywords.join(', ')}`);
console.log(`  Thinking 文本长度: ${thinkingChain.reasoning.length} 字符\n`);

try {
  const result = await auditVerifier.verify(task, thinkingChain, modelInfo);
  
  console.log('📊 审计结果：');
  console.log(`  通过: ${result.passed ? '✅ 是' : '❌ 否'}`);
  console.log(`  置信度: ${result.confidence}`);
  console.log(`  策略: ${result.strategy}`);
  
  if (result.violations && result.violations.length > 0) {
    console.log(`  违规: ${result.violations.join(', ')}`);
  }
  
  if (result.details) {
    console.log(`  详情: ${result.details}`);
  }
  
  console.log('\n✅ 审计测试完成！');
  
} catch (error) {
  console.error('❌ 审计失败:', error.message);
  process.exit(1);
}
