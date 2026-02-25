# Tool System Architecture (Codex-Peer Layer)

This document defines the `Tool System` as a first-class runtime layer parallel to `codex`.

## Goals

- Replace fragile "run raw string command directly" flow with a typed execution pipeline.
- Eliminate common execution failures through preflight checks and automatic recovery.
- Keep approvals and chat protocol unchanged while swapping execution internals.

## Directory Layout

```text
packages/vscode-agent/src/
  codex/                       # model/runtime adapter
  tools/                       # tool system (peer to codex)
    builtins/
      gitCommandTool.ts        # safe git execution tool
      shellCommandTool.ts      # generic shell tool + recovery rules
      vsixInstallTool.ts       # dedicated extension install tool
    commandLine.ts             # command parsing helpers
    processRunner.ts           # process exec adapter
    registry.ts                # ordered tool registry
    commandToolSystem.ts       # planner + preflight + executor + recovery
    types.ts                   # shared contracts
    index.ts                   # exports
```

## Pipeline

1. `plan`: map command text to tool (`vsix_install`, `git_command`, `shell_command`).
2. `preflight`: validate inputs and runtime prerequisites.
3. `execute`: run with tool-specific executor.
4. `recover`: on failure, derive next command and retry once with another tool.
5. `audit`: optional sink receives structured events (`planned/preflight/execute/recover/done`).

## Built-in Recovery Rules

- `shell_command` failure on `npm/pnpm/yarn install` in extension workspace:
  - if VSIX exists, auto-switch to `code --install-extension ... --force`
  - if VSIX missing, auto-switch to `pnpm ... package:vsix`
- `vsix_install` when `code` CLI is missing:
  - fallback to VS Code API install command (`workbench.extensions.installExtension`)

## Integration Point

- `chatActions.runCommandWithConfirmation` now delegates to `runCommandThroughToolSystem`.
- Approval gate remains unchanged.
- Return format remains compatible (`command exit=...`), with recovery command trace appended.

## Why this prevents the old failure class

The previous flow could silently run a wrong command type (`npm install`) for an extension install intention.
The new tool layer distinguishes command intent by tool type, applies targeted preflight checks, and recovers into extension-specific workflows automatically.
