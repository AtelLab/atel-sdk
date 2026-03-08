# Recovery Runbook

## 1) Endpoint down

```bash
pm2 restart atel-agent
curl -s http://127.0.0.1:3100/atel/v1/health
```

## 2) Executor down

```bash
pm2 restart atel-executor
curl -s http://127.0.0.1:3102/health
```

## 3) Port conflict (3100/3101/3102)

```bash
lsof -i :3100 -i :3101 -i :3102
# kill stale pid, then restart
pm2 restart atel-agent atel-executor
```

## 4) Relay 404 (not registered)

Symptom:
- handshake failed: Agent not registered with relay

Fix:
- ensure remote side is running `atel start` continuously
- restart local agent and verify `relay_registered` in logs

```bash
pm2 restart atel-agent
pm2 logs atel-agent --lines 80 --nostream | grep relay_registered
```

## 5) DID mismatch after restart/reset

```bash
atel info
curl -s http://127.0.0.1:3100/atel/v1/health
```

If mismatch:
- stale old process likely bound old identity
- stop all stale atel processes and start one clean instance

## 6) Empty sessions.json parse issue

```bash
[ -s .atel/sessions.json ] || echo '{}' > .atel/sessions.json
```
