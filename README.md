# CodexBridge

CodexBridge is a security-first remote AI development bridge:

WeCom -> Relay Server -> Local Agent -> Codex app-server

Core rule:

> Generate remotely. Execute locally.

No destructive action should run without explicit local confirmation.

## Repository Layout

```text
packages/
  shared/        # Protocol, DSL parser, idempotency abstractions
  relay-server/  # Fastify + WebSocket command router
  vscode-agent/  # Local agent runtime (WSS + heartbeat + command handlers)
  codex-client/  # JSONL RPC client for `codex app-server`
```

## What is Implemented

- Monorepo bootstrap with TypeScript strict mode.
- Shared protocol and `@dev` DSL parser with unit tests.
- Relay `GET/POST /wecom/callback` with JSON/XML payload support, dedupe, rate limit, allowlist, machine binding, and agent routing.
- WeCom cryptography baseline: SHA1 signature verification and AES-CBC decrypt (`WECOM_TOKEN`, `WECOM_ENCODING_AES_KEY`).
- Relay result push supports official WeCom API (`WECOM_CORP_ID/WECOM_AGENT_SECRET/WECOM_AGENT_ID`) with webhook fallback.
- Encrypted XML callbacks now return encrypted passive reply (`Encrypt/MsgSignature/TimeStamp/Nonce`), using `WECOM_CORP_ID` as receiveId.
- Relay audit trail: command lifecycle persistence + query APIs (`GET /commands/:commandId`, `GET /audit/recent`).
- Relay cancel API: `POST /commands/:commandId/cancel` sends cancel signal to local agent.
- Relay ops APIs: `GET /machines` and `GET /inflight` for runtime visibility.
- Relay metrics API: `GET /metrics` returns machine/inflight/audit counters.
- Relay retry API: `POST /commands/:commandId/retry` re-dispatches a command with a new commandId.
- Relay can hydrate audit index from existing JSONL file on startup.
- Relay config snapshot API: `GET /ops/config` (admin-protected, redacted).
- Local agent with reconnect and heartbeat; implemented `help/status/plan/patch/apply/test`.
- VSCode extension scaffold is included with commands:
  - `CodexBridge: Start Agent`
  - `CodexBridge: Stop Agent`
  - `CodexBridge: Agent Status`
- Extension runtime context adapter captures:
  - active file path/content
  - selected text
  - language id
  and injects them into patch requests.
- In extension mode, apply/test confirmation uses native VSCode modal dialogs.
- `patch` now calls real `codex app-server` through `@codexbridge/codex-client` (no mock patch).
- Local confirmation gate for `apply` and `test` (TTY prompt or env overrides).
- Safe patch apply (workspace path traversal protection + atomic write).
- Test execution pipeline with allowlist and timeout.
- Codex client with persistent process, request timeout, and response mapping.

## What is Pending

- Extension publishing/release automation.
- Production-grade persistence (Redis/Postgres), audit retention, and metrics.
- Redis/Postgres backed machine registry and audit store (Redis idempotency is implemented; machine/audit remain in-memory+JSONL).

## Quick Start

Prerequisites:
- Node.js 20+
- pnpm 9+

Install and build:

```bash
pnpm install
pnpm build
pnpm test
```

Start local Redis for dedupe:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Bootstrap test environment (Windows):

```bash
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-test-env.ps1
```

Start test stack (relay + node agent):

```bash
powershell -ExecutionPolicy Bypass -File scripts/start-test-stack.ps1
```

Run relay:

```bash
set ALLOWLIST_USERS=u1
set MACHINE_BINDINGS=u1:dev-machine-1
set WECOM_TOKEN=your_token
set WECOM_ENCODING_AES_KEY=your_43_char_encoding_aes_key
set WECOM_CORP_ID=wwxxxxxxxxxxxxxxxx
set WECOM_AGENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
set WECOM_AGENT_ID=1000002
set AUDIT_LOG_PATH=D:\fzhlian\Code\CodexBridge\audit\relay-command-events.jsonl
set AUDIT_MAX_RECORDS=2000
set REDIS_URL=redis://127.0.0.1:6379
set REDIS_PREFIX=codexbridge:dedupe:
set MACHINE_HEARTBEAT_TIMEOUT_MS=45000
set INFLIGHT_COMMAND_TIMEOUT_MS=900000
set COMMAND_TEMPLATE_TTL_MS=86400000
set COMMAND_TEMPLATE_MAX=5000
set RELAY_ADMIN_TOKEN=change_me_admin_token
set RESULT_WEBHOOK_URL=http://127.0.0.1:9999/result
pnpm --filter @codexbridge/relay-server run dev
```

