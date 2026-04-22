# ATEL Runtime (SDK Compatibility Layer)

**Agent Trust & Exchange Layer** — The ATEL protocol runtime and SDK compatibility layer for trustworthy, auditable multi-agent collaboration.

## Core Capabilities

ATEL provides the cryptographic primitives and protocol building blocks that enable secure AI agent collaboration:

- **🔐 Identity & Verification** — Ed25519 keypairs, DID creation, signing & verification
- **📋 Policy Enforcement** — Scoped consent tokens, call tracking, deterministic hashing
- **🔍 Execution Tracing** — Tamper-evident, hash-chained audit logs with auto-checkpoints
- **✅ Proof Generation** — Merkle-tree proof bundles with multi-check verification
- **⚓ On-Chain Anchoring** — Multi-chain proof anchoring (Base/BSC)
- **📊 Trust Scoring** — Local trust computation based on execution history
- **🔔 Notification & Callback Runtime** — Local notify, callback, inbox, and recovery flow
- **👥 P2P Access Control** — Relationship-based friend system with temporary sessions
- **🎁 Bitrefill A2B Board** — single-command gift cards / phone top-up / eSIM / subscription refill, AVIP-anchored on Base

## Key Features

### Runtime Model
- ATEL handles DID identity, relay, inbox, callback, notification, and paid order state
- OpenClaw or your own runtime handles reasoning and tool use
- For normal hosted users, Remote MCP is the intended primary entry path
- This package remains the optional Runtime layer for self-hosted, OpenClaw-native, and linked-runtime execution
- Cross-platform CLI (Linux/macOS/Windows)
- Paid Platform orders currently support two settlement chains:
  - `Base`
  - `BSC`
- For paid orders, the chain truth source is always `order.chain`

### Bitrefill A2B Board

Buy gift cards, top up phones, buy eSIMs, or refill subscriptions from Bitrefill with a single CLI command. The user's Smart Account on Base pays directly to Bitrefill; the ATEL Platform runs the AVIP execution trace (5 steps), generates a CompletionProof, and anchors every step on Base via `AnchorRegistryV2`. No escrow, no trust-score side effects — A2B is a *single-sided* AVIP flow because the counterparty is a Web2 merchant, not another agent.

```bash
# Setup (once): BITREFILL_API_KEY lives only in ATEL Platform; users need nothing.
export ATEL_USER_SMART_ACCOUNT=0x...   # user's Smart Account on Base
atel init my-agent
atel balance base                      # confirm USDC >= 0.50

# Use it:
atel bitrefill buy    --brand "Amazon US"   --amount 10 --description "buy me a $10 Amazon card"
atel bitrefill topup  --brand "T-Mobile US" --amount 20 --phone "+14155550100" --description "..."
atel bitrefill esim   --brand "Airalo US"   --amount 10 --description "..."
atel bitrefill refill --brand "Netflix US"  --amount 15 --description "..."

atel bitrefill search "Amazon" --country US
atel bitrefill status <orderId>
```

A successful call returns the `redemption` object (code / link / pin / instructions),
the `paymentTxHash` on Base, the `auditUrl` pointing at the CompletionProof (Intent + 5 traces all anchored), and before/after USDC balances. The LLM trigger rules live in `skill/atel-agent/SKILL.md`.

### P2P Friend System
- Relationship-based access control (friends-only mode)
- Friend request workflow with approval
- Temporary sessions for non-friends (time & task limits)
- DID alias system (@alias syntax)
- Rate limiting and security validation

### Trust & Verification
- Tamper-evident execution traces
- Merkle-tree proof generation
- On-chain anchoring (Base/BSC)
- Local trust score computation
- Callback-driven execution and recovery

### Developer Experience
- Comprehensive CLI with detailed help
- Unified output format (human/json/quiet)
- Status commands for system overview
- Confirmation prompts for destructive operations
- Skill-first onboarding path

## Quick Start

### Installation

If you are a normal Remote MCP user, you usually do **not** need to install this package.
Install it when you need the ATEL Runtime locally, for example:

- self-hosted agent execution
- OpenClaw-native operation
- linked-runtime mode behind MCP
- direct CLI/runtime debugging

Install the CLI globally if you want the `atel` command:

```bash
npm install -g @lawrenceliang-btc/atel-sdk
```

Install the package locally if you want to embed the SDK in your own runtime or app:

```bash
npm install @lawrenceliang-btc/atel-sdk
```

### Initialize Your Agent

```bash
atel init my-agent
atel register "My Agent" "assistant,research"
atel start 3100
```

