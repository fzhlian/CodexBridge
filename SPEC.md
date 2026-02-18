# CodexBridge - System Specification

## 1. Purpose
CodexBridge is a secure remote AI development bridge connecting WeCom requests to a local VS Code execution environment through a relay server and Codex app-server.

Core rule:

> Generate remotely. Execute locally.

No destructive action (apply/test) is executed without explicit local confirmation.

## 2. Scope
In scope:
- WeCom command intake and relay dispatch.
- Local VS Code agent command execution (`help`, `status`, `plan`, `patch`, `apply`, `test`).
- CodexBridge Chat webview in the VS Code sidebar.
- Streaming assistant rendering, diff preview, apply/test gating.
- WeCom command/result mirroring into local chat thread.

Out of scope:
- Injecting or controlling third-party chat extension UIs.
- Unattended auto-apply, auto-test, auto-commit, auto-PR.
- Remote shell execution without local approval.

## 3. System Context
Logical flow:

`WeCom -> Relay Server -> VS Code Agent -> Codex app-server`

Transport:
- HTTPS (`/wecom/callback`) for WeCom callback ingress.
- WSS for relay-agent command/result flow.
- JSONL over stdio for agent-Codex RPC.

## 4. Component Responsibilities
`packages/shared`:
- Protocol and envelope types.
- `@dev` command DSL parser.

`packages/relay-server`:
- Callback normalization, idempotency checks, allowlist + machine binding enforcement.
- Routing, inflight tracking, retry/cancel, audit and ops endpoints.

`packages/vscode-agent`:
- Relay connection lifecycle and command handlers.
- Local confirmation gating and safe patch apply/test execution.
- Chat webview provider, thread state, protocol routing, diff viewer actions.

`packages/codex-client`:
- Codex app-server process and JSONL RPC.
- Request timeout and restart handling.

## 5. Shared Command/Result Contracts
```ts
type CommandEnvelope = {
  commandId: string;
  machineId: string;
  userId: string;
  kind: "help" | "status" | "plan" | "patch" | "apply" | "test";
  prompt?: string;
  refId?: string;
  createdAt: string;
};

type ResultEnvelope = {
  commandId: string;
  machineId: string;
  status: "ok" | "error" | "rejected" | "cancelled";
  summary: string;
  diff?: string;
  createdAt: string;
};
```

## 6. Chat Thread Model
Thread:
- `threadId: string` (`default` currently).
- `messages: ChatMessage[]`.
- `lastUpdatedAt: ISO string`.
- persistence in `workspaceState`, capped by `codexbridge.ui.maxMessages` (default `200`).

```ts
type Role = "user" | "assistant" | "system" | "remote" | "tool";

type ChatMessage = {
  id: string;
  threadId: string;
  role: Role;
  createdAt: string;
  author?: string;
  text?: string;
  attachments?: Attachment[];
  meta?: Record<string, unknown>;
};

type Attachment =
  | { type: "diff"; diffId: string; title?: string; unifiedDiff: string; files: DiffFileSummary[] }
  | { type: "logs"; title?: string; text: string }
  | { type: "status"; title?: string; json: unknown }
  | { type: "error"; title?: string; code: string; message: string; details?: unknown };

type DiffFileSummary = {
  path: string;
  additions: number;
  deletions: number;
};
```

## 7. Webview Protocol
### 7.1 UI -> Extension
```ts
type UIToExt =
  | { type: "ui_ready"; version: 1 }
  | { type: "send_message"; threadId: string; text: string; context: UIContextRequest }
  | { type: "set_context"; threadId: string; context: UIContextRequest }
  | { type: "view_diff"; threadId: string; diffId: string }
  | { type: "apply_diff"; threadId: string; diffId: string }
  | { type: "run_test"; threadId: string; cmd?: string }
  | { type: "copy_to_clipboard"; text: string }
  | { type: "clear_thread"; threadId: string }
  | { type: "request_state"; threadId: string };
```

### 7.2 Extension -> UI
```ts
type ExtToUI =
  | { type: "state"; threadId: string; state: ThreadStateDTO }
  | { type: "append_message"; threadId: string; message: ChatMessageDTO }
  | { type: "update_message"; threadId: string; messageId: string; patch: Partial<ChatMessageDTO> }
  | { type: "stream_start"; threadId: string; messageId: string }
  | { type: "stream_chunk"; threadId: string; messageId: string; chunk: string }
  | { type: "stream_end"; threadId: string; messageId: string }
  | { type: "toast"; level: "info" | "warn" | "error"; message: string }
  | { type: "action_result"; action: string; ok: boolean; message?: string; details?: unknown };
```

