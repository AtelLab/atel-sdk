#!/bin/bash
# ATEL Agent 一键设置
set -euo pipefail

echo "🤝 ATEL Agent Setup Starting..."
PLATFORM_URL="${ATEL_PLATFORM:-https://api.atelai.org}"
ENDPOINT_MODE="${ATEL_ENDPOINT_MODE:-public}"
NAME_HINT="my-agent-ab12"

# 1. 创建专用目录
WORKSPACE="${ATEL_WORKSPACE:-$HOME/atel-workspace}"
mkdir -p "$WORKSPACE"
cd "$WORKSPACE"

# 2. 安装 SDK
if ! command -v atel &> /dev/null; then
  echo "📦 Installing ATEL SDK..."
  npm install -g @lawrenceliang-btc/atel-sdk || { echo "❌ SDK install failed"; exit 1; }
fi
echo "✅ SDK: $(command -v atel)"

# 3. 初始化身份（区分首次使用与后续复用）
if [ -f .atel/identity.json ]; then
  echo "✅ Existing identity detected"
  AGENT_NAME=$(python3 -c "import json; print(json.load(open('.atel/identity.json')).get('agent_id','agent-reuse'))" 2>/dev/null || echo "$DEFAULT_AGENT_NAME")
  DID=$(python3 -c "import json; print(json.load(open('.atel/identity.json'))['did'])" 2>/dev/null || echo "unknown")
  echo "✅ Reusing agent: ${AGENT_NAME}"
else
  AGENT_NAME="${ATEL_AGENT_NAME:-}"
  if [ -z "$AGENT_NAME" ]; then
    if [ -t 0 ]; then
      read -r -p "Choose your agent name (required, e.g. ${NAME_HINT}): " USER_AGENT_NAME || true
      AGENT_NAME="${USER_AGENT_NAME:-}"
    else
      echo "❌ Agent name required. Re-run with ATEL_AGENT_NAME=<your-name> or use an interactive terminal."
      exit 1
    fi
  fi
  AGENT_NAME="$(printf '%s' "$AGENT_NAME" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  if [ -z "$AGENT_NAME" ]; then
    echo "❌ Agent name required. Initialization aborted."
    exit 1
  fi
  echo "🔑 Creating identity as ${AGENT_NAME}..."
  echo 'n' | ATEL_PLATFORM="$PLATFORM_URL" atel init "${AGENT_NAME}" || { echo "❌ Init failed"; exit 1; }
  DID=$(python3 -c "import json; print(json.load(open('.atel/identity.json'))['did'])" 2>/dev/null || echo "unknown")
fi

echo "✅ DID: $DID"

# 4. 注册（默认优先公网 endpoint，本地测试才允许 local）
if [ "$ENDPOINT_MODE" = "local" ]; then
  ENDPOINT_HOST="${ATEL_ENDPOINT_HOST:-127.0.0.1}"
else
  ENDPOINT_HOST="${ATEL_ENDPOINT_HOST:-$(curl -s --connect-timeout 5 ifconfig.me 2>/dev/null || echo 127.0.0.1)}"
fi
PORT=${ATEL_PORT:-3000}

register_agent() {
  local name="$1" port="$2"
  ATEL_PLATFORM="$PLATFORM_URL" atel register "$name" general "http://${ENDPOINT_HOST}:${port}" 2>&1
}

REG_OK=0
for attempt in 1 2 3; do
  if OUTPUT=$(register_agent "$AGENT_NAME" "$PORT" 2>&1); then
    REG_OK=1
    echo "✅ Registered as ${AGENT_NAME} at port ${PORT}"
    break
  fi
  # Parse error type
  if echo "$OUTPUT" | grep -q "name already taken"; then
    echo "❌ Agent name already taken: ${AGENT_NAME}"
    echo "   Choose a different explicit name and rerun setup."
    exit 1
  elif echo "$OUTPUT" | grep -q "endpoint already registered"; then
    PORT=$((PORT + 1))
    echo "⚠️ Port ${PORT-1} conflict, trying port ${PORT}..."
  else
    echo "⚠️ Register error: $OUTPUT"
    sleep 3
  fi
done

if [ $REG_OK -eq 0 ]; then
  echo "❌ Registration failed after 3 attempts. atel start will auto-register."
fi

# 5. 安装 pm2
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2 || { echo "❌ pm2 install failed"; exit 1; }
fi

