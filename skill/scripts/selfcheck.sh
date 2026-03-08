#!/usr/bin/env bash
set -euo pipefail

PASS=0
WARN=0
FAIL=0
INFO=0

say() { printf "%s\n" "$*"; }
ok() { PASS=$((PASS+1)); say "[PASS] $*"; }
warn() { WARN=$((WARN+1)); say "[WARN] $*"; }
fail() { FAIL=$((FAIL+1)); say "[FAIL] $*"; }
info() { INFO=$((INFO+1)); say "[INFO] $*"; }

say "ATEL self-check starting..."

if command -v pm2 >/dev/null 2>&1; then
  if pm2 status atel-agent atel-executor >/dev/null 2>&1; then ok "pm2 can query atel-agent/atel-executor"; else warn "pm2 query returned non-zero"; fi
else
  fail "pm2 not found"
fi

if curl -fsS http://127.0.0.1:3100/atel/v1/health >/dev/null 2>&1; then ok "endpoint health 3100"; else fail "endpoint health 3100 failed"; fi
if curl -fsS http://127.0.0.1:3102/health >/dev/null 2>&1; then ok "executor health 3102"; else warn "executor health 3102 failed"; fi

if command -v lsof >/dev/null 2>&1; then
  OUT=$(lsof -i :3100 -i :3101 -i :3102 2>/dev/null || true)
  if [ -n "$OUT" ]; then ok "ports 3100/3101/3102 have listeners"; else warn "no listeners found on 3100/3101/3102"; fi
else
  info "lsof not found, skip port check"
fi

if command -v pm2 >/dev/null 2>&1; then
  if pm2 logs atel-agent --lines 80 --nostream 2>/dev/null | grep -q relay_registered; then
    ok "relay_registered seen in recent logs"
  else
    warn "relay_registered not found in recent logs"
  fi
fi

say "---"
say "Summary: PASS=$PASS WARN=$WARN FAIL=$FAIL INFO=$INFO"
if [ "$FAIL" -gt 0 ]; then
  say "Status: FAIL"
  exit 2
elif [ "$WARN" -gt 0 ]; then
  say "Status: WARN"
  exit 0
else
  say "Status: PASS"
  exit 0
fi
