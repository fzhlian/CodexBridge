# SPEC-NL.md — CodexBridge Natural Language Task Engine

## 0. Goal

Upgrade CodexBridge from a small command DSL (help/status/plan/patch/apply/test) into a **natural-language capable task system** comparable to Codex chat UX:

- Accept free-form natural language from WeCom and from VS Code Chat UI.
- Interpret user intent into structured tasks.
- Produce proposals (plan / diff / command) with streaming progress.
- Enforce mandatory local approval for destructive actions (apply patch / run commands).
- Maintain auditable, deterministic execution boundaries.

Core rule remains:

> Remote intelligence. Local authority.  
> Natural language drives proposals, never silent execution.

---

## 1. Scope & Non-goals

### In scope
- Natural language parsing into `TaskIntent`
- Task execution orchestration (plan/patch/run/diagnose/explain/search/review)
- Unified Proposal model
- Mandatory approval gate for apply/run
- Streaming events to UI
- Compatibility with existing @dev DSL (keep as shortcuts)

### Non-goals (Phase 1)
- Full autonomous multi-agent loops
- Background refactoring or continuous automation
- Direct control of third-party chat extensions
- Server-side execution of code

---

## 2. High-level Architecture

Inputs:
- WeCom message text (prefixed @dev or configured)
- VS Code Chat UI input box

Core pipeline:
1) Normalize input → `UserRequest`
2) Task Router → `TaskPlan` (structured intent + required context/tools)
3) Task Runner:
   - collect context
   - call Codex app-server for proposal
   - stream events to UI
4) Approval Gate:
   - if proposal is destructive: require local approval
5) Execute (local only) or return proposal
6) Summarize results → WeCom + local Chat UI

---

## 3. Data Model

### 3.1 UserRequest
```ts
type UserRequest = {
  source: "wecom" | "local_ui";
  threadId: string;
  fromUser?: string;
  text: string;              // natural language
  meta?: Record<string, any>;
};
````

### 3.2 TaskIntent (classification output)

```ts
type TaskKind =
  | "help"
  | "status"
  | "explain"     // explain code, concept, error
  | "change"      // propose code changes as diff
  | "run"         // propose running a command (tests/build/etc.)
  | "diagnose"    // analyze logs/errors, propose fix steps/diff
  | "search"      // find files/symbols/occurrences
  | "review";     // review diff/PR-like changes (local scope)

type TaskIntent = {
  kind: TaskKind;
  confidence: number;  // 0..1
  summary: string;     // short intent summary
  params?: {
    files?: string[];         // explicit file targets if detected
    cmd?: string;             // for run
    question?: string;        // for explain
    changeRequest?: string;   // for change/diagnose
    query?: string;           // for search
  };
};
```

### 3.3 Proposal (what the system produces)

```ts
type Proposal =
  | { type: "plan"; text: string }
  | { type: "diff"; diffId: string; unifiedDiff: string; files: DiffFileSummary[] }
  | { type: "command"; cmd: string; cwd?: string; reason?: string }
  | { type: "answer"; text: string }
  | { type: "search_results"; items: { path: string; preview?: string }[] };

type ExecutionRequirement =
  | { mode: "none" } // safe
  | { mode: "local_approval"; action: "apply_diff" | "run_command" };

