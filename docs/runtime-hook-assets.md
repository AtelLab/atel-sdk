# Runtime Hook Assets

This directory records the ATEL OpenClaw hook runtime assets that are currently deployed on the trade nodes.

Scope:
- Source of truth for code changes remains `129:/root/.openclaw/deploy/sdk-merge-main-20260406`.
- Live runtime copies on 129 and 180 should be treated as deployed artifacts, not hidden one-off edits.
- The files under `ops/openclaw/` and `ops/systemd/` are mirrored from the live runtime versions used during the 2026-04-22 trade stabilization work.

Current mirrored assets:
- `ops/openclaw/atel-openclaw-agent.sh`
- `ops/openclaw/atel-openclaw-agent-parser.py`
- `ops/systemd/atel-auto-requester-3921.service.d/atel-openclaw.conf`
- `ops/systemd/atel-180-3300.service.d/hook.conf`

Sync helper:
- `scripts/sync-runtime-hook-assets.sh`
- `bash scripts/sync-runtime-hook-assets.sh --check --role auto`
- `sudo bash scripts/sync-runtime-hook-assets.sh --apply --role requester --restart`
- `sudo bash scripts/sync-runtime-hook-assets.sh --apply --role executor --restart`

Operational notes:
- Requester node 129 currently uses hook concurrency `4`.
- Executor node 180 currently uses hook concurrency `1` to avoid OpenClaw session lock contention.
- Runtime wrapper and parser on 129 and 180 were verified to match by SHA-256 before mirroring into the repo.

Expected workflow:
- Make source changes in `129 deploy` first.
- Mirror runtime hook changes into this repo when they become part of the intended deployment baseline.
- Sync 180 from Git instead of editing 180 repo code directly.
- Use `scripts/sync-runtime-hook-assets.sh` to check or apply runtime hook drift instead of copying files by hand.

This document exists to keep the repository baseline and the machine runtime baseline aligned.
