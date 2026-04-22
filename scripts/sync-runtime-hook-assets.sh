#!/usr/bin/env bash
set -euo pipefail

MODE="check"
ROLE="auto"
RESTART=0

usage() {
  cat <<'EOF'
Usage:
  bash scripts/sync-runtime-hook-assets.sh --check [--role auto|requester|executor|all]
  sudo bash scripts/sync-runtime-hook-assets.sh --apply [--restart] [--role auto|requester|executor|all]

Modes:
  --check    Report drift between repo-tracked runtime assets and live machine files.
  --apply    Copy repo-tracked runtime assets onto the live machine paths.

Roles:
  auto       Apply only to services detected on the current machine.
  requester  Apply requester assets only.
  executor   Apply executor assets only.
  all        Apply both requester and executor assets.

Flags:
  --restart  After --apply, run systemctl daemon-reload and restart affected services.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) MODE="check" ;;
    --apply) MODE="apply" ;;
    --restart) RESTART=1 ;;
    --role)
      shift
      ROLE="${1:-}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

case "$ROLE" in
  auto|requester|executor|all) ;;
  *)
    echo "Invalid role: $ROLE" >&2
    exit 2
    ;;
esac

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMON_CHANGED=0
REQUESTER_CHANGED=0
EXECUTOR_CHANGED=0
MISMATCH=0

if [[ "$MODE" == "apply" ]] && [[ "$(id -u)" -ne 0 ]]; then
  echo "--apply requires root" >&2
  exit 1
fi

service_exists() {
  local name="$1"
  systemctl cat "$name" >/dev/null 2>&1
}

want_requester=0
want_executor=0

case "$ROLE" in
  requester) want_requester=1 ;;
  executor) want_executor=1 ;;
  all) want_requester=1; want_executor=1 ;;
  auto)
    service_exists "atel-auto-requester-3921.service" && want_requester=1
    service_exists "atel-180-3300.service" && want_executor=1
    ;;
esac

sync_file() {
  local src="$1"
  local dst="$2"
  local mode="$3"
  local bucket="$4"

  if [[ ! -f "$src" ]]; then
    echo "Missing repo asset: $src" >&2
    exit 1
  fi

  if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
    echo "[ok] $dst"
    return 0
  fi

  if [[ "$MODE" == "check" ]]; then
    echo "[drift] $dst"
    MISMATCH=1
    return 0
  fi

  install -D -m "$mode" "$src" "$dst"
  echo "[applied] $dst"

  case "$bucket" in
    common) COMMON_CHANGED=1 ;;
    requester) REQUESTER_CHANGED=1 ;;
    executor) EXECUTOR_CHANGED=1 ;;
  esac
}

sync_file "$ROOT_DIR/ops/openclaw/atel-openclaw-agent.sh" "/usr/local/bin/atel-openclaw-agent.sh" "755" "common"
sync_file "$ROOT_DIR/ops/openclaw/atel-openclaw-agent-parser.py" "/usr/local/bin/atel-openclaw-agent-parser.py" "644" "common"

if [[ "$want_requester" -eq 1 ]]; then
  sync_file \
    "$ROOT_DIR/ops/systemd/atel-auto-requester-3921.service.d/atel-openclaw.conf" \
    "/etc/systemd/system/atel-auto-requester-3921.service.d/atel-openclaw.conf" \
    "644" \
    "requester"
else
  echo "[skip] requester assets"
fi

if [[ "$want_executor" -eq 1 ]]; then
  sync_file \
    "$ROOT_DIR/ops/systemd/atel-180-3300.service.d/hook.conf" \
    "/etc/systemd/system/atel-180-3300.service.d/hook.conf" \
    "644" \
    "executor"
else
  echo "[skip] executor assets"
fi

if [[ "$MODE" == "check" ]]; then
  if [[ "$MISMATCH" -ne 0 ]]; then
    echo "Runtime hook asset drift detected." >&2
    exit 1
  fi
  echo "Runtime hook assets are in sync."
  exit 0
fi

if [[ "$RESTART" -eq 1 ]]; then
  systemctl daemon-reload
  if [[ "$want_requester" -eq 1 ]] && [[ "$COMMON_CHANGED" -eq 1 || "$REQUESTER_CHANGED" -eq 1 ]]; then
    systemctl restart atel-auto-requester-3921.service
    echo "[restarted] atel-auto-requester-3921.service"
  fi
  if [[ "$want_executor" -eq 1 ]] && [[ "$COMMON_CHANGED" -eq 1 || "$EXECUTOR_CHANGED" -eq 1 ]]; then
    systemctl restart atel-180-3300.service
    echo "[restarted] atel-180-3300.service"
  fi
fi

echo "Runtime hook asset sync complete."
