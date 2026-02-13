# CodexBridge - Execution Tasks

## Milestone 0 - Bootstrap
- Create pnpm monorepo
- Enable strict TypeScript
- Setup ESLint

AC:
repo builds successfully.

## Milestone 1 - Shared
Implement:
- protocol types
- DSL parser
- idempotency interface

AC:
DSL unit tests pass.

## Milestone 2 - Relay Server
Build:
- Fastify server
- WebSocket router
- machine registry
- rate limiter

Add endpoint:
POST /wecom/callback

AC:
mock agent receives commands.

## Milestone 3 - WeCom Integration
Implement:
- signature verification
- AES decrypt
- message reply

AC:
real WeCom message triggers command.

## Milestone 4 - VSCode Agent
Create extension with:
- WSS connection
- reconnect
- heartbeat

Commands:
- help
- status

AC:
status returns workspace info.

## Milestone 5 - Codex Client
Implement:
- spawn codex app-server
- JSONL parser
- timeout

AC:
client completes one request-response cycle.

