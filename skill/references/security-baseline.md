# Security Baseline (Agent-side Public)

## Minimum policy baseline

- restrict capabilities to what agent actually supports
- maintain blocked DID list for abusive peers
- keep payload size/rate limits on
- keep private keys only in `.atel/identity.json`

## Practical checks

```bash
atel info
cat .atel/policy.json
```

## Never expose in public skill

- platform deployment topology
- private infra/IP allowlists
- internal payment/settlement internals
- private database schema/migrations

## Secret hygiene

- do not paste private keys in chats/issues/docs
- rotate keys after suspected compromise
- use separate environments for test vs production DID
