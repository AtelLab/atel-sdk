# ATEL 开发工作流程

## 一、分支策略

### 分支结构

```
main (生产)
  ↑
  PR (需要 review)
  ↑
develop (测试)
  ↑
  合并或 PR
  ↑
feature/xxx (功能开发)
```

### 分支说明

| 分支 | 用途 | 保护规则 | 部署环境 |
|------|------|---------|---------|
| **main** | 生产代码 | ✅ 禁止直接 push<br>✅ 必须通过 PR | 生产环境 |
| **develop** | 测试代码 | ✅ 可以直接 push<br>❌ 不需要 PR | 测试环境 |
| **feature/\*** | 功能开发 | ❌ 无限制 | 本地 |

---

## 二、日常开发流程

### 1. 开始新功能

```bash
# 1. 切换到 develop 分支
git checkout develop
git pull origin develop

# 2. 创建功能分支
git checkout -b feature/add-xxx

# 例如：
# feature/add-payment-gateway
# feature/fix-registry-bug
# feature/update-docs
```

### 2. 开发 + 提交

```bash
# 1. 修改代码
vim src/xxx.ts

# 2. 测试（连接测试环境）
./start-test.sh start 3100

# 3. 提交
git add .
git commit -m "feat: add xxx feature"

# 提交信息规范：
# feat: 新功能
# fix: 修复 bug
# docs: 文档更新
# refactor: 重构
# test: 测试
# chore: 构建/工具
```

### 3. 推送到远程

```bash
git push origin feature/add-xxx
```

### 4. 合并到 develop

**方式 A：直接合并（小改动）**

```bash
# 1. 切换到 develop
git checkout develop
git pull origin develop

# 2. 合并功能分支
git merge feature/add-xxx

# 3. 推送
git push origin develop

# 4. 删除功能分支
git branch -d feature/add-xxx
git push origin --delete feature/add-xxx
```

**方式 B：创建 PR（大改动，需要 review）**

```bash
# 1. 在 GitHub 网页创建 PR
# 从：feature/add-xxx
# 到：develop

# 2. 等待 review 和测试

# 3. 合并 PR

# 4. 删除功能分支
git branch -d feature/add-xxx
git push origin --delete feature/add-xxx
```

---

## 三、发布到生产

### 1. 测试环境验证

```bash
# 1. 确保 develop 分支代码已充分测试
# 2. 所有测试用例通过
# 3. 功能验证完成
```

### 2. 创建 PR 到 main

```bash
# 在 GitHub 网页创建 PR
# 从：develop
# 到：main

# PR 标题：Release v0.8.x
# PR 描述：列出本次发布的所有功能和修复
```

### 3. Review 和合并

```bash
# 1. 至少 1 人 review（如果有团队成员）
# 2. 所有检查通过
# 3. 合并 PR
```

### 4. 打 Tag

```bash
# 1. 切换到 main
git checkout main
git pull origin main

# 2. 打 tag
git tag v0.8.14
git push origin v0.8.14

# 3. 在 GitHub 创建 Release
# 标题：v0.8.14
# 描述：Release notes
```

### 5. 部署到生产

```bash
# 1. 登录生产服务器
ssh root@47.251.8.19

# 2. 拉取最新代码
cd /opt/atel/atel-platform
git pull origin main

# 3. 重启服务
pm2 restart atel-platform

# 4. 验证
curl https://api.atelai.org/registry/v1/stats
```

---

## 四、环境切换

### 本地开发 → 测试环境

```bash
# 使用测试脚本
cd atel-sdk
./start-test.sh start 3100

# 或设置环境变量
export ATEL_REGISTRY=http://39.102.61.79:8200
export ATEL_PLATFORM=http://39.102.61.79:8200
export ATEL_RELAY=http://39.102.61.79:8200
node bin/atel.mjs start 3100
```

### 本地开发 → 生产环境

```bash
# 不设置环境变量，直接使用
cd atel-sdk
node bin/atel.mjs start 3100
```

---

## 五、代码规范

### Commit Message 规范

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type：**
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `test`: 测试
- `chore`: 构建/工具

**示例：**

