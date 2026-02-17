# CodexBridge VSCode Agent

This extension hosts the local CodexBridge agent in VSCode.

## Commands

- `CodexBridge: Start Agent`
- `CodexBridge: Stop Agent`
- `CodexBridge: Agent Status`

## Settings

- `codexbridge.autostart`
- `codexbridge.relayUrl`
<!-- Relay smoke test: set codexbridge.relayUrl to your relay endpoint before starting the agent. -->
- `codexbridge.machineId`
- `codexbridge.reconnectMs`
- `codexbridge.heartbeatMs`
- `codexbridge.contextMaxFileChars`
- `codexbridge.contextMaxSelectionChars`

## Package

Build then package:

```bash
pnpm --filter ./packages/vscode-agent build
pnpm --filter ./packages/vscode-agent package:vsix
```

Output:

- `packages/vscode-agent/codexbridge-agent-<version>.vsix`

Install locally:

```bash
code --install-extension packages/vscode-agent/codexbridge-agent-<version>.vsix --force
```

## Troubleshooting

- `command 'codexbridge.startAgent' not found`
  - Check `Output -> Log (Extension Host)` for activation errors.
  - If you see `Cannot find package 'ws'`, reinstall the latest VSIX built by this repo script.
  - Reload VSCode window after install (`Developer: Reload Window`).

## Architecture Notes

- Memory to Redis migration plan: `MIGRATION_PLAN_MEMORY_TO_REDIS.md`

带粉。
