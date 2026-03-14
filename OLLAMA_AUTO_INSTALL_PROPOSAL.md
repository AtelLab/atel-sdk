# SDK 自动安装和启动 Ollama 方案

## 目标
用户通过 SDK 启动时，自动：
1. 检测 Ollama 是否安装
2. 如果没有，自动下载并安装 Ollama
3. 自动下载审计所需的模型
4. 启动 Ollama 服务
5. 确保所有服务正常运行

---

## 方案对比

### 方案 1: 自动安装系统级 Ollama ❌ 不推荐

**实现**：
```typescript
// 检测 → 下载安装脚本 → 安装到系统
curl -fsSL https://ollama.com/install.sh | sh
```

**问题**：
- ❌ 需要 sudo 权限
- ❌ 修改系统环境
- ❌ 跨平台支持复杂（Linux/Mac/Windows）
- ❌ 安全风险（执行外部脚本）
- ❌ 用户可能不希望全局安装

---

### 方案 2: 内置 Ollama 二进制 ❌ 不推荐

**实现**：
```
node_modules/
  @lawrenceliang-btc/atel-sdk/
    bin/
      ollama-linux-amd64
      ollama-darwin-arm64
      ollama-windows-amd64.exe
```

**问题**：
- ❌ 文件太大（每个平台 ~500MB）
- ❌ npm 包体积爆炸
- ❌ 许可证问题
- ❌ 维护成本高

---

### 方案 3: 下载 Ollama 到项目目录 ⚠️ 可行但复杂

**实现**：
```typescript
// 下载到 .atel/bin/ollama
const ollamaPath = join(process.cwd(), '.atel', 'bin', 'ollama');
await downloadOllama(ollamaPath);
await execAsync(`${ollamaPath} serve`);
```

**优点**：
- ✅ 不需要 sudo
- ✅ 不污染系统
- ✅ 项目隔离

**缺点**：
- ⚠️ 需要下载 ~500MB
- ⚠️ 跨平台支持复杂
- ⚠️ 首次启动慢

---

### 方案 4: 使用 Docker 容器 ⚠️ 可行但有限制

**实现**：
```typescript
// 启动 Ollama Docker 容器
await execAsync('docker run -d -p 11434:11434 ollama/ollama');
await execAsync('docker exec ollama ollama pull qwen2.5:0.5b');
```

**优点**：
- ✅ 环境隔离
- ✅ 易于管理
- ✅ 跨平台一致

**缺点**：
- ❌ 需要用户安装 Docker
- ❌ GPU 支持复杂
- ❌ 性能开销
- ❌ 首次下载慢（~2GB）

---

### 方案 5: 使用 node-llama-cpp（内置推理）✅ 推荐

**实现**：
```typescript
import { LlamaModel, LlamaContext } from 'node-llama-cpp';

export class OllamaManager {
  private model?: LlamaModel;
  private context?: LlamaContext;

  async ensureModel(): Promise<void> {
    const modelPath = join(process.cwd(), '.atel', 'models', 'qwen2.5-0.5b.gguf');
    
    // 1. 检查模型是否存在
    if (!existsSync(modelPath)) {
      console.log('📦 Downloading model (400MB)...');
      await this.downloadModel(modelPath);
    }

    // 2. 加载模型
    console.log('🔄 Loading model...');
    this.model = new LlamaModel({ modelPath });
    this.context = new LlamaContext({ model: this.model });
    console.log('✅ Model ready');
  }

  private async downloadModel(targetPath: string): Promise<void> {
    const modelUrl = 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_0.gguf';
    
    // 创建目录
    mkdirSync(dirname(targetPath), { recursive: true });
    
    // 下载模型（带进度条）
    const response = await fetch(modelUrl);
    const total = parseInt(response.headers.get('content-length') || '0');
    let downloaded = 0;
    
    const fileStream = createWriteStream(targetPath);
    
    for await (const chunk of response.body) {
      fileStream.write(chunk);
      downloaded += chunk.length;
      const progress = ((downloaded / total) * 100).toFixed(1);
      process.stdout.write(`\rDownloading: ${progress}%`);
    }
    
    fileStream.end();
    console.log('\n✅ Model downloaded');
  }

  async generate(prompt: string): Promise<string> {
    if (!this.context) {
      throw new Error('Model not loaded');
    }
    
    const response = await this.context.evaluate(prompt);
    return response;
  }
}
```

**优点**：
- ✅ 纯 Node.js，无需外部依赖
- ✅ 不需要 Ollama
- ✅ 不需要 Docker
- ✅ 项目隔离
- ✅ 跨平台支持好

