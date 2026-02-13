# CodexBridge - System Specification

## Overview
CodexBridge is a secure remote AI development bridge that connects WeCom to a local VS Code environment via a relay server and Codex app-server.

Core rule:

> Generate remotely. Execute locally.

No file modifications or shell commands occur without explicit local confirmation.

## Architecture
WeCom -> Relay Server -> VSCode Agent -> Codex app-server

Transport:
- HTTPS (WeCom callback)
- WSS (relay <-> agent)
- stdio JSONL (agent <-> Codex)

## Monorepo
packages:
- shared
- relay-server
- vscode-agent
- codex-client

Node >=20  
TypeScript strict.

## Shared Protocol
### Command Envelope
```ts
type CommandEnvelope = {
  commandId: string;
  kind: "help" | "status" | "plan" | "patch" | "apply" | "test";
  prompt?: string;
  refId?: string;
};
```

### Result Envelope
```ts
type ResultEnvelope = {
  commandId: string;
  status: "ok" | "error" | "rejected";
  summary: string;
  diff?: string;
};
```

## DSL
Supported commands:
- @dev help
- @dev status
- @dev plan <prompt>
- @dev patch <prompt>
- @dev apply <commandId>
- @dev test

Ignore messages not starting with @dev.

## Security
Mandatory rules:
1. Apply requires local confirmation.
2. Test requires local confirmation.
3. Diff must never auto-apply.
4. Machine binding enforced.
5. User allowlist enforced.

