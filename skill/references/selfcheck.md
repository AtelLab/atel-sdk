# Self-Check Guide

Run this right after reboot or incident:

```bash
bash skill/scripts/selfcheck.sh
```

Checks:
1) pm2 process state (atel-agent / atel-executor)
2) health endpoints (3100 / 3102)
3) local ports (3100/3101/3102)
4) relay registration log signal
5) DID consistency hint

Interpretation:
- PASS: safe to continue
- WARN: degraded but likely recoverable quickly
- FAIL: run recovery runbook immediately
