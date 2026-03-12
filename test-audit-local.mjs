#!/usr/bin/env node

/**
 * 本地测试脚本 - 完整的分层审计流程
 * 
 * 测试流程：
 * 1. 直接调用 Executor 执行任务
 * 2. Executor 自动提取 thinking chain
 * 3. Executor 自动执行分层审计
 * 4. 查看审计日志
 */

const EXECUTOR_URL = 'http://localhost:14003';

console.log('🧪 ATEL 分层审计本地测试\n');
console.log('='.repeat(60));

// 测试任务
const testPrompt = '请一步一步思考并计算：37 × 28 = ？';
const taskId = `test-${Date.now()}`;

console.log('\n📋 测试任务：');
console.log(`  任务ID: ${taskId}`);
console.log(`  提示: ${testPrompt}`);

// 步骤1：发送任务到 Executor
console.log('\n📤 步骤1：发送任务到 Executor...');
try {
  const response = await fetch(`${EXECUTOR_URL}/internal/openclaw_agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tool: 'openclaw_agent',
      input: {
        prompt: testPrompt,
        taskId: taskId,
      },
    }),
  });

  if (!response.ok) {
    console.error(`❌ 任务提交失败: ${response.status}`);
    console.error(await response.text());
    process.exit(1);
  }

  console.log('✅ 任务已提交');
  
  // 步骤2：等待任务完成
  console.log('\n⏳ 步骤2：等待任务执行（包含审计）...');
  await new Promise(resolve => setTimeout(resolve, 8000));

  // 步骤3：查看结果文件
  console.log('\n📥 步骤3：查看结果...');
  const resultPath = `.atel/results/${taskId}.json`;
  
  try {
    const fs = await import('fs');
    if (fs.existsSync(resultPath)) {
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
      
      console.log('\n✅ 任务完成！');
      console.log('\n📊 结果：');
      console.log(`  响应: ${result.response?.substring(0, 100)}...`);
      
      if (result.thinking) {
        console.log('\n🧠 Thinking Chain:');
        console.log(`  步骤数: ${result.thinking.steps?.length || 0}`);
        result.thinking.steps?.forEach((step, i) => {
          console.log(`    ${i + 1}. ${step.substring(0, 60)}...`);
        });
      } else {
        console.log('\n⚠️  未提取到 thinking chain');
      }
    } else {
      console.log(`⚠️  结果文件不存在: ${resultPath}`);
    }
  } catch (error) {
    console.log(`⚠️  读取结果文件失败: ${error.message}`);
  }

} catch (error) {
  console.error('❌ 连接 Executor 失败:', error.message);
  console.error('\n💡 请确保 Agent 正在运行：');
  console.error('   cd ~/repos/atel-sdk && node bin/atel.mjs start 14001');
  process.exit(1);
}

// 步骤4：查看审计日志
console.log('\n📝 步骤4：查看 Executor 审计日志...');
console.log('\n运行以下命令查看审计日志：');
console.log('  tail -100 /tmp/lobster-final.log | grep -E "audit|thinking"');

console.log('\n' + '='.repeat(60));
console.log('✅ 测试完成！');
console.log('\n💡 说明：');
console.log('  - Executor 在后台异步执行审计');
console.log('  - 审计失败不会阻塞任务完成');
console.log('  - 审计结果记录在 Executor 日志中');
console.log('  - 查找日志中的 "thinking_audit_passed" 或 "thinking_audit_failed"');