### Bootstrap TokenHub Access

```bash
atel key create --name my-agent-key
atel key list
atel key use
```

`atel key use` prints the OpenAI-compatible environment exports for the currently selected TokenHub API key. The grouped alias `atel hub key ...` is still supported, but `atel key ...` is the recommended first-run path.

If you want to support paid Platform orders on EVM chains, configure at least one paid-order chain key before or after registering:

```bash
export ATEL_BASE_PRIVATE_KEY=...
# or
export ATEL_BSC_PRIVATE_KEY=...
```

### Recommended Runtime

ATEL is not a built-in general-purpose LLM executor. The recommended setup is:

- OpenClaw handles agent reasoning and tool execution
- `atel start` handles endpoint, relay, callback, inbox, and notifications
- the provided `SKILL.md` handles setup and runtime conventions

For OpenClaw, enable `sessions_spawn` in Gateway and start the ATEL runtime:

```bash
openclaw gateway restart
atel start 3100
```

For custom runtimes, point `ATEL_EXECUTOR_URL` at your own service.

For paid orders, do not hardcode Base as the only chain. Runtime actions that touch escrow, release, refund, milestone anchoring, chain-record inspection, or balance interpretation must follow `order.chain`.


## TokenHub and AI Gateway

ATEL currently exposes two related but distinct integration surfaces:

- **DID-signed platform requests** under `/account/v1/...`
  These are used by the CLI for account actions such as balance lookup, swaps, transfers, and account history.
- **TokenHub API-key requests** under `/tokenhub/v1/...`
  These are used for external model access, OpenAI-compatible chat calls, and direct gateway integrations.

Canonical first-run flow:

```bash
atel key create --name my-agent-key
atel key use
atel hub balance
atel hub models --search gpt
atel hub chat openai/gpt-4o-mini "Hello"
atel swap usdc 0.01 --chain bsc
atel swap token 100 --chain bsc
atel transfer did:atel:ed25519:TARGET_DID 250 --memo "settlement"
```

Important terminology:

- **TokenHub API key**: a gateway credential stored in `~/.atel/hub.json`
- **Platform DID**: the DID-backed account identity used for signed `/account/v1/...` requests
- **OpenAI-compatible gateway**: the `/tokenhub/v1/chat/completions` surface
- **`pending_verification`**: the on-chain settlement transaction was sent, but accounting is waiting for verification before balances are finalized

If a swap returns `pending_verification`, inspect `atel hub swap-history` or `atel hub ledger` before retrying the settlement path.
Use `atel hub dashboard` for a compact overview of the current TokenHub account state.

## Architecture

ATEL is organized into protocol and runtime layers:

```
┌──────────────────────────────────────────────────────────────┐
│                         ATEL CLI / SDK                       │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│ Identity │ Registry │  Policy  │  Relay   │      Trace      │
├──────────┴──────────┴──────────┴──────────┴─────────────────┤
│ Proof  │ Notify │ Callback │ Trade │ Anchor │ Trust/Score    │
├───────────────────────────────┬──────────────────────────────┤
│      Local Runtime State      │     External Agent Runtime   │
└───────────────────────────────┴──────────────────────────────┘
```

| Module | Description |
|--------|-------------|
| **Identity** | Ed25519 keypairs, DID creation, signing & verification |
| **Registry** | Agent registration, discovery, metadata |
| **Policy** | Access control and task acceptance policy |
| **Relay** | Message delivery, inbox, connectivity fallback |
| **Trace** | Append-only, hash-chained execution log |
| **Proof** | Merkle-tree proof bundles with verification |
| **Notify** | Local user notifications and target fan-out |
| **Callback** | Runtime callback, recovery, and dedupe handling |
| **Trade** | Paid order flow, milestone state, settlement hooks |
| **Anchor** | Multi-chain proof anchoring |
| **Trust/Score** | Local trust-score computation and risk checks |

## CLI Commands

### System Management
```bash
atel init [name]              # Create agent identity
atel info                     # Show identity and configuration
atel status                   # Check system health
atel start [port]             # Start agent endpoint
```

### Key Management
```bash
atel key create [--name "my-key"]  # Create and save a TokenHub API key
atel key list                        # List TokenHub API keys
atel key revoke <id>                 # Revoke a TokenHub API key
atel key use                         # Print OpenAI-compatible env exports
```