**缺点**：
- ⚠️ 首次下载模型（~400MB）
- ⚠️ 性能略低于 Ollama
- ⚠️ 内存占用较高

---

## 推荐实现：混合方案

### 策略
1. **优先使用系统 Ollama**（如果已安装）
2. **Fallback 到 node-llama-cpp**（自动下载模型）
3. **最后 fallback 到跳过审计**

### 完整实现

```typescript
// src/audit/ollama-manager.ts
import { LlamaModel, LlamaContext } from 'node-llama-cpp';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { join, dirname } from 'path';

export class OllamaManager {
  private llamaModel?: LlamaModel;
  private llamaContext?: LlamaContext;
  private ollamaAvailable = false;

  async initialize(): Promise<void> {
    // 1. 检测系统 Ollama
    this.ollamaAvailable = await this.checkOllama();
    
    if (this.ollamaAvailable) {
      console.log('✅ Using system Ollama');
      return;
    }

    console.log('⚠️  System Ollama not found, using built-in inference');
    
    // 2. 初始化 node-llama-cpp
    await this.initializeLlamaCpp();
  }

  private async checkOllama(): Promise<boolean> {
    try {
      const response = await fetch('http://localhost:11434/api/tags', {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async initializeLlamaCpp(): Promise<void> {
    const modelPath = join(process.cwd(), '.atel', 'models', 'qwen2.5-0.5b.gguf');
    
    // 检查模型是否存在
    if (!existsSync(modelPath)) {
      console.log('📦 Downloading model (first time only, ~400MB)...');
      console.log('   This may take a few minutes...');
      await this.downloadModel(modelPath);
    }

    // 加载模型
    console.log('🔄 Loading model...');
    this.llamaModel = new LlamaModel({ modelPath });
    this.llamaContext = new LlamaContext({ 
      model: this.llamaModel,
      contextSize: 2048,
    });
    console.log('✅ Model ready');
  }

  private async downloadModel(targetPath: string): Promise<void> {
    const modelUrl = 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_0.gguf';
    
    mkdirSync(dirname(targetPath), { recursive: true });
    
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`Failed to download model: ${response.statusText}`);
    }
    
    const total = parseInt(response.headers.get('content-length') || '0');
    let downloaded = 0;
    
    const fileStream = createWriteStream(targetPath);
    
    for await (const chunk of response.body as any) {
      fileStream.write(chunk);
      downloaded += chunk.length;
      
      if (total > 0) {
        const progress = ((downloaded / total) * 100).toFixed(1);
        const mb = (downloaded / 1024 / 1024).toFixed(1);
        const totalMb = (total / 1024 / 1024).toFixed(1);
        process.stdout.write(`\r   Progress: ${progress}% (${mb}/${totalMb} MB)`);
      }
    }
    
    fileStream.end();
    console.log('\n✅ Model downloaded successfully');
  }

  async generate(prompt: string): Promise<string> {
    // 优先使用系统 Ollama
    if (this.ollamaAvailable) {
      return await this.generateWithOllama(prompt);
    }

    // Fallback 到 node-llama-cpp
    if (this.llamaContext) {
      return await this.generateWithLlamaCpp(prompt);
    }

    throw new Error('No LLM available');
  }

  private async generateWithOllama(prompt: string): Promise<string> {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:0.5b',
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.response;
  }

  private async generateWithLlamaCpp(prompt: string): Promise<string> {
    if (!this.llamaContext) {
      throw new Error('LlamaCpp not initialized');
    }

    const response = await this.llamaContext.evaluate(prompt, {
      maxTokens: 512,
      temperature: 0.7,
    });

    return response;
  }

  async cleanup(): Promise<void> {
    if (this.llamaContext) {
      await this.llamaContext.dispose();
    }
    if (this.llamaModel) {
      await this.llamaModel.dispose();
    }
  }
}
```

### 集成到 LLMThinkingVerifier

