# CodexBridge VS Code 代理

此扩展用于在 VS Code 内运行本地 CodexBridge 代理。

## 功能
- 代理生命周期命令（`启动代理`、`停止代理`、`代理状态`）。
- 侧边栏聊天视图（`CodexBridge 聊天`），支持线程持久化。
- 助手流式输出（`stream_start/chunk/end`）。
- 斜杠命令：`/plan`、`/patch`、`/test`。
- Diff 附件操作：`查看 Diff`、`应用 Diff`。
- 本地测试执行操作，并附带日志。
- 企业微信远程命令与结果会镜像到同一本地线程。

## 命令
- `CodexBridge: 启动代理`
- `CodexBridge: 停止代理`
- `CodexBridge: 代理状态`

## 关键设置
- `codexbridge.ui.enableChatView`
- `codexbridge.ui.maxMessages`
- `codexbridge.allowApplyPatch`
- `codexbridge.allowRunTerminal`
- `codexbridge.defaultTestCommand`
- `codexbridge.contextMaxFiles`
- `codexbridge.contextMaxFileBytes`
- `codexbridge.relayUrl`
- `codexbridge.machineId`

## 安全
- `apply` 与 `test` 操作始终通过本地模态框确认。
- Diff 应用受工作区边界限制，并拒绝路径穿越。
- Diff 预览使用虚拟文档，不会直接写入文件。

## 打包
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
