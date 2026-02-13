# CodexBridge Implementation Status

## Completed in this repository
- Monorepo scaffold with TypeScript strict mode and ESLint.
- `packages/shared`: protocol types, DSL parser, idempotency abstraction, memory dedupe store, and unit tests.
- `packages/relay-server`: Fastify server, WebSocket machine registry, in-memory rate limiter, `/wecom/callback` endpoint.
- `packages/relay-server`: user allowlist and machine binding checks (env-based).
- `packages/relay-server`: WeCom SHA1 signature verification, AES decrypt helper, callback GET verification route.
- `packages/relay-server`: WeCom XML callback parsing (plain XML + encrypted XML envelope).
- `packages/relay-server`: command owner tracking and optional result webhook push (`RESULT_WEBHOOK_URL`).
- `packages/relay-server`: WeCom active message push via official API (gettoken + message/send with token cache).
- `packages/relay-server`: encrypted passive XML ack for encrypted callbacks (`Encrypt/MsgSignature/TimeStamp/Nonce`).
- `packages/relay-server`: audit store (in-memory index + JSONL persistence) and command audit query endpoints.
- `packages/relay-server`: in-flight command cancellation endpoint (`POST /commands/:commandId/cancel`).
- `packages/relay-server`: command retry endpoint (`POST /commands/:commandId/retry`) with new commandId dispatch.
- `packages/relay-server`: machine/inflight ops endpoints (`GET /machines`, `GET /inflight`) and stale in-flight timeout cleanup.
- `packages/relay-server`: machine endpoint includes heartbeat load metrics (`runningCount`, `pendingCount`).
- `packages/relay-server`: audit filtering (`userId/machineId/status`) and retention cap (`AUDIT_MAX_RECORDS`).
- `packages/relay-server`: metrics endpoint (`GET /metrics`) with machine/inflight/audit counters.
- `packages/relay-server`: audit index hydration from JSONL on startup.
- `packages/relay-server`: optional admin-token protection for ops endpoints (`RELAY_ADMIN_TOKEN` + `x-admin-token` header).
- `packages/relay-server`: redacted config snapshot endpoint (`GET /ops/config`).
- `packages/relay-server`: Redis-backed idempotency store option (`REDIS_URL`, `REDIS_PREFIX`) with memory fallback.
- `packages/relay-server`: command template TTL and max-size cleanup for retry storage.
- Added environment template (`.env.example`).
- Added production security checklist (`SECURITY_CHECKLIST.md`).
- `packages/codex-client`: `codex app-server` JSONL RPC client with timeout and restart logic.
- `packages/vscode-agent`: outbound WebSocket agent, heartbeat, `help/status` handlers, diff cache placeholder.
- `packages/vscode-agent`: local confirmation gate, safe unified diff apply, and test runner with allowlist/timeout.
- `packages/vscode-agent`: supports `@dev apply <refId>` and `@dev test [command]`.
- `packages/vscode-agent`: `@dev patch` now requests real patch from codex app-server with bounded context collection.
- `packages/vscode-agent`: supports relay-driven command cancellation (`command.cancel`), including killing running test command.
- `packages/vscode-agent`: VSCode extension entry (`src/extension.ts`) with start/stop/status commands and settings.
- `packages/vscode-agent`: command queue with configurable concurrency and per-command execution timeout.
- `packages/vscode-agent`: VSCode runtime context adapter (active file/selection/language) wired into patch generation.
- `packages/vscode-agent`: VSIX packaging workflow (`package:vsix`, `.vscodeignore`, extension README).
- `packages/vscode-agent`: VSCode native modal confirmation for apply/test when running as extension host.
- Added baseline tests in `packages/shared/test`, `packages/relay-server/test`, `packages/vscode-agent/test`.
- Added relay audit store tests (`packages/relay-server/test/audit-store.test.ts`).
- Added machine registry tests (`packages/relay-server/test/machine-registry.test.ts`).
- Added audit filter and pruning tests (`packages/relay-server/test/audit-store.test.ts`).
- Added audit hydration tests (`packages/relay-server/test/audit-store.test.ts`).
- Added GitHub Actions CI workflow (`.github/workflows/ci.yml`) for typecheck/lint/test.
- Added VSCode agent packaging workflow (`.github/workflows/vscode-agent-package.yml`).
- Added local Redis dev compose file (`docker-compose.dev.yml`).
- Added operations runbook (`docs/OPERATIONS.md`).
- Added test deployment guide (`docs/DEPLOY_TEST.md`).
- Added test bootstrap/start scripts (`scripts/bootstrap-test-env.ps1`, `scripts/start-test-stack.ps1`).
- Added relay API reference doc (`docs/API.md`).
- Added demo flow script (`scripts/demo-flow.ps1`) for patch/apply local walkthrough.
- Added idempotency store factory test (`packages/relay-server/test/store-factory.test.ts`).
- Added local Redis dev compose file (`docker-compose.dev.yml`).
- Added operations runbook (`docs/OPERATIONS.md`).

## Not yet completed
- Persistent storage integration (Redis/Postgres) and full audit pipeline.

## Environment constraints
Node.js and pnpm are currently unavailable in this machine environment, so build/test commands were not executed in this run.