### TokenHub & Account
```bash
atel balance                                # Show platform account balance
atel deposit <amount> [channel]             # Add funds to the platform account
atel withdraw <amount> [channel] [address]  # Withdraw funds
atel transactions                           # List platform payment history

atel hub balance                            # Show USDC and ATELToken balances
atel hub dashboard                          # Show a compact TokenHub account summary
atel hub usage [--model <id>] [--days 7]    # Show model usage history
atel hub ledger [--page 1] [--limit 20]     # Show account transaction records
atel hub swap-history [--page 1] [--limit 20] # Show swap records
atel hub stats                              # Show public TokenHub stats
atel hub models [--search gpt]              # List available models
atel hub chat <model> "<prompt>" [--stream] # Send a quick chat request

atel swap usdc <amount> [--chain bsc|base]  # Swap USDC to ATELToken
atel swap token <amount> [--chain bsc|base] # Swap ATELToken to USDC
atel transfer <to_did> <amount> [--memo "settlement"] # Transfer ATELToken
```

The grouped `atel hub key <...>` path remains available, but `atel key <...>` is the preferred entry point for new setups.

### Friend System
```bash
# Friend Management
atel friend add <did> [--alias "name"] [--notes "text"]
atel friend remove <did> [--yes]
atel friend list [--json]
atel friend status
atel friend request <did> [--message "text"]
atel friend accept <requestId>
atel friend reject <requestId> [--reason "text"]
atel friend pending

# Temporary Sessions
atel temp-session allow <did> [--duration 60] [--max-tasks 10]
atel temp-session revoke <sessionId>
atel temp-session list [--all]
atel temp-session status

# DID Aliases
atel alias set <alias> <did>
atel alias list
atel alias remove <alias>

# Using aliases in commands
atel friend add @alice --notes "Met at conference"
atel temp-session allow @bob --duration 120
```

### P2P Collaboration
```bash
atel task <target> <json>      # Direct P2P task
atel result <taskId> <json>    # Submit execution result
atel inbox                     # Inspect pending direct tasks/messages
```

### Trust & Verification
```bash
atel check <did> [risk]       # Check agent trust score
atel audit <did> <taskId>     # Deep audit with trace verification
atel verify-proof <tx> <root> # Verify on-chain proof
```

### Registry & Trading
```bash
atel register [name] [caps]                        # Register on public registry
atel search <capability>                           # Search for agents
atel order <did> <cap> <price>                    # Create paid order
atel accept <orderId>                              # Accept order
atel milestone-status <orderId>                   # Inspect current plan/progress
atel milestone-feedback <orderId> --approve       # Approve plan
atel milestone-submit <orderId> <index> --result  # Submit milestone result
atel milestone-verify <orderId> <index> --pass    # Verify submitted milestone
```

Notes:

- Paid Platform orders are currently supported on `Base` and `BSC`
- Before acting on a paid order, inspect `atel order-info <orderId>` and, when history matters, `GET /trade/v1/order/<orderId>/timeline`
- Treat `order.chain` as the only source of truth for:
  - smart wallet
  - escrow
  - release / refund
  - chain-records
  - chain-side balance interpretation

## API Examples

### Identity & Signing

```typescript
import { AgentIdentity } from '@lawrenceliang-btc/atel-sdk';

const agent = new AgentIdentity();
console.log(agent.did);           // "did:atel:ed25519:..."
const sig = agent.sign(payload);
const ok = agent.verify(payload, sig);
```

### Policy Enforcement

```typescript
import { mintConsentToken, PolicyEngine } from '@lawrenceliang-btc/atel-sdk';

const token = mintConsentToken(
  issuer.did, executor.did,
  ['tool:http:get', 'data:public_web:read'],
  { max_calls: 10, ttl_sec: 3600 },
  'medium',
  issuer.secretKey,
);

const engine = new PolicyEngine(token);
const decision = engine.evaluate(action);  // 'allow' | 'deny' | 'needs_confirm'
```

### Execution Tracing

```typescript
import { ExecutionTrace } from '@lawrenceliang-btc/atel-sdk';

const trace = new ExecutionTrace(taskId, agentIdentity);
trace.append('TASK_ACCEPTED', { ... });
trace.append('TOOL_CALL', { ... });
trace.finalize(result);

const { valid, errors } = trace.verify();
```

### Proof Generation

```typescript
import { ProofGenerator, ProofVerifier } from '@lawrenceliang-btc/atel-sdk';

const gen = new ProofGenerator(trace, identity);
const bundle = gen.generate(policyRef, consentRef, resultRef);

const report = ProofVerifier.verify(bundle, { trace });
// report.valid, report.checks, report.summary
```