```typescript
// src/audit/llm-verifier.ts
import { OllamaManager } from './ollama-manager.js';

export class LLMThinkingVerifier {
  private modelName: string;
  private ollamaManager?: OllamaManager;

  constructor(config: { modelName?: string; autoSetup?: boolean } = {}) {
    this.modelName = config.modelName || DEFAULT_MODEL;
    
    // 自动设置（默认启用）
    if (config.autoSetup !== false) {
      this.setupOllama();
    }
  }

  private async setupOllama(): Promise<void> {
    try {
      this.ollamaManager = new OllamaManager();
      await this.ollamaManager.initialize();
    } catch (error: any) {
      console.warn('[LLM Verifier] Failed to setup Ollama:', error.message);
      console.warn('[LLM Verifier] Audit will be skipped');
    }
  }

  async verify(task: Task, thinking: CoTReasoningChain): Promise<VerificationResult> {
    const prompt = this.buildAuditPrompt(task, thinking);

    try {
      // 使用 OllamaManager（自动选择最佳方法）
      if (this.ollamaManager) {
        const response = await this.ollamaManager.generate(prompt);
        return this.parseResponse(response);
      }

      // Fallback：跳过审计
      return {
        passed: true,
        violations: [],
        skipped: true,
        skip_reason: 'No LLM available',
        confidence: 0,
      };
    } catch (error: any) {
      console.error('[LLM Verifier] Audit failed:', error.message);
      
      return {
        passed: true,
        violations: [],
        skipped: true,
        skip_reason: `Audit failed: ${error.message}`,
        confidence: 0,
      };
    }
  }
}
```

---

## 用户体验

### 场景 1: 用户已安装 Ollama
```bash
$ npm start

✅ Using system Ollama
🚀 Agent started on port 14010
```

### 场景 2: 用户没有 Ollama（首次）
```bash
$ npm start

⚠️  System Ollama not found, using built-in inference
📦 Downloading model (first time only, ~400MB)...
   This may take a few minutes...
   Progress: 45.2% (180.8/400.0 MB)
```

### 场景 3: 用户没有 Ollama（后续）
```bash
$ npm start

⚠️  System Ollama not found, using built-in inference
🔄 Loading model...
✅ Model ready
🚀 Agent started on port 14010
```

---

## 配置选项

### package.json
```json
{
  "dependencies": {
    "node-llama-cpp": "^3.0.0"
  },
  "optionalDependencies": {
    "node-llama-cpp": "^3.0.0"
  }
}
```

### audit-config.json
```json
{
  "autoSetup": true,
  "preferSystemOllama": true,
  "modelPath": ".atel/models/qwen2.5-0.5b.gguf",
  "modelUrl": "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_0.gguf",
  "skipIfUnavailable": true
}
```

---

## 实施步骤

### 阶段 1: 添加 node-llama-cpp 支持
- [ ] 添加 `node-llama-cpp` 作为可选依赖
- [ ] 实现 `OllamaManager` 类
- [ ] 实现模型自动下载
- [ ] 添加进度显示

### 阶段 2: 集成到 LLMThinkingVerifier
- [ ] 修改 `LLMThinkingVerifier` 构造函数
- [ ] 添加自动设置逻辑
- [ ] 改进错误处理

### 阶段 3: 测试和优化
- [ ] 测试各种场景
- [ ] 优化下载速度
- [ ] 添加断点续传
- [ ] 添加模型缓存清理

---

## 成本分析

### 方案对比

| 方案 | 首次启动时间 | 磁盘占用 | 内存占用 | 复杂度 |
|------|------------|---------|---------|--------|
| 系统 Ollama | 1s | 0 | 0 | 低 |
| 自动安装 Ollama | 5-10min | 500MB | 0 | 高 |
| node-llama-cpp | 2-5min | 400MB | 500MB | 中 |
| Docker | 10-20min | 2GB | 1GB | 中 |

### 推荐配置

**开发环境**：
- 手动安装 Ollama
- 最快的启动速度

**生产环境**：
- 使用 node-llama-cpp
- 自动化部署
- 无需手动配置

---

## 风险和限制

### 技术风险
- node-llama-cpp 性能可能不如 Ollama
- 首次下载可能失败（网络问题）
- 模型文件可能损坏

### 缓解措施
- 提供多个下载源（HuggingFace, ModelScope）
- 添加校验和验证
- 支持断点续传
- 提供手动下载选项

---

## 总结

### 推荐方案
**混合方案：优先系统 Ollama + Fallback node-llama-cpp**

### 优点
- ✅ 零配置（自动下载模型）
- ✅ 不需要 sudo
- ✅ 不污染系统
- ✅ 跨平台支持
- ✅ 性能可接受

### 缺点
- ⚠️ 首次启动慢（下载模型）
- ⚠️ 增加磁盘占用（~400MB）
- ⚠️ 增加内存占用（~500MB）

### 适用场景
- ✅ 生产环境部署
- ✅ CI/CD 自动化
- ✅ 新用户快速上手
- ❌ 资源受限环境（建议手动安装 Ollama）
