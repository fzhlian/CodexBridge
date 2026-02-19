# TASKS-NL.md - CodexBridge Natural Language Task Engine

This file tracks implementation status for `SPEC-NL.md`.

Rules:
- Keep legacy DSL working.
- Natural language must never bypass local approval.
- Every milestone must build + lint + test before marked done.

Status legend:
- `[done]` implemented and verified
- `[partial]` implemented but not fully matching AC
- `[todo]` not started

Status snapshot date: `2026-02-19`

## Overall Status
- Phase 1 status: `[done]`
- Repository validation: `[done]` (`pnpm run typecheck`, `pnpm run lint`, `pnpm run test` all passed)

---

## Milestone NL-0 - Prep & Guardrails [done]

### NL-0.1 Add settings flags [done]
- `codexbridge.nl.enable` (default `true`)
- `codexbridge.nl.useModelRouter` (default `false`)
- `codexbridge.nl.confidenceThreshold` (default `0.55`)

### NL-0.2 Add new module skeletons [done]
- `src/nl/taskEngine.ts`
- `src/nl/taskRouter.ts`
- `src/nl/taskRunner.ts`
- `src/nl/taskTypes.ts`
- `src/nl/taskEvents.ts`

---

## Milestone NL-1 - Task Types, Protocol, and Tests [done]

### NL-1.1 Implement taskTypes.ts [done]
- `UserRequest`, `TaskKind`, `TaskIntent`
- `Proposal`, `ExecutionRequirement`, `TaskResult`
- `TaskState` + transition guard

### NL-1.2 Implement validation helpers [done]
- Added `src/nl/validate.ts`:
  - `validateIntent(intent)`
  - `sanitizeFiles(files, maxFiles)`
  - `sanitizeCmd(cmd)`
- Unit tests cover truncation, command sanitization, invalid kind rejection.

### NL-1.3 Extend Chat UI protocol for task events [done]
- Added task event message types to chat protocol.

---

## Milestone NL-2 - Task Engine (State Machine + Event Emission) [done]

### NL-2.1 Implement taskEngine.ts [done]
- Task creation/state transitions/proposal/end event emission.
- Transition validity enforcement.

### NL-2.2 Wire engine to Chat UI event channel [done]
- Task events persisted in chat state store.
- Task events replayed when UI requests thread state.

---

## Milestone NL-3 - Task Router v1 (Deterministic) [done]

### NL-3.1 Implement taskRouter.ts (heuristics) [done]
- Deterministic keyword router for:
  - `help`, `status`, `explain`, `change`, `run`, `diagnose`, `search`, `review`
- Strict `@dev ...` DSL compatibility mapping retained.
- File hint extraction + run command candidate extraction.
- Sanitization delegated to `validate.ts`.
- 20+ routing cases covered by tests.

### NL-3.2 Add routing integration point [done]
- Non-strict DSL messages route through NL task engine.
- Legacy DSL behavior remains available.

---

## Milestone NL-4 - Context Collection for NL Tasks [done]

### NL-4.1 Implement `collectTaskContext(...)` [done]
- Active file, selection, workspace summary (paths-only), diagnostics, git context.
- Limits enforced (`maxFiles`, `maxFileBytes`, `maxTotalBytes`) and binary skip.

### NL-4.2 Integrate with existing context collector [done]
- Chat context collection reuses NL task context implementation.

---

## Milestone NL-5 - Task Runner v1 (Safe tasks) [done]

### NL-5.1 Implement taskRunner skeleton [done]
- Emits expected state progression and task result.

### NL-5.2 Implement safe tasks without Codex dependency [done]
- `help` / `status` / `search` / `review` available offline.
- Search uses `vscode.workspace.findTextInFiles` when available, with local fallback.

---

## Milestone NL-6 - Explain/Change/Diagnose via Codex (Proposal-only) [done]

### NL-6.1 Prompt builder extraction [done]
- Added `src/nl/promptBuilder.ts` with explicit modes.

### NL-6.2 Explain task via Codex [done]
- Streaming chunks emitted to UI.

### NL-6.3 Change/Diagnose proposal flow [done]
- Diff-first output parsing and diff proposal generation.

### NL-6.4 Failure handling [done]
- Invalid diff falls back to plan proposal, no crash.

---

## Milestone NL-7 - Approval Gate Integration (Apply/Run) [done]

### NL-7.1 Unified approval API [done]
- Added `src/nl/approvalGate.ts`, centralized local confirmation.

### NL-7.2 Apply diff execution path [done]
- Apply actions emit standardized task state transitions.
- Local confirmation required; path-safety checks enforced by patch apply layer.

### NL-7.3 Run command proposal & execution [done]
- Local confirmation mandatory.
- VS Code task based path preferred, with process fallback.
- Logs captured and attached to task result.

---

## Milestone NL-8 - WeCom Integration for NL Tasks [done]

### NL-8.1 WeCom -> task creation [done]
- Non-strict DSL WeCom inputs become NL `task` commands.
- Remote message injected into local chat thread.

### NL-8.2 WeCom output policy [done]
- Concise formatted summary includes task id, intent, summary, and next step.
- Length caps and diff-content suppression are enforced.

---

## Milestone NL-9 - UX & Reliability Polish [done]

### NL-9.1 Retry support [done]
- UI action `retry_task` re-runs previous task input with new task id.

### NL-9.2 Task cancellation (best-effort) [done]
- UI action `cancel_task` aborts running task or rejects waiting-approval task.
- Stream termination and terminal task state handling standardized.

### NL-9.3 Observability [done]
- Structured `[task]` logs include task id, intent, transitions, proposal type, and duration.

---

## Milestone NL-10 - Regression & Security Tests [done]

### NL-10.1 Security regression tests [done]
- Added dedicated NL security tests for:
  - apply path traversal guard
  - no run execution on approval reject
  - context byte-limit enforcement

### NL-10.2 Legacy DSL regression tests [done]
- Legacy command compatibility remains covered.

---

## Definition of Done (Phase 1) [done]
- Natural language tasks work in local chat and WeCom paths.
- Explain/change/diagnose/search/review/run minimal loop implemented.
- Apply/run always require local approval.
- Task state machine events are emitted and rendered.
- Retry/cancel + structured task observability implemented.
- Lint/typecheck/tests pass repository-wide.