```bash
# 好的 commit
git commit -m "feat(registry): add agent search by capability"
git commit -m "fix(platform): resolve order status update bug"
git commit -m "docs: update test environment guide"

# 不好的 commit
git commit -m "update"
git commit -m "fix bug"
git commit -m "改了一些东西"
```

### 分支命名规范

```
feature/功能描述
fix/bug描述
docs/文档描述
refactor/重构描述
```

**示例：**

```bash
# 好的分支名
feature/add-payment-gateway
fix/registry-search-bug
docs/update-api-guide
refactor/simplify-trace-logic

# 不好的分支名
test
dev
my-branch
张三的分支
```

---

## 六、测试流程

### 1. 单元测试（如果有）

```bash
npm test
```

### 2. 集成测试

```bash
# 连接测试环境
./start-test.sh start 3100

# 测试各项功能
./start-test.sh register
./start-test.sh search
./start-test.sh task <did> '{"action":"general","payload":{"prompt":"test"}}'
```

### 3. 端到端测试

```bash
# 1. 创建订单
./start-test.sh order <executor-did> general 0 --desc "测试"

# 2. 验证订单状态
# 3. 验证 trace 和 proof
# 4. 验证链上锚定
```

---

## 七、常见场景

### 场景 1：修复紧急 bug

```bash
# 1. 从 main 创建 hotfix 分支
git checkout main
git pull origin main
git checkout -b hotfix/critical-bug

# 2. 修复 bug
vim src/xxx.ts
git commit -m "fix: resolve critical bug"

# 3. 直接 PR 到 main（跳过 develop）
# 4. 合并后，同步到 develop
git checkout develop
git merge main
git push origin develop
```

### 场景 2：多人协作同一功能

```bash
# 开发者 A
git checkout -b feature/payment-gateway
# 开发 + 提交
git push origin feature/payment-gateway

# 开发者 B
git checkout feature/payment-gateway
git pull origin feature/payment-gateway
# 继续开发
git push origin feature/payment-gateway
```

### 场景 3：解决冲突

```bash
# 1. 更新 develop
git checkout develop
git pull origin develop

# 2. 合并到功能分支
git checkout feature/add-xxx
git merge develop

# 3. 解决冲突
vim conflicted-file.ts
git add conflicted-file.ts
git commit -m "merge: resolve conflicts with develop"

# 4. 推送
git push origin feature/add-xxx
```

---

## 八、最佳实践

### ✅ 推荐

1. **小步提交**
   - 每个 commit 只做一件事
   - 便于 review 和回滚

2. **频繁同步**
   - 每天至少一次 `git pull origin develop`
   - 减少冲突

3. **及时清理**
   - 功能合并后立刻删除分支
   - 保持分支列表整洁

4. **充分测试**
   - 本地测试通过再推送
   - develop 测试通过再发布

5. **清晰描述**
   - Commit message 描述清楚
   - PR 描述详细

### ❌ 避免

1. **不要直接 push 到 main**
   - 必须通过 PR

2. **不要在 develop 上开发**
   - 使用 feature 分支

3. **不要提交大文件**
   - 使用 .gitignore

4. **不要提交敏感信息**
   - API key、密码等

5. **不要 force push 到共享分支**
   - 会覆盖别人的提交

---

## 九、快速参考

### 常用命令

```bash
# 查看分支
git branch -a

# 切换分支
git checkout develop

# 创建分支
git checkout -b feature/xxx

# 查看状态
git status

# 查看差异
git diff

# 提交
git add .
git commit -m "feat: xxx"

# 推送
git push origin feature/xxx

# 拉取
git pull origin develop

# 合并
git merge feature/xxx

# 删除分支
git branch -d feature/xxx
git push origin --delete feature/xxx

# 查看日志
git log --oneline --graph
```

### 环境变量

```bash
# 测试环境
export ATEL_REGISTRY=http://39.102.61.79:8200
export ATEL_PLATFORM=http://39.102.61.79:8200
export ATEL_RELAY=http://39.102.61.79:8200

# 生产环境（默认）
# 不需要设置
```

---

**更新时间：** 2026-03-11
**维护者：** Lawrence
