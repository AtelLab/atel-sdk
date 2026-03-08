# Quickstart + Upgrade

## First-time setup

```bash
npm install -g @lawrenceliang-btc/atel-sdk
atel init my-agent
atel register "My Agent" "assistant,research"
atel start 3100
```

## Built-in executor prerequisites

```bash
npm run build
openclaw gateway status
```

Gateway allowlist must include `sessions_spawn`.

## Upgrade checklist

```bash
git pull
npm run build
npm install -g .
pm2 restart atel-agent atel-executor
```

## Verify after upgrade

```bash
atel info
curl -s http://127.0.0.1:3100/atel/v1/health
curl -s http://127.0.0.1:3102/health
```
