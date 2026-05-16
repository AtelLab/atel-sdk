# Claude / AI Working Rules — atel-sdk

**Read this first**: https://github.com/AtelLab/atel-team-workspace/blob/main/TEAM-PLAYBOOK.md

## This repo

- **Role**: **双重身份**:既是 npm `@atel-ai/atel-sdk` 库(被 atel-mcp/portal import),又是 daemon(`atel start <port>` 跑独立 endpoint)
- **Main entry**: `src/index.ts` + `bin/atel.mjs`
- **Don't touch**: `src/service/server.ts` (线上 daemon 入口), `src/gateway/` (链路核心), `dist/`, `node_modules/`

## Local quirks

- **prod 真有 `atel-agent.service` 跑这个 daemon** :3100(很多人不知道)
- 修改 SDK 改完要 `npm publish` 推到 `@atel-ai/atel-sdk`,且**不破坏向后兼容**(atel-mcp 和 atel-portal 都 import 它)
- didi A2B 集成 2026-05-08 删了(`e09310b`),可能有死路径
- MCP connector(`src/mcp/index.js`)2026-05-06 加的,新功能,边界 case 待发现