# 6. 启动常驻 endpoint（默认常驻；测试可跳过）
if [ "${ATEL_SKIP_PM2:-0}" = "1" ]; then
  echo "⚠️ pm2 start skipped by ATEL_SKIP_PM2=1"
else
  pm2 delete atel-agent 2>/dev/null || true
  pm2 start "cd ${WORKSPACE} && ATEL_PLATFORM=${PLATFORM_URL} atel start ${PORT}" --name atel-agent --cwd "${WORKSPACE}" || { echo "❌ pm2 start failed"; exit 1; }
  pm2 save 2>/dev/null || true
fi

# 7. 等钱包（短等，不阻塞太久）
echo "⏳ Waiting for wallet (15s)..."
sleep 15

# 9. 显示结果
echo ""
echo "========================================="
echo "🤝 ATEL Agent Ready!"
echo "========================================="
cd "$WORKSPACE" && ATEL_PLATFORM=https://api.atelai.org atel info 2>&1 | head -6 || true
# Telegram 通知默认改为显式同意（opt-in）
SESSION_FILE="$HOME/.openclaw/agents/main/sessions/sessions.json"
CHAT_ID=""
if [ -f "$SESSION_FILE" ]; then
  CHAT_ID=$(python3 - <<'PY'
import json, os
p=os.path.expanduser("~/.openclaw/agents/main/sessions/sessions.json")
try:
    data=json.load(open(p))
    for v in (data.values() if isinstance(data,dict) else [data]):
        if isinstance(v,dict) and v.get("lastChannel")=="telegram":
            lt=v.get("lastTo","")
            if lt.startswith("telegram:"):
                print(lt.split(":",1)[1])
                break
except:
    pass
PY
)
fi

if [ "${ATEL_NOTIFY_AUTO_BIND:-0}" = "1" ] && [ -n "$CHAT_ID" ]; then
  echo "🔔 Explicit consent flag detected. Binding notifications to Telegram chat: $CHAT_ID"
  if [ "${ATEL_SKIP_NOTIFY_TEST:-0}" != "1" ]; then
    cd "$WORKSPACE" && atel notify bind "$CHAT_ID" 2>/dev/null || true
    cd "$WORKSPACE" && atel notify test 2>/dev/null || true
  fi
else
  echo "🔒 Telegram notifications are opt-in by default."
  if [ -n "$CHAT_ID" ]; then
    echo "   After explicit user consent, run: cd $WORKSPACE && atel notify bind $CHAT_ID"
  else
    echo "   After explicit user consent, run: cd $WORKSPACE && atel notify bind <chat_id>"
  fi
fi
echo "DID: $DID"
echo "Endpoint mode: $ENDPOINT_MODE ($ENDPOINT_HOST:$PORT)"
echo "Port: $PORT"
echo "pm2: $(pm2 jlist 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['pm2_env']['status'] if d else 'unknown')" 2>/dev/null || echo 'check: pm2 status')"

# ─── Bitrefill 板块自检 ──────────────────────────────────────────────
# A2B 板块不需要额外配置;只要 ATEL DID 存在 + Smart Account 有 USDC,
# 就可以让 agent 用 `atel bitrefill buy/topup/esim/refill` 完成购物。
# 这里做两件事:(1) 搜一次产品验证 Platform 代理可达,(2) 提示用户
# 在环境变量里配自己的 Smart Account 地址。
if command -v atel >/dev/null 2>&1; then
  echo ""
  echo "🎁 Bitrefill board self-check..."
  if atel bitrefill search "Amazon" --limit 1 >/dev/null 2>&1; then
    echo "✅ Bitrefill 板块可达 (产品搜索代理响应正常)"
  else
    echo "⚠️  Bitrefill 板块暂不可达(网络 / Platform 未启用)— 不阻塞主 setup"
  fi
  if [ -z "${ATEL_USER_SMART_ACCOUNT:-}" ]; then
    echo "ℹ️  要启用买卡功能,请把你的 Smart Account on Base 地址写进环境变量:"
    echo "    export ATEL_USER_SMART_ACCOUNT=0x..."
    echo "    然后往里面转一点 USDC (>= 0.50 建议值) 就可以开始用了。"
  else
    echo "✅ ATEL_USER_SMART_ACCOUNT=${ATEL_USER_SMART_ACCOUNT}"
  fi
fi

echo "========================================="
