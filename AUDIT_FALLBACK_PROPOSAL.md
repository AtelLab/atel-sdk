# 审计系统 Fallback 方案

## 问题
当前 SDK 的审计系统完全依赖本地 Ollama。如果用户没有安装 Ollama，审计会失败并返回 `passed: false`，这会阻止任务执行。

## 目标
让 SDK 在用户没有 Ollama 的情况下也能正常工作，提供多层 fallback 机制。

## 推荐方案：三层 Fallback

### 层级 1: 本地 Ollama（最快）
```typescript
// 当前实现
const ollamaEndpoint = 'http://localhost:11434';
const response = await fetch(`${ollamaEndpoint}/api/generate`, { ... });
```

**优点**：
- 最快（本地推理）
- 无需网络
- 隐私保护

**缺点**：
- 需要用户安装 Ollama
- 需要下载模型（~400MB）

---

### 层级 2: node-llama-cpp（备选）
```typescript
import { LlamaModel, LlamaContext } from 'node-llama-cpp';

private llamaModel?: LlamaModel;
private llamaContext?: LlamaContext;

async initLlamaCpp() {
  try {
    // 尝试加载本地 GGUF 模型
    const modelPath = join(process.cwd(), '.atel', 'models', 'qwen2.5-0.5b.gguf');
    if (existsSync(modelPath)) {
      this.llamaModel = new LlamaModel({ modelPath });
      this.llamaContext = new LlamaContext({ model: this.llamaModel });
    }
  } catch (e) {
    // 模型不存在，跳过
  }
}

async callLlamaCpp(prompt: string): Promise<string> {
  if (!this.llamaContext) throw new Error('LlamaCpp not initialized');
  
  const response = await this.llamaContext.evaluate(prompt);
  return response;
}
```

**优点**：
- 纯 Node.js，无需外部依赖
- 支持 GGUF 模型
- 可选安装（不强制）

**缺点**：
- 需要下载模型文件
- 性能略低于 Ollama
- 首次加载慢

---

### 层级 3: 远程 API Fallback（最后手段）
```typescript
private remoteApiKey?: string;
private remoteApiUrl?: string;

constructor(config: { 
  modelName?: string;
  remoteApiKey?: string;
  remoteApiUrl?: string;
} = {}) {
  this.modelName = config.modelName || DEFAULT_MODEL;
  this.remoteApiKey = config.remoteApiKey;
  this.remoteApiUrl = config.remoteApiUrl || 'https://api.openrouter.ai/api/v1/chat/completions';
}

async callRemoteAPI(prompt: string): Promise<string> {
  if (!this.remoteApiKey) throw new Error('Remote API key not configured');
  
  const response = await fetch(this.remoteApiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${this.remoteApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'qwen/qwen-2.5-7b-instruct',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  
  const data = await response.json();
  return data.choices[0].message.content;
}
```

**优点**：
- 无需本地资源
- 始终可用
- 支持更强大的模型

**缺点**：
- 需要 API key
- 需要网络
- 有成本
- 隐私问题（数据发送到远程）

---

## 完整实现

```typescript
async verify(task: Task, thinking: CoTReasoningChain): Promise<VerificationResult> {
  const prompt = this.buildAuditPrompt(task, thinking);

  // 层级 1: 尝试本地 Ollama
  try {
    const response = await this.callLocalLLM(prompt);
    return this.parseResponse(response);
  } catch (error: any) {
    console.warn('[LLM Verifier] Ollama unavailable:', error.message);
  }

  // 层级 2: 尝试 node-llama-cpp
  if (this.llamaContext) {
    try {
      const response = await this.callLlamaCpp(prompt);
      return this.parseResponse(response);
    } catch (error: any) {
      console.warn('[LLM Verifier] LlamaCpp failed:', error.message);
    }
  }

  // 层级 3: 尝试远程 API
  if (this.remoteApiKey) {
    try {
      const response = await this.callRemoteAPI(prompt);
      return this.parseResponse(response);
    } catch (error: any) {
      console.warn('[LLM Verifier] Remote API failed:', error.message);
    }
  }

  // 所有方法都失败，跳过审计
  console.warn('[LLM Verifier] All LLM methods failed, skipping audit');
  return {
    passed: true,
    violations: [],
    skipped: true,
    skip_reason: 'No LLM available for audit',
    confidence: 0,
  };
}
```

---

## 配置示例

### audit-config.json
```json
{
  "llm_model_path": "qwen2.5:0.5b",
  "strategy": "hybrid",
  "fallback": "rule",
  "require_cot_reasoning_capability": false,
  
  "llamaCpp": {
    "enabled": true,
    "modelPath": ".atel/models/qwen2.5-0.5b.gguf",
    "autoDownload": false
  },
  
  "remoteApi": {
    "enabled": false,
    "provider": "openrouter",
    "apiKey": "sk-or-...",
    "model": "qwen/qwen-2.5-7b-instruct"
  }
}
```

---

## 实施步骤

### 阶段 1: 改进错误处理（立即）
- [x] 当 Ollama 不可用时，返回 `skipped: true` 而不是 `passed: false`
- [ ] 添加更详细的日志

### 阶段 2: 添加 node-llama-cpp 支持（可选）
- [ ] 添加 `node-llama-cpp` 依赖（可选）
- [ ] 实现 `callLlamaCpp` 方法
- [ ] 添加模型自动下载功能

### 阶段 3: 添加远程 API fallback（可选）
- [ ] 实现 `callRemoteAPI` 方法
- [ ] 支持多个 API 提供商（OpenRouter, Together AI, etc.）
- [ ] 添加配置选项

---

## 推荐配置

### 开发环境
```json
{
  "llamaCpp": { "enabled": false },
  "remoteApi": { "enabled": false }
}
```
- 依赖本地 Ollama
- 如果没有 Ollama，跳过审计

### 生产环境
```json
{
  "llamaCpp": { "enabled": true, "autoDownload": true },
  "remoteApi": { "enabled": true, "apiKey": "..." }
}
```
- 优先使用 Ollama
- Fallback 到 node-llama-cpp
- 最后 fallback 到远程 API

---

## 成本分析

### 方案 1: 仅 Ollama
- 成本：$0
- 用户体验：需要手动安装

### 方案 2: Ollama + node-llama-cpp
- 成本：$0
- 用户体验：自动 fallback，但需要下载模型

### 方案 3: Ollama + node-llama-cpp + 远程 API
- 成本：~$0.001/次审计（远程 API）
- 用户体验：最佳，始终可用

---

## 建议

**短期（立即实施）**：
- 改进错误处理，返回 `skipped: true`

**中期（1-2 周）**：
- 添加 node-llama-cpp 支持（可选依赖）

**长期（按需）**：
- 添加远程 API fallback（配置选项）

---

## 问题讨论

1. **是否应该强制要求 Ollama？**
   - 不应该。审计是可选功能，不应该阻止主流程。

2. **node-llama-cpp 是否应该作为默认依赖？**
   - 不应该。它很大（~100MB），应该作为可选依赖。

3. **远程 API 是否应该默认启用？**
   - 不应该。涉及隐私和成本，应该由用户明确配置。

4. **如何处理模型下载？**
   - 提供 CLI 命令：`atel audit setup`
   - 自动检测并提示用户

---

## 相关 Issue

- [ ] 创建 GitHub Issue: "Add fallback mechanisms for audit system"
- [ ] 讨论社区反馈
- [ ] 确定优先级