### 7.3 DTO
```ts
type ThreadStateDTO = {
  threadId: string;
  messages: ChatMessageDTO[];
  context: UIContextRequest;
};

type ChatMessageDTO = {
  id: string;
  role: Role;
  author?: string;
  createdAt: string;
  text?: string;
  attachments?: Attachment[];
};
```

## 8. Context Request Contract
```ts
type UIContextRequest = {
  includeActiveFile?: boolean;
  includeSelection?: boolean;
  includeWorkspaceSummary?: boolean;
  files?: string[];
};
```

Backend limits:
- `maxFiles = 10`
- `maxFileBytes = 12_000`
- binary files are skipped
- workspace summary is path/size oriented, not full file content dump

## 9. Chat Interaction Rules
Send flow:
1. UI sends `send_message`.
2. Extension appends `role=user`.
3. Extension appends `role=assistant` placeholder.
4. Extension emits `stream_start -> stream_chunk* -> stream_end`.
5. If patch diff exists, assistant message includes `Attachment(type="diff")` with `View Diff` and `Apply Diff` actions.

Slash commands:
- `/plan <prompt>`
- `/patch <prompt>`
- `/test [command]`

Remote mirror:
- Relay command received by local agent appends `role=remote` message (`@dev ...`).
- Result is mirrored into same local thread as assistant output, with diff/log/error attachments when applicable.

## 10. Diff Preview and Apply Requirements
Diff lifecycle:
- `diffId = uuid`.
- Diff stored in extension host memory with bounded retention.
- `view_diff` and `apply_diff` are resolved only via `diffId`.

View Diff:
- unified diff is applied in memory only (no disk write).
- virtual documents use `codexbridge:/diff/<diffId>/before/<path>` and `.../after/...`.
- VS Code command: `vscode.diff(beforeUri, afterUri, title)`.

Apply Diff:
- modal confirmation is mandatory and must show file/change summary.
- path traversal is rejected.
- write path must stay within workspace.
- writes are atomic per-file with rollback-on-failure safeguards.

## 11. Test Execution Requirements
Run Test:
- modal confirmation is mandatory.
- confirmation includes command + cwd.
- command result returns tail logs as `Attachment(type="logs")`.

Gating:
- `codexbridge.allowRunTerminal` must be enabled.
- command must pass allowlist checks.
- user rejection returns `rejected` with explicit reason and no execution.

## 12. Security Rules
`SEC-001` Apply is always locally confirmed; no bypass mode.

`SEC-002` Test execution is always locally confirmed; no bypass mode.

`SEC-003` Diff generation never auto-applies changes.

`SEC-004` Path traversal outside workspace is rejected for context and diff operations.

`SEC-005` WeCom allowlist and machine binding are enforced before relay dispatch.

`SEC-006` Failed apply attempts should not leave partial writes when rollback succeeds.

`SEC-007` Audit trail must preserve command id, actor context, and final status.

## 13. Error Handling and UX
Failure handling:
- codex unavailable/timeout => toast + assistant `error` attachment.
- diff parse/view/apply failure => action failure result + `error` attachment; no file changes.
- test timeout/cancel/non-allowlisted => explicit rejected/error result and logs if available.
- protocol mismatch (`ui_ready.version`) => warning toast.

## 14. Settings
Required/primary settings:
- `codexbridge.ui.enableChatView` (bool, default `true`)
- `codexbridge.ui.maxMessages` (number, default `200`)
- `codexbridge.defaultTestCommand` (string, default `"pnpm test"`)
- `codexbridge.allowApplyPatch` (bool, default `true`)
- `codexbridge.allowRunTerminal` (bool, default `false`)
- `codexbridge.contextMaxFiles` (number, default `10`)
- `codexbridge.contextMaxFileBytes` (number, default `12000`)

Inherited existing settings:
- `codexbridge.relayUrl`
- `codexbridge.machineId`
- `codexbridge.reconnectMs`
- `codexbridge.heartbeatMs`

## 15. Definition of Done
1. VS Code sidebar contains `CodexBridge Chat` view.
2. Sending a message produces assistant streaming output in UI.
3. Patch response provides unified diff + `View Diff` + `Apply Diff`.
4. `Apply Diff` always requires modal confirmation before write.
5. `Run Test` always requires modal confirmation before execution and returns logs.
6. WeCom `@dev patch ...` appears in local chat as `remote` + mirrored result.
7. Any unconfirmed apply/test returns explicit rejected path.

## 16. Milestone Mapping
- `M0-M5`: core repo, relay, agent, codex pipeline.
- `M6`: baseline chat UI capability.
- `M10`: protocol-complete Chat UI upgrade pack implementation (webview, streaming, diff actions, gating, WeCom mirror, polish).
