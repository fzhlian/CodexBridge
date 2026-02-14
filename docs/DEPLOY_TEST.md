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
- `STORE_MODE`
- `AUDIT_INDEX_MODE`
- `REDIS_URL`
- `RELAY_WS_URL`
- `MACHINE_ID`
- `WORKSPACE_ROOT`
- `CODEX_COMMAND`

If you only test JSON callback mode, WeCom secrets are not required.

Security note:
- Runtime now uses `process/user environment variables` first, and `.env.test` only as fallback for missing keys.
- Prefer storing real secrets in Windows user environment variables.
- Keep `.env.test` local only and do not commit it.

## 4. Start Stack

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-test-stack.ps1
```

By default this starts relay and agent in hidden PowerShell windows.

For one-command startup + health checks + report:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev-up-and-check.ps1 -RunDemoFlow
```

Report output path default:

```text
.\tmp\dev-up-report.json
```

`start-test-stack.ps1` starts two processes:
- relay server
- node agent runtime

If a previous stack is still recorded, `start-test-stack.ps1` now auto-runs `stop-test-stack.ps1` first to avoid duplicate processes.

Useful options:

```powershell
# show relay/agent windows
powershell -ExecutionPolicy Bypass -File scripts/start-test-stack.ps1 -ShowWindows

# force memory mode in one-command check (skip redis dependency)
powershell -ExecutionPolicy Bypass -File scripts/dev-up-and-check.ps1 -StoreMode memory

# require target machine online or fail
powershell -ExecutionPolicy Bypass -File scripts/dev-up-and-check.ps1 -RequireMachineOnline

# stop relay/agent started by start-test-stack
powershell -ExecutionPolicy Bypass -File scripts/stop-test-stack.ps1

# no PID file? still kill relay listener by port
powershell -ExecutionPolicy Bypass -File scripts/stop-test-stack.ps1 -KillRelayPort

# inspect stack status + endpoint diagnostics + log tails
powershell -ExecutionPolicy Bypass -File scripts/dev-status.ps1

# include log tail content
powershell -ExecutionPolicy Bypass -File scripts/dev-status.ps1 -IncludeLogs -LogTailLines 50

# clean report/logs/pid; add -StopStack to stop processes first
powershell -ExecutionPolicy Bypass -File scripts/clean-dev-state.ps1 -StopStack
```

`stop-test-stack.ps1` now also cleans orphan worker processes (`start-stack-worker.ps1`) to avoid cross-run port conflicts.

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
- `GET /ops/config` (check `store.mode` and `store.degraded`)

## 7. Common Failures

- `node/pnpm not found`: install and reopen terminal.
- `EADDRINUSE 0.0.0.0:8787`: run `scripts/stop-test-stack.ps1 -KillRelayPort`, then restart stack.
- `machine_offline`: ensure agent process is running with same `MACHINE_ID`.
- `machineOnline=false` but machine count > 0 in report: check `availableMachineIds` in `dev-up-report.json` and align `-MachineId` / `.env.test` `MACHINE_ID`.
- `command_not_inflight` on cancel: command already completed or not dispatched.
- `codex patch generation failed`: agent now auto-falls back to `codex exec`; verify `codex` CLI works standalone and can run non-interactive commands.
- `store.degraded=true`: relay has fallen back to memory, check Redis container/network.
