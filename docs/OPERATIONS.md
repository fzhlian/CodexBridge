# CodexBridge Operations Guide

## 1. Local Dev Stack

Start Redis for relay state stores:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Check container:

```bash
docker ps | findstr codexbridge-redis
```

Start relay + agent (hidden windows, with PID/log tracking):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-test-stack.ps1
```

Stop stack and clean port 8787 if needed:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/stop-test-stack.ps1 -KillRelayPort
```

Quick status (store mode, degraded state, machine count):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev-status.ps1
```

## 2. Relay Critical Env

- `ALLOWLIST_USERS`
- `MACHINE_BINDINGS`
- `WECOM_TOKEN`
- `WECOM_ENCODING_AES_KEY`
- `WECOM_CORP_ID`
- `WECOM_AGENT_SECRET`
- `WECOM_AGENT_ID`
- `REDIS_URL`
- `STORE_MODE` (`memory|redis`)
- `AUDIT_INDEX_MODE` (`memory|redis`)
- `REDIS_PREFIX`
- `REDIS_MACHINE_TTL_MS`
- `REDIS_INFLIGHT_TTL_MS`
- `RELAY_ADMIN_TOKEN`

## 3. Runtime Inspection

With `RELAY_ADMIN_TOKEN` set, include header:

```text
x-admin-token: <token>
```

Useful endpoints:

- `GET /healthz`
- `GET /metrics`
- `GET /machines`
- `GET /inflight`
- `GET /commands/:id`
- `GET /audit/recent`
- `GET /ops/config`

`/ops/config` and `/metrics` now expose storage diagnostics:

- `store.mode`
- `store.degraded`
- `store.redisErrorCount`
- `store.lastRedisError`

## 4. Incident Actions

Cancel running command:

```bash
curl -X POST http://127.0.0.1:8787/commands/<commandId>/cancel ^
  -H "content-type: application/json" ^
  -H "x-admin-token: <token>" ^
  -d "{\"userId\":\"u1\"}"
```

Retry command:

```bash
curl -X POST http://127.0.0.1:8787/commands/<commandId>/retry ^
  -H "content-type: application/json" ^
  -H "x-admin-token: <token>" ^
  -d "{\"userId\":\"u1\"}"
```

If relay fails with `EADDRINUSE`, always run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/stop-test-stack.ps1 -KillRelayPort
```

This also clears orphan `start-stack-worker.ps1` processes.

## 5. Redis Health Checks

Basic connectivity check:

```bash
docker exec -it codexbridge-redis redis-cli ping
```

Expected output: `PONG`

If Redis is unavailable, relay falls back to memory mode and marks `store.degraded=true`.

If Docker daemon is down on Windows, run:

```bash
powershell -ExecutionPolicy Bypass -File scripts/ensure-docker-desktop.ps1
```

Then retry:

```bash
docker compose -f docker-compose.dev.yml up -d
```

## 6. Audit Retention

- audit index retention is capped by `AUDIT_MAX_RECORDS` (memory/redis index)
- on-disk JSONL is append-only at `AUDIT_LOG_PATH`

For long-term retention:

1. Ship JSONL to centralized log storage.
2. Rotate/archive file periodically.
3. Keep Redis audit index as short-term query cache only.
