#!/usr/bin/env bash
set -euo pipefail

export HOME=/root
SOURCE_OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/root/.openclaw}"
export OPENCLAW_STATE_DIR="$SOURCE_OPENCLAW_STATE_DIR"
SOURCE_OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$SOURCE_OPENCLAW_STATE_DIR/openclaw.json}"
export OPENCLAW_CONFIG_PATH="$SOURCE_OPENCLAW_CONFIG_PATH"
export PATH=/root/.nvm/versions/node/v22.22.2/bin:/root/.local/share/pnpm:/root/.nvm/current/bin:/root/.local/bin:/root/.npm-global/bin:/root/bin:/root/.volta/bin:/root/.asdf/shims:/root/.bun/bin:/root/.fnm/current/bin:/usr/local/bin:/usr/bin:/bin

RAW_PROMPT="${1:-}"
ORDER_ID="$(printf '%s' "$RAW_PROMPT" | grep -Eo 'ord-[a-f0-9-]+' | head -n1 || true)"
AGENT_NAME="${ATEL_OPENCLAW_AGENT_NAME:-atel-executor}"
SESSION_ID="atel-hook-$(date +%s%N)-$$"
CHILD_PID=""
DEFAULT_OPENCLAW_BIN=""
if [ -x /root/.local/share/pnpm/openclaw ]; then
  DEFAULT_OPENCLAW_BIN=/root/.local/share/pnpm/openclaw
elif [ -x /root/.local/bin/openclaw ]; then
  DEFAULT_OPENCLAW_BIN=/root/.local/bin/openclaw
else
  DEFAULT_OPENCLAW_BIN="$(command -v openclaw || true)"
fi
OPENCLAW_BIN="${ATEL_OPENCLAW_BIN:-$DEFAULT_OPENCLAW_BIN}"
MAX_ATTEMPTS="${ATEL_OPENCLAW_MAX_ATTEMPTS:-3}"
RETRY_SLEEP_BASE="${ATEL_OPENCLAW_RETRY_SLEEP_BASE:-8}"
THINKING_LEVEL="${ATEL_OPENCLAW_THINKING:-low}"
OPENCLAW_TIMEOUT_SECONDS="${ATEL_OPENCLAW_TIMEOUT_SECONDS:-45}"
OPENCLAW_DEADLINE_SLACK_SECONDS="${ATEL_OPENCLAW_DEADLINE_SLACK_SECONDS:-15}"
FAIL_FAST="${ATEL_OPENCLAW_FAIL_FAST:-1}"
HOOK_MODEL="${ATEL_OPENCLAW_HOOK_MODEL:-}"
RAW_OUTPUT=""
TMP_OUT=""
HOOK_CONFIG_PATH=""
HOOK_STATE_DIR=""

prepare_hook_state() {
  local base="$1"
  local agent="$2"
  local state="$3"
  mkdir -p "$state/agents/$agent/agent" "$state/agents/$agent/sessions" "$state/workspace" "$state/workspace-$agent"
  local src="$base/agents/$agent/agent"
  if [ ! -d "$src" ] && [ -d "$base/agents/main/agent" ]; then
    src="$base/agents/main/agent"
  fi
  local copied=0
  for name in auth-state.json auth-profiles.json models.json; do
    if [ -f "$src/$name" ]; then
      cp "$src/$name" "$state/agents/$agent/agent/$name"
      copied=1
    fi
  done
  if [ "$copied" -eq 0 ]; then
    return 1
  fi
  return 0
}

create_hook_config() {
  local src="$1"
  local dst="$2"
  local state="$3"
  local agent="$4"
  local model="$5"
  python3 - "$src" "$dst" "$state" "$agent" "$model" <<'PY'
import json
import sys

src, dst, state, agent, model = sys.argv[1:6]
with open(src, "r", encoding="utf-8") as fh:
    cfg = json.load(fh)
cfg["plugins"] = {
    "enabled": False,
    "allow": [],
    "entries": {},
    "installs": {},
    "load": {"paths": []},
}
agents = cfg.get("agents")
if isinstance(agents, dict):
    defaults = agents.get("defaults")
    if isinstance(defaults, dict):
        defaults["workspace"] = f"{state}/workspace"
        model_cfg = defaults.get("model")
        if isinstance(model_cfg, dict) and model:
            model_cfg["primary"] = model
    for item in agents.get("list") or []:
        if not isinstance(item, dict):
            continue
        if item.get("id") != agent:
            continue
        item["workspace"] = f"{state}/workspace-{agent}"
        item["agentDir"] = f"{state}/agents/{agent}/agent"
        if model:
            item["model"] = model
with open(dst, "w", encoding="utf-8") as fh:
    json.dump(cfg, fh, ensure_ascii=False, indent=2)
PY
}

