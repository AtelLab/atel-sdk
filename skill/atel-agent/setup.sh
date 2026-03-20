#!/bin/bash
# ATEL Agent 一键设置 — 小龙虾跑这一个脚本就行
# 不用 set -e，每步自己检查错误

echo "🤝 ATEL Agent Setup Starting..."

# 1. 创建专用目录
mkdir -p ~/atel-workspace
cd ~/atel-workspace

# 2. 安装 SDK
if ! which atel > /dev/null 2>&1; then
  echo "📦 Installing ATEL SDK..."
  npm install -g @lawrenceliang-btc/atel-sdk
fi
echo "✅ SDK: $(which atel)"

# 3. 生成唯一名字
AGENT_NAME="agent-$(hostname -s 2>/dev/null || echo x)-$$"

# 4. 初始化身份
if [ ! -f .atel/identity.json ]; then
  echo "🔑 Creating identity as ${AGENT_NAME}..."
  echo 'n' | ATEL_API=https://api.atelai.org atel init "${AGENT_NAME}"
else
  echo "✅ Identity already exists"
  # 从已有 identity 提取 agent_id 作为名字
  AGENT_NAME=$(cat .atel/identity.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('agent_id','agent-reuse'))" 2>/dev/null || echo "$AGENT_NAME")
fi

DID=$(cat .atel/identity.json | python3 -c "import sys,json; print(json.load(sys.stdin)['did'])" 2>/dev/null)
echo "✅ DID: $DID"

# 5. 注册（失败就换名重试）
MY_IP=$(curl -s --connect-timeout 5 ifconfig.me 2>/dev/null || echo "127.0.0.1")
PORT=${ATEL_PORT:-3000}
echo "📡 Registering ${AGENT_NAME} at http://${MY_IP}:${PORT}..."
REG_OK=0
for i in 1 2 3; do
  ATEL_API=https://api.atelai.org atel register "${AGENT_NAME}" general "http://${MY_IP}:${PORT}" 2>&1
  if [ $? -eq 0 ]; then
    REG_OK=1
    break
  fi
  echo "⚠️ Attempt $i failed, trying different name..."
  AGENT_NAME="agent-$(head -c 4 /dev/urandom | od -A n -t x1 | tr -d ' \n')"
  sleep 2
done
if [ $REG_OK -eq 0 ]; then
  echo "❌ Registration failed after 3 attempts"
fi

# 6. 先启动 pm2（不等钱包，让 atel start 自己注册+心跳）
if ! which pm2 > /dev/null 2>&1; then
  npm install -g pm2
fi
WORKSPACE="$HOME/atel-workspace"
pm2 delete atel-agent 2>/dev/null
pm2 start "cd ${WORKSPACE} && ATEL_API=https://api.atelai.org atel start ${PORT}" --name atel-agent --cwd "${WORKSPACE}"
pm2 save 2>/dev/null

# 7. 等钱包部署（在 pm2 之后，这样即使这步被截断，atel start 已经跑着了）
echo "⏳ Waiting for wallet (20s)..."
sleep 20

# 8. 显示结果
echo ""
echo "========================================="
echo "🤝 ATEL Agent Ready!"
echo "========================================="
cd ~/atel-workspace && ATEL_API=https://api.atelai.org atel info 2>&1 | head -6
echo "DID: $DID"
echo "pm2 status: $(pm2 jlist 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['pm2_env']['status'] if d else 'unknown')" 2>/dev/null || echo 'check with: pm2 status')"
echo "========================================="