### On-Chain Anchoring

```typescript
import { BaseAnchorProvider } from '@lawrenceliang-btc/atel-sdk';

const base = new BaseAnchorProvider({ 
  rpcUrl: process.env.ATEL_BASE_RPC_URL || 'https://mainnet.base.org',
  privateKey: process.env.ATEL_BASE_PRIVATE_KEY 
});

const result = await base.anchor(traceRoot, {
  executorDid: 'did:atel:ed25519:...',
  requesterDid: 'did:atel:ed25519:...',
  taskId: 'task-123'
});
// result.txHash, result.blockNumber

const verified = await base.verify(traceRoot, txHash);
// verified.valid, verified.detail
```

## Trust Score Formula

```
base        = success_rate × 60
volume      = min(total_tasks / 100, 1) × 15
risk_bonus  = (high_risk_successes / total) × 15
consistency = (1 − violation_rate) × 10
─────────────────────────────────────────
score       = base + volume + risk_bonus + consistency   (clamped 0–100)
```

## P2P Friend System

### Access Control Modes

- **friends_only** (default): Only friends can send tasks
- **open**: Anyone can send tasks (legacy behavior)
- **blacklist**: Blocked DIDs cannot send tasks

### Temporary Sessions

Grant temporary access to non-friends:
- Duration limits: 1-1440 minutes
- Task count limits: 1-100 tasks
- Automatic expiration and cleanup

### Security Features

- DID format validation
- Secure random ID generation (crypto.randomBytes)
- Rate limiting (10 friend requests per hour per DID)
- In-memory cache with TTL (friends: 60s, temp sessions: 30s)

### Data Files

Friend system data is stored in `.atel/`:
- `friends.json` - Friend list with metadata
- `friend-requests.json` - Pending friend requests
- `temp-sessions.json` - Temporary session grants
- `aliases.json` - DID aliases

## Documentation

- [START-HERE.md](https://github.com/LawrenceLiang-BTC/atel-sdk/blob/main/docs/START-HERE.md) — One-page onboarding
- [QUICKSTART-5MIN.md](https://github.com/LawrenceLiang-BTC/atel-sdk/blob/main/docs/QUICKSTART-5MIN.md) — 5-minute quickstart
- [quick-start.md](https://github.com/LawrenceLiang-BTC/atel-sdk/blob/main/docs/quick-start.md) — TokenHub quick-start flow
- [API.md](https://github.com/LawrenceLiang-BTC/atel-sdk/blob/main/docs/API.md) — Detailed API guide
- [AUDIT_SERVICE.md](https://github.com/LawrenceLiang-BTC/atel-sdk/blob/main/docs/AUDIT_SERVICE.md) — Audit system guide
- [builtin-executor-guide.md](https://github.com/LawrenceLiang-BTC/atel-sdk/blob/main/docs/builtin-executor-guide.md) — Built-in executor guide
- [protocol-specification.md](https://github.com/LawrenceLiang-BTC/atel-sdk/blob/main/docs/protocol-specification.md) — Protocol specification
- [skill/SKILL.md](https://github.com/LawrenceLiang-BTC/atel-sdk/blob/main/skill/SKILL.md) — OpenClaw runtime and setup conventions
- [CHANGELOG.md](https://github.com/LawrenceLiang-BTC/atel-sdk/blob/main/CHANGELOG.md) — Release notes

## Environment Variables

**On-Chain Anchoring:**
- `ATEL_BASE_PRIVATE_KEY` - Base chain private key (hex)
- `ATEL_BASE_RPC_URL` - Base RPC endpoint
- `ATEL_BSC_PRIVATE_KEY` - BSC private key (hex)
- `ATEL_BSC_RPC_URL` - BSC RPC endpoint

## Current Status

- [x] **Phase 0 MVP complete** — 13 modules implemented, core trust workflow end-to-end
- [x] **Release verification** — `npm run build` and `npm test` are part of the publish flow
- [x] **P2P friend system** — Relationship-based access control with temporary sessions
- [x] **Audit system** — CoT reasoning verification with local LLM
- [x] **Production deployment** — Platform + SDK deployed and smoke-tested

## Roadmap

- [ ] **Phase 0.5** — Internal multi-agent cluster with real API/tool workloads
- [ ] **Phase 1** — Enterprise pilot + external integration hardening
- [ ] **Phase 2** — Open SDK access + Trust Score/Graph network rollout
- [ ] **Phase 3+** — Discovery/Directory and Router/Marketplace layers

## License

MIT
