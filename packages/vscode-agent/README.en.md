# CodexBridge VS Code Agent

This extension hosts the local CodexBridge runtime inside VS Code.

## Features
- Relay agent lifecycle commands (`Start Agent`, `Stop Agent`, `Agent Status`).
- Sidebar chat view (`CodexBridge Chat`) with thread persistence.
- Streaming assistant output (`stream_start/chunk/end`).
- Slash commands: `/plan`, `/patch`, `/test`.
- Diff attachments with `View Diff` and `Apply Diff`.
- Local test execution action with logs attachment.
- WeCom remote command/result mirror in the same local thread.

## Commands
- `CodexBridge: Start Agent`
- `CodexBridge: Stop Agent`
- `CodexBridge: Agent Status`

## Key Settings
- `codexbridge.ui.enableChatView`
- `codexbridge.ui.maxMessages`
- `codexbridge.allowApplyPatch`
- `codexbridge.allowRunTerminal`
- `codexbridge.defaultTestCommand`
- `codexbridge.contextMaxFiles`
- `codexbridge.contextMaxFileBytes`
- `codexbridge.relayUrl`
- `codexbridge.machineId`

## Security
- `apply` and `test` are always locally confirmed in modal dialogs.
- Diff apply is workspace-bound and path traversal is rejected.
- Diff preview uses virtual documents and does not write files.

## Package
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
