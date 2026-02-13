# CodexBridge Operations Guide

## 1. Local Dev Stack

Start Redis for relay idempotency:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Check container:

```bash
docker ps | findstr codexbridge-redis
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

## 5. Audit Retention

- in-memory audit index is capped by `AUDIT_MAX_RECORDS`
- on-disk JSONL is append-only at `AUDIT_LOG_PATH`

For long-term retention:

1. Ship JSONL to centralized log storage.
2. Rotate/archive file periodically.
3. Move to database-backed store in production phase.

