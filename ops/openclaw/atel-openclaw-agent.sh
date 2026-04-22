#!/usr/bin/env bash
set -euo pipefail

export HOME=/root
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/root/.openclaw}"
export OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-/root/.openclaw/openclaw.json}"
export PATH=/root/.nvm/versions/node/v22.22.2/bin:/root/.local/share/pnpm:/root/.nvm/current/bin:/root/.local/bin:/root/.npm-global/bin:/root/bin:/root/.volta/bin:/root/.asdf/shims:/root/.bun/bin:/root/.fnm/current/bin:/usr/local/bin:/usr/bin:/bin

RAW_PROMPT="${1:-}"
ORDER_ID="$(printf '%s' "$RAW_PROMPT" | grep -Eo 'ord-[a-f0-9-]+' | head -n1 || true)"
AGENT_NAME="${ATEL_OPENCLAW_AGENT_NAME:-atel-executor}"
SESSION_ID="atel-hook-$(date +%s%N)-$$"
TMP_OUT="$(mktemp)"
CHILD_PID=""
OPENCLAW_BIN="${ATEL_OPENCLAW_BIN:-$(command -v openclaw || true)}"

if [ -n "$ORDER_ID" ]; then
  ORDER_RULE="7. 当前订单号只能是 ${ORDER_ID}。严禁引用、检查、提交、验证任何其他 orderId。若命令、路径、结果里出现其他 orderId，视为失败。"
else
  ORDER_RULE="7. 严禁引用、检查、提交、验证与当前提示无关的其他订单。"
fi

PROMPT_PREFIX=$(cat <<EOT
你正在自动处理 ATEL 订单事件。必须遵守以下规则：
1. 历史事实主证据源只能优先使用：atel order-info <orderId>、GET /trade/v1/order/<orderId>/timeline。
2. 严禁把短窗口 atel inbox <N> 当成历史真相源。inbox 只能说明当前窗口此刻看到了什么，不能用来证明过去一定发生过什么，也不能拿它列举历史事件序列。
3. 如果 order-info、timeline 已能证明事实，就不要再引用 inbox 作为主要证据。
4. 里程碑提交必须短、具体、可验收，只写当前真实做了什么、看到了什么、能确认什么，不要扩写任务语义，不要脑补未提供的业务要求。
5. 对 paid order 的 order_created，如果系统已启用自动接单，就直接执行 atel accept <orderId>；失败时只返回真实失败原因，不要再说请人类确认后执行。
6. 对 milestone_rejected，如果 submitCount >= 3，必须停止自动推进，不要自动调用 atel milestone-arbitrate；只回报“由于连续 3 次被拒，已进入仲裁待决状态，等待人工决定是否发起仲裁”。
${ORDER_RULE}
EOT
)

MESSAGE="${PROMPT_PREFIX}

${RAW_PROMPT}"

cleanup() {
  local rc=$?
  if [ -n "${CHILD_PID}" ] && kill -0 "${CHILD_PID}" 2>/dev/null; then
    kill -TERM -- "-${CHILD_PID}" 2>/dev/null || true
    sleep 2
    kill -KILL -- "-${CHILD_PID}" 2>/dev/null || true
  fi
  rm -f "$TMP_OUT"
  exit $rc
}
trap cleanup EXIT INT TERM

if [ -z "$OPENCLAW_BIN" ]; then
  echo 'openclaw binary not found in PATH'
  exit 127
fi

setsid "$OPENCLAW_BIN" agent --agent "$AGENT_NAME" --local --thinking minimal --timeout 180 --session-id "$SESSION_ID" --message "$MESSAGE" >"$TMP_OUT" 2>&1 &
CHILD_PID=$!
DEADLINE=$((SECONDS + 210))

while kill -0 "$CHILD_PID" 2>/dev/null; do
  if [ "$SECONDS" -ge "$DEADLINE" ]; then
    kill -TERM -- "-${CHILD_PID}" 2>/dev/null || true
    sleep 2
    kill -KILL -- "-${CHILD_PID}" 2>/dev/null || true
    break
  fi
  sleep 1
done

wait "$CHILD_PID" || true
RAW_OUTPUT="$(cat "$TMP_OUT")"
RAW_PROMPT="$RAW_PROMPT" RAW_OUTPUT="$RAW_OUTPUT" ORDER_ID="$ORDER_ID" python3 /usr/local/bin/atel-openclaw-agent-parser.py
