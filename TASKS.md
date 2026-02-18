# CodexBridge - Execution Plan

## Planning Conventions
- Milestones are executed in order from `M0` to `M10`.
- Every milestone defines scope, deliverables, dependencies, and exit criteria.
- A milestone is done only when all exit criteria are verifiable.

## M0 - Bootstrap
Scope:
- Establish the repository baseline and development toolchain.

Deliverables:
- pnpm monorepo structure.
- TypeScript strict mode across packages.
- ESLint setup with runnable scripts.

Dependencies:
- None.

Exit Criteria:
- `pnpm install` succeeds.
- `pnpm -r build` succeeds.
- `pnpm -r lint` succeeds.

## M1 - Shared Foundations
Scope:
- Define shared contracts used by relay and local runtimes.

Deliverables:
- Protocol types for command/result transport.
- `@dev` DSL parser for supported command kinds.
- Idempotency interface and related abstractions.

Dependencies:
- M0.

Exit Criteria:
- Shared package builds with strict TypeScript.
- DSL unit tests pass.
- Messages without valid `@dev` intent are ignored.

## M2 - Relay Server
Scope:
- Build the central routing service between WeCom and local agents.

Deliverables:
- Fastify HTTP service.
- WebSocket router for agent sessions.
- Machine registry and command dispatch.
- Rate limiting and basic abuse controls.
- `POST /wecom/callback` endpoint.

Dependencies:
- M1.

Exit Criteria:
- Relay accepts callback payloads and validates required fields.
- Mock agent can connect and receive routed commands.
- Relay returns deterministic error responses for invalid input.

## M3 - WeCom Integration
Scope:
- Make WeCom callback and reply flow production-safe.

Deliverables:
- Signature verification.
- AES decryption for encrypted callback payloads.
- Message reply pipeline for command results.

Dependencies:
- M2.

Exit Criteria:
- Real WeCom callback can trigger a command end-to-end.
- Invalid signatures are rejected.
- Encrypted callback flow can be decrypted and replied successfully.

## M4 - VS Code Agent Runtime
Scope:
- Provide the local runtime that executes commands safely.

Deliverables:
- VS Code extension entrypoints and lifecycle control.
- WSS connection, reconnect, and heartbeat.
- Base command handling (`help`, `status`).

Dependencies:
- M1, M2.

Exit Criteria:
- Agent can register to relay and maintain heartbeat.
- `status` returns valid local workspace/runtime information.
- Disconnect and reconnect behavior is stable.

## M5 - Codex Client and Execution Pipeline
Scope:
- Integrate Codex app-server and safe local execution gates.

Deliverables:
- Spawn and manage `codex app-server`.
- JSONL request/response parser.
- Timeout and cancellation handling.
- Local confirmation gates for `apply` and `test`.

Dependencies:
- M4.

Exit Criteria:
- One request-response cycle completes through Codex client.
- `patch` produces a reviewable diff artifact.
- `apply` and `test` cannot execute without local confirmation.

## M6 - Chat UI (Codex-like)
Scope:
- Add an interactive chat workflow inside VS Code with thread continuity.

Deliverables:
- Webview chat panel.
- Streaming message rendering.
- Diff preview with apply gating.
- Slash commands (`/plan`, `/patch`, `/test`).
- WeCom command interop on the same thread.

Dependencies:
- M2, M4, M5.

Exit Criteria:
- User can run `/plan`, `/patch`, and `/test` from chat UI.
- Diff is visible before any apply action.
- Apply remains gated behind explicit local confirmation.
- WeCom-originated and UI-originated commands appear in one shared thread.

## M10 - Chat UI Upgrade Pack (Codex-like)
Scope:
- Deliver the full Webview-based chat experience and protocol contract defined by the Chat UI upgrade pack.

Dependencies:
- M2, M4, M5, M6.

### T10.1 WebviewViewProvider Scaffold
Deliverables:
- Add chat view container and icon contribution.
- Implement `WebviewViewProvider` scaffold in `chatProvider.ts`.
- Load `chat.html`, `chat.js`, and `styles.css` from `media/`.

Exit Criteria:
- Sidebar shows `CodexBridge Chat` and basic UI renders.

### T10.2 Protocol Plumbing
Deliverables:
- Implement `chatProtocol.ts` request/event schemas.
- Wire `ui <-> extension` message channel.
- Implement `request_state -> state` response flow.

Exit Criteria:
- UI can request thread state and render message history.

### T10.3 Thread State and Persistence
Deliverables:
- Implement `chatState.ts` for thread/context/message state.
- Persist last `N` messages per thread in `workspaceState`.

Exit Criteria:
- Reloading VS Code retains recent chat messages.

### T10.4 Send Message Flow (Non-streaming Baseline)
Deliverables:
- `send_message` appends `user` + assistant placeholder.
- Non-stream fallback path resolves assistant response.

Exit Criteria:
- UI reliably shows request/response flow.

### T10.5 Streaming
Deliverables:
- Emit `stream_start`, `stream_chunk`, `stream_end` events.
- UI appends chunks incrementally without full list re-render.

Exit Criteria:
- Streaming output is visible and incremental.

### T10.6 Diff Attachment and File Summary
Deliverables:
- Parse unified diff and compute `DiffFileSummary`.
- Attach diff payload to assistant message with action buttons.

Exit Criteria:
- Patch response shows `View Diff` and `Apply Diff`.

### T10.7 Virtual Docs and Diff Viewer
Deliverables:
- Implement `codexbridge:` virtual document provider.
- Implement `view_diff` action with `vscode.diff`.

Exit Criteria:
- `View Diff` opens a VS Code diff editor.

### T10.8 Apply Diff Gating and Atomic Write
Deliverables:
- Enforce modal confirmation before apply.
- Validate workspace paths and reject traversal.
- Use atomic writes and rollback-on-failure safeguards.

Exit Criteria:
- Reject path/user confirmation => no file change.
- Confirmed apply => files updated.

### T10.9 Run Test Gating and Logs
Deliverables:
- Enforce modal confirmation before test execution.
- Execute configured/default command and return tail logs.

Exit Criteria:
- Reject path/user confirmation => no execution.
- Confirmed run => logs attached in thread.

### T10.10 WeCom Remote Message Mirror
Deliverables:
- Mirror remote command as `role=remote` message.
- Mirror remote result into same local thread.

Exit Criteria:
- WeCom-triggered patch flow appears in local chat thread with result artifacts.

### T10.11 Polish
Deliverables:
- Copy action routing.
- Thread clear action.
- Structured error attachments and toast feedback.

Exit Criteria:
- Chat panel is usable end-to-end for local and remote-driven flows.
