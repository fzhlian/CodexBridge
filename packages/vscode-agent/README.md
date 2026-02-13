# CodexBridge VSCode Agent

This extension hosts the local CodexBridge agent in VSCode.

## Commands

- `CodexBridge: Start Agent`
- `CodexBridge: Stop Agent`
- `CodexBridge: Agent Status`

## Settings

- `codexbridge.autostart`
- `codexbridge.relayUrl`
- `codexbridge.machineId`
- `codexbridge.reconnectMs`
- `codexbridge.heartbeatMs`
- `codexbridge.contextMaxFileChars`
- `codexbridge.contextMaxSelectionChars`

## Package

Build then package:

```bash
pnpm --filter @codexbridge/vscode-agent build
pnpm --filter @codexbridge/vscode-agent package:vsix
```

Output:

- `packages/vscode-agent/codexbridge-agent.vsix`