type TaskResult = {
  taskId: string;
  intent: TaskIntent;
  proposal: Proposal;
  requires: ExecutionRequirement;
  summary: string;        // short for WeCom
  details?: string;       // long for local UI
};
```

---

## 4. Task Router (Natural Language -> TaskIntent)

### 4.1 Phase 1 Router (deterministic + safe)

Implement a two-stage router:

Stage A — Fast heuristic rules:

* If text matches legacy DSL (@dev help/status/plan/patch/apply/test) → map to existing commands.
* Else classify by keywords and structure:

  * includes "why / explain / what does" → explain
  * includes "fix / implement / refactor / add / change" → change
  * includes "run / test / build / lint" → run
  * includes "error / stacktrace / failed / exception" → diagnose
  * includes "find / locate / where is / search" → search
  * includes "review" → review

Stage B — Optional LLM-assisted classification (safe):

* Ask Codex (or model) for a small JSON classification with strict schema and a short explanation.
* Must NOT allow it to propose execution directly; only classification.

Routing policy:

* If confidence < threshold (e.g. 0.55), default to "explain" or "change" with safe plan-only proposal.
* Always safe-by-default.

### 4.2 Router output validation

* Ensure `kind` is one of allowed values.
* Ensure files list length <= maxFiles.
* Strip dangerous shell fragments from inferred cmd; mark as requiring approval.

---

## 5. Context & Tools

### 5.1 Context collector must support:

* Active file content (bounded)
* Selection content (bounded)
* Workspace file tree summary (paths only; bounded)
* Diagnostics (TypeScript, ESLint) if available
* Git info (branch, status, diff summary)
* Explicit file reads requested by intent (bounded, skip binary)

Enforce limits:

* maxFiles = 10
* maxFileBytes = 12_000 per file
* maxTotalBytes = 60_000
* never send secrets from env

### 5.2 Tools available to Task Runner

Local-only tools (invoked by extension host, not by remote):

* readFile(path)
* listFiles(glob)
* getDiagnostics()
* getGitStatus()
* applyUnifiedDiff(diff)
* runCommand(cmd, cwd)  // gated

Codex output must never directly execute tools without passing through approval gate.

---

## 6. Task State Machine

Represent each task as a state machine for observability:

States:

* RECEIVED
* ROUTED
* CONTEXT_COLLECTED
* PROPOSING (calling codex)
* PROPOSAL_READY
* WAITING_APPROVAL (if required)
* EXECUTING (local only)
* COMPLETED
* FAILED
* REJECTED

Each transition must emit an event to UI and optionally to logs.

---

## 7. Streaming Events to UI

Extend the existing UI protocol with task-level events:

```ts
type ExtToUI_TaskEvents =
  | { type: "task_start"; threadId: string; taskId: string; intent: TaskIntent }
  | { type: "task_state"; threadId: string; taskId: string; state: string; message?: string }
  | { type: "task_stream_chunk"; threadId: string; taskId: string; messageId: string; chunk: string }
  | { type: "task_proposal"; threadId: string; taskId: string; result: TaskResult }
  | { type: "task_end"; threadId: string; taskId: string; status: "ok" | "error" | "rejected" };
```

Local Chat UI should render:

* a progress line (state updates)
* streaming assistant content
* proposal attachments (diff/command)

WeCom should receive:

* short summary (no giant diffs)
* commandId/taskId reference
* optional “open VS Code to approve” hint if waiting approval

---

## 8. Approval Gate (Mandatory)

### 8.1 Apply diff gating

If proposal.type == "diff":

* requires = local_approval(action=apply_diff) when request is from remote OR user clicked Apply
* local dialog must show:

  * files changed
  * additions/deletions
* reject path traversal and out-of-workspace paths
* apply atomically

### 8.2 Run command gating

If proposal.type == "command":

* always requires local approval
* show cmd + cwd + reason
* optional allowlist later; for now confirm-only

### 8.3 Remote behavior when waiting approval

If source == wecom and approval required:

* reply to WeCom:

  * “Proposal ready; waiting for local approval on dev-machine-1”
* also inject into local UI as a remote message.

---

## 9. Legacy DSL Compatibility

Keep existing commands as shortcuts:

* @dev status/help
* @dev plan <text>
* @dev patch <text>
* @dev apply <id>
* @dev test --cmd="..."

But also support:

* @dev <natural language>  (anything else)
  This should go through Task Router.

---

## 10. WeCom Output Policy

WeCom messages must be concise:

* include taskId
* include summary
* include next steps (“approve locally”, “view diff in VS Code”)
* do NOT send huge diffs; send file list + stats + optionally a truncated snippet.

---

## 11. Implementation Steps (Phase 1)

### Step 1 — Introduce Task Engine skeleton

* taskEngine.ts: createTask, updateState, emit events, finalize

### Step 2 — Implement Task Router v1

* deterministic heuristics
* optional model-assisted classifier behind a setting flag

### Step 3 — Implement Task Runner for each kind (minimal)

* explain: produce answer
* change/diagnose: produce diff proposal (or plan-only if unsure)
* run: produce command proposal (never auto-run)
* search: list matching files/lines (local search)
* review: summarize local diff or file changes

### Step 4 — Wire to Chat UI

* show task progress + streaming output
* show proposal actions (View Diff / Apply / Run)

### Step 5 — Wire to WeCom path

* remote message injection into local UI
* short summary reply

---

## 12. Acceptance Criteria (Phase 1)

1. User can type free-form NL in local Chat UI and receive a coherent response.
2. WeCom can send free-form NL (@dev fix… / @dev explain…) and agent routes it correctly.
3. For "change/diagnose" tasks, system returns a diff proposal and supports View Diff.
4. Apply/Test never execute without local confirmation (always).
5. Task progress states appear in UI.
6. On failure, user sees meaningful error and can retry.

---

## 13. Settings

* codexbridge.nl.enable (bool, default true)
* codexbridge.nl.useModelRouter (bool, default false)
* codexbridge.nl.confidenceThreshold (number, default 0.55)
* codexbridge.defaultTestCommand (string)
* existing allowApplyPatch/allowRunTerminal still apply

```

---