if [ "${ATEL_OPENCLAW_SANITIZE_CONFIG:-1}" = "1" ] && [ -f "$SOURCE_OPENCLAW_CONFIG_PATH" ]; then
  HOOK_STATE_DIR="$(mktemp -d /tmp/atel-openclaw-hook-state.XXXXXX)"
  if prepare_hook_state "$SOURCE_OPENCLAW_STATE_DIR" "$AGENT_NAME" "$HOOK_STATE_DIR"; then
    HOOK_CONFIG_PATH="$(mktemp /tmp/atel-openclaw-hook-config.XXXXXX.json)"
    if create_hook_config "$SOURCE_OPENCLAW_CONFIG_PATH" "$HOOK_CONFIG_PATH" "$HOOK_STATE_DIR" "$AGENT_NAME" "$HOOK_MODEL"; then
      chmod 700 "$HOOK_STATE_DIR"
      chmod 600 "$HOOK_CONFIG_PATH"
      export OPENCLAW_STATE_DIR="$HOOK_STATE_DIR"
      export OPENCLAW_CONFIG_PATH="$HOOK_CONFIG_PATH"
    else
      rm -f "$HOOK_CONFIG_PATH" || true
      HOOK_CONFIG_PATH=""
      rm -rf "$HOOK_STATE_DIR" || true
      HOOK_STATE_DIR=""
      export OPENCLAW_STATE_DIR="$SOURCE_OPENCLAW_STATE_DIR"
      export OPENCLAW_CONFIG_PATH="$SOURCE_OPENCLAW_CONFIG_PATH"
    fi
  else
    rm -rf "$HOOK_STATE_DIR" || true
    HOOK_STATE_DIR=""
  fi
fi

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
  if [ -n "${TMP_OUT}" ]; then
    rm -f "${TMP_OUT}" || true
  fi
  if [ -n "${HOOK_CONFIG_PATH}" ]; then
    rm -f "${HOOK_CONFIG_PATH}" || true
  fi
  if [ -n "${HOOK_STATE_DIR}" ]; then
    rm -rf "${HOOK_STATE_DIR}" || true
  fi
  exit $rc
}
trap cleanup EXIT INT TERM

if [ -z "$OPENCLAW_BIN" ]; then
  echo 'openclaw binary not found in PATH'
  exit 127
fi

is_transient_failure() {
  local text="$1"
  printf '%s' "$text" | grep -Eqi 'API rate limit reached|DNS lookup for the provider endpoint failed|temporarily unavailable|Temporary failure in name resolution|ECONNRESET|ETIMEDOUT|ENOTFOUND|rate limit|try again later|Enable JavaScript and cookies to continue|__cf_chl|Request timed out before a response was generated'
}

if [ "$FAIL_FAST" = "1" ] && [ "$MAX_ATTEMPTS" -gt 1 ]; then
  MAX_ATTEMPTS=1
fi

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  TMP_OUT="$(mktemp)"
  CHILD_PID=""
  ATTEMPT_SESSION_ID="${SESSION_ID}-a${attempt}"

  setsid "$OPENCLAW_BIN" agent --agent "$AGENT_NAME" --local --thinking "$THINKING_LEVEL" --timeout "$OPENCLAW_TIMEOUT_SECONDS" --session-id "$ATTEMPT_SESSION_ID" --message "$MESSAGE" >"$TMP_OUT" 2>&1 &
  CHILD_PID=$!
  DEADLINE=$((SECONDS + OPENCLAW_TIMEOUT_SECONDS + OPENCLAW_DEADLINE_SLACK_SECONDS))

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
  CHILD_PID=""
  RAW_OUTPUT="$(cat "$TMP_OUT")"
  rm -f "$TMP_OUT" || true
  TMP_OUT=""

  if [ "$attempt" -lt "$MAX_ATTEMPTS" ] && is_transient_failure "$RAW_OUTPUT"; then
    sleep_for=$((RETRY_SLEEP_BASE * attempt))
    printf 'Transient LLM failure on attempt %s/%s; retrying in %ss\n' "$attempt" "$MAX_ATTEMPTS" "$sleep_for" >&2
    sleep "$sleep_for"
    attempt=$((attempt + 1))
    continue
  fi

  break
done

RAW_PROMPT="$RAW_PROMPT" RAW_OUTPUT="$RAW_OUTPUT" ORDER_ID="$ORDER_ID" python3 /usr/local/bin/atel-openclaw-agent-parser.py
