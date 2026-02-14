# CodexBridge Relay API

## Base

- Local default: `http://127.0.0.1:8787`
- If `RELAY_ADMIN_TOKEN` is set, include header:
  - `x-admin-token: <token>`

## Health

### `GET /healthz`

Returns relay process health.

## WeCom Callback

### `GET /wecom/callback`

WeCom URL verification entry.

### `POST /wecom/callback`

Main inbound command entry.

Supported payload forms:
- JSON payload (`msgId/userId/machineId/text`)
- WeCom XML payload
- encrypted WeCom XML envelope (`Encrypt`)

## Command Ops

### `GET /commands/:commandId`

Returns command lifecycle record from audit index.

### `GET /audit/recent?limit=50&userId=u1&machineId=m1&status=agent_ok`

Returns recent command records with optional filters.

### `GET /inflight`

Returns current in-flight commands tracked by relay.

### `POST /commands/:commandId/cancel`

Sends cancellation signal to local agent for an in-flight command.

Optional request body:

```json
{
  "userId": "u1"
}
```

### `POST /commands/:commandId/retry`

Retries an existing command template with a new command id.

Optional request body:

```json
{
  "userId": "u1"
}
```

## Runtime Ops

### `GET /machines`

Returns connected machines and heartbeat staleness, including:
- `runningCount`
- `pendingCount`

### `GET /metrics`

Returns counters:
- machine totals/staleness
- inflight totals
- audit totals/by-status
- store mode/degeneration diagnostics (`store.mode`, `store.degraded`, `store.redisErrorCount`)

### `GET /ops/config`

Returns redacted runtime configuration snapshot:
- relay timeout and auth settings
- WeCom config presence flags
- audit config summary
- storage mode diagnostics:
  - `configuredMode`
  - `mode`
  - `degraded`
  - `redisErrorCount`
  - `lastRedisError`

## Status Semantics

Examples for command/audit status values:

- `created`
- `sent_to_agent`
- `machine_offline`
- `cancel_sent`
- `retried_created`
- `agent_ok`
- `agent_error`
- `agent_rejected`
- `agent_cancelled`
- `inflight_timeout`
