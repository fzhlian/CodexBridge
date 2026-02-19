# CodexBridge VS Code Agent / CodexBridge VS Code 代理

[English](#english) | [简体中文](#zh-cn)

<a id="english"></a>
## English

This extension hosts the local CodexBridge runtime inside VS Code.

### Features
- Relay agent lifecycle commands (`Start Agent`, `Stop Agent`, `Agent Status`).
- Sidebar chat view (`CodexBridge Chat`) with thread persistence.
- Streaming assistant output (`stream_start/chunk/end`).
- Slash commands: `/plan`, `/patch`, `/test`.
- Diff attachments with `View Diff` and `Apply Diff`.
- Local test execution action with logs attachment.
- WeCom remote command/result mirror in the same local thread.

### Commands
- `CodexBridge: Start Agent`
- `CodexBridge: Stop Agent`
- `CodexBridge: Agent Status`

### Key Settings
- `codexbridge.ui.enableChatView`
- `codexbridge.ui.maxMessages`
- `codexbridge.allowApplyPatch`
- `codexbridge.allowRunTerminal`
- `codexbridge.defaultTestCommand`
- `codexbridge.contextMaxFiles`
- `codexbridge.contextMaxFileBytes`
- `codexbridge.relayUrl`
- `codexbridge.machineId`

### Security
- `apply` and `test` are always locally confirmed in modal dialogs.
- Diff apply is workspace-bound and path traversal is rejected.
- Diff preview uses virtual documents and does not write files.

### Package
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

<a id="zh-cn"></a>
## 简体中文

此扩展用于在 VS Code 内运行本地 CodexBridge 代理。

### 功能
- 代理生命周期命令（`启动代理`、`停止代理`、`代理状态`）。
- 侧边栏聊天视图（`CodexBridge 聊天`），支持线程持久化。
- 助手流式输出（`stream_start/chunk/end`）。
- 斜杠命令：`/plan`、`/patch`、`/test`。
- Diff 附件操作：`查看 Diff`、`应用 Diff`。
- 本地测试执行操作，并附带日志。
- 企业微信远程命令与结果会镜像到同一本地线程。

### 命令
- `CodexBridge: 启动代理`
- `CodexBridge: 停止代理`
- `CodexBridge: 代理状态`

### 关键设置
- `codexbridge.ui.enableChatView`
- `codexbridge.ui.maxMessages`
- `codexbridge.allowApplyPatch`
- `codexbridge.allowRunTerminal`
- `codexbridge.defaultTestCommand`
- `codexbridge.contextMaxFiles`
- `codexbridge.contextMaxFileBytes`
- `codexbridge.relayUrl`
- `codexbridge.machineId`

### 安全
- `apply` 与 `test` 操作始终通过本地模态框确认。
- Diff 应用受工作区边界限制，并拒绝路径穿越。
- Diff 预览使用虚拟文档，不会直接写入文件。

### 打包
```bash
pnpm --filter ./packages/vscode-agent build
pnpm --filter ./packages/vscode-agent package:vsix
```

输出：
- `packages/vscode-agent/codexbridge-agent-<version>.vsix`

本地安装：
```bash
code --install-extension packages/vscode-agent/codexbridge-agent-<version>.vsix --force
```