Run local agent:

```bash
set RELAY_WS_URL=ws://127.0.0.1:8787/agent
set MACHINE_ID=dev-machine-1
set WORKSPACE_ROOT=D:\fzhlian\Code\CodexBridge
set CODEX_COMMAND=codex
set CODEX_ARGS=app-server
set CODEX_REQUEST_TIMEOUT_MS=60000
set CONTEXT_MAX_FILES=3
set CONTEXT_MAX_FILE_CHARS=12000
set CONTEXT_SUMMARY_MAX_ENTRIES=60
set MAX_DIFF_BYTES=200000
set TEST_ALLOWLIST=pnpm test,npm test
set TEST_DEFAULT_COMMAND=pnpm test
set AGENT_MAX_CONCURRENCY=1
set AGENT_COMMAND_TIMEOUT_MS=600000
pnpm --filter @codexbridge/vscode-agent run dev
```

Package VSCode extension:

```bash
pnpm --filter @codexbridge/vscode-agent build
pnpm --filter @codexbridge/vscode-agent package:vsix
```

Send mock command to relay:

```bash
curl -X POST http://127.0.0.1:8787/wecom/callback ^
  -H "content-type: application/json" ^
  -d "{\"msgId\":\"m1\",\"userId\":\"u1\",\"machineId\":\"dev-machine-1\",\"text\":\"@dev status\"}"
```

Run demo flow script:

```bash
powershell -ExecutionPolicy Bypass -File scripts/demo-flow.ps1 -UserId u1 -MachineId dev-machine-1
```

Send XML command to relay (WeCom-style):

```xml
<xml>
  <ToUserName><![CDATA[toUser]]></ToUserName>
  <FromUserName><![CDATA[u1]]></FromUserName>
  <CreateTime>1700000000</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[@dev patch fix bug in src/main.ts]]></Content>
  <MsgId>m2</MsgId>
</xml>
```

Apply flow:
- send `@dev patch <prompt>` and keep returned `commandId`
- send `@dev apply <commandId>`
- local terminal asks for confirmation before write

Test flow:
- `@dev test` to run default command
- `@dev test pnpm -r test` to run an allowed custom command
- local terminal asks for confirmation before execution

Audit query:
- `GET /commands/:commandId` returns lifecycle and status for one command
- `GET /audit/recent?limit=50&userId=u1&machineId=m1&status=agent_ok` supports filtered query
- `POST /commands/:commandId/cancel` requests cancellation for an in-flight command
- `POST /commands/:commandId/retry` retries an existing command template
- `GET /machines` shows connected machines and heartbeat staleness
- `GET /machines` also reports per-machine `runningCount` and `pendingCount`
- `GET /inflight` lists in-flight commands with age
- `GET /metrics` returns runtime counters for operations and monitoring
- `GET /ops/config` returns redacted runtime configuration snapshot
- when `RELAY_ADMIN_TOKEN` is set, include header `x-admin-token: <token>` for all ops endpoints above

## Docs

- `docs/API.md`
- `docs/DEPLOY_TEST.md`
- `docs/OPERATIONS.md`
- `SECURITY_CHECKLIST.md`
- `SPEC.md`
- `TASKS.md`
- `ARCHITECTURE.md`
- `SECURITY.md`
- `THREAT_MODEL.md`
- `DECISIONS.md`
- `PRINCIPLES.md`
- `TENETS.md`
- `IMPLEMENTATION_STATUS.md`

## Config Template

Use `.env.example` as baseline configuration and copy values into your runtime env/secrets manager.

## CI

GitHub Actions workflow is included at `.github/workflows/ci.yml` and runs:
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

VSCode agent packaging workflow is included at `.github/workflows/vscode-agent-package.yml`:
- manual run via `workflow_dispatch`
- automatic run on tag push `v*`
- uploads `codexbridge-agent.vsix` as artifact
