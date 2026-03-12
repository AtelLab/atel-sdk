#!/bin/bash
# ATEL SDK 测试环境启动脚本

export ATEL_REGISTRY=http://39.102.61.79:8200
export ATEL_PLATFORM=http://39.102.61.79:8200
export ATEL_RELAY=http://39.102.61.79:8200

echo "=== ATEL 测试环境 ==="
echo "Registry: $ATEL_REGISTRY"
echo "Platform: $ATEL_PLATFORM"
echo "Relay:    $ATEL_RELAY"
echo ""

cd "$(dirname "$0")"
node bin/atel.mjs "$@"
