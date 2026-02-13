# CodexBridge Test Deployment Guide

This guide sets up a runnable test environment on Windows PowerShell.

## 1. Prerequisites

- Node.js 20+
- pnpm 9+
- Docker Desktop (for local Redis)
- `codex` CLI available in PATH

## 2. Bootstrap

From repo root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-test-env.ps1
```

What it does:
- checks required tools
- creates `.env.test` from `.env.test.example` if missing
- creates `audit/` directory
- starts Redis via `docker-compose.dev.yml`
- runs `pnpm install` (if available)

## 3. Configure `.env.test`

Required for test mode:

- `ALLOWLIST_USERS`
- `MACHINE_BINDINGS`
- `RELAY_WS_URL`
- `MACHINE_ID`
- `WORKSPACE_ROOT`
- `CODEX_COMMAND`

If you only test JSON callback mode, WeCom secrets are not required.

## 4. Start Stack

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-test-stack.ps1
```

This opens two terminals:
- relay server
- node agent runtime

## 5. Smoke Test

Use built-in demo:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/demo-flow.ps1 -UserId u1 -MachineId dev-machine-1
```

Or send direct command:

```powershell
curl -X POST http://127.0.0.1:8787/wecom/callback `
  -H "content-type: application/json" `
  -d "{\"msgId\":\"m1\",\"userId\":\"u1\",\"machineId\":\"dev-machine-1\",\"text\":\"@dev status\"}"
```

## 6. Validate Ops Endpoints

If `RELAY_ADMIN_TOKEN` is configured, add `x-admin-token` header.

- `GET /healthz`
- `GET /machines`
- `GET /inflight`
- `GET /metrics`
- `GET /audit/recent`

## 7. Common Failures

- `node/pnpm not found`: install and reopen terminal.
- `machine_offline`: ensure agent process is running with same `MACHINE_ID`.
- `command_not_inflight` on cancel: command already completed or not dispatched.
- `codex patch generation failed`: verify `codex` CLI works standalone.

