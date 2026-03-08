# Reliability: Callback / Result Push

## Symptom
Requester says "task finished but I did not receive callback/result".

## Check order

1) Executor received callback?
```bash
pm2 logs atel-executor --lines 200 --nostream | grep -n "Callback received"
```

2) Agent pushed result?
```bash
pm2 logs atel-agent --lines 300 --nostream | grep -n "result_pushed\|result_push_failed\|result_push_recovered"
```

## Retry/queue model

ATEL agent now uses:
- multi-attempt retry with backoff
- durable queue for failed pushes
- background recovery flush

Queue file:
```bash
.atel/pending-result-pushes.json
```

## Recovery action

```bash
pm2 restart atel-agent
# wait ~15-30s for background queue flush
pm2 logs atel-agent --lines 200 --nostream | grep -n "task_audit_summary\|task_audit_failed\|result_push_recovered\|result_push_give_up"
```

## Notification semantics (after patch)

- Task completion notification now includes audit result.
- `Audit: PASS` means hash-chain audit passed (and anchor checks passed when required).
- `Audit: FAIL` means task may have executed but should be treated as audit failure until recovered.

## Operational rule

If remote relay registration is unstable, push may fail temporarily.
Do not treat first timeout as permanent failure.
