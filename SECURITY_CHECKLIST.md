# CodexBridge Security Checklist

Use this checklist before exposing relay to public traffic.

## Identity and Access

- [ ] `ALLOWLIST_USERS` is configured and reviewed.
- [ ] `MACHINE_BINDINGS` is configured for every allowed user.
- [ ] `RELAY_ADMIN_TOKEN` is set and kept secret.

## Transport and WeCom

- [ ] Relay endpoint is served via HTTPS in production.
- [ ] `WECOM_TOKEN` is set.
- [ ] `WECOM_ENCODING_AES_KEY` is set (43 chars).
- [ ] `WECOM_CORP_ID`, `WECOM_AGENT_SECRET`, `WECOM_AGENT_ID` are set.
- [ ] WeCom callback signature verification is passing.

## Execution Safety

- [ ] apply/test require local confirmation.
- [ ] `TEST_ALLOWLIST` is strict and minimal.
- [ ] `MAX_DIFF_BYTES` is configured with conservative limit.
- [ ] `AGENT_MAX_CONCURRENCY` is set to a safe value (default 1).

## Runtime Hardening

- [ ] Redis is enabled for relay state in shared environments (`REDIS_URL`, `STORE_MODE=redis`).
- [ ] Redis requires authentication (password/ACL) and is not exposed to public network.
- [ ] Redis persistence policy (RDB/AOF) is reviewed for recovery requirements.
- [ ] `MACHINE_HEARTBEAT_TIMEOUT_MS` and `INFLIGHT_COMMAND_TIMEOUT_MS` are set.
- [ ] `REDIS_MACHINE_TTL_MS` and `REDIS_INFLIGHT_TTL_MS` are set.
- [ ] `COMMAND_TEMPLATE_TTL_MS` and `COMMAND_TEMPLATE_MAX` are set.
- [ ] Ops endpoints are protected by `x-admin-token`.

## Logging and Audit

- [ ] `AUDIT_LOG_PATH` is writable and monitored.
- [ ] `AUDIT_MAX_RECORDS` is set to a bounded value.
- [ ] Audit file rotation/archival strategy is defined.
- [ ] Sensitive tokens are never logged.

## CI and Delivery

- [ ] CI workflow is green on `main`.
- [ ] VSIX packaging workflow runs successfully.
- [ ] Release artifacts are reviewed before distribution.
