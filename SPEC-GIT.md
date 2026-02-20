# SPEC-GIT.md — CodexBridge Git Sync Task (Plan + Execute with Local Authority)

## 0. Goal

Enable CodexBridge to accept natural language requests such as:
- “同步到 GitHub”
- “把改动提交并推送到远程”
- “commit 并 push”
- “帮我发一个 PR”（Phase 2)

And produce a **safe, auditable Git execution flow**:
- automatically gather git status/diff metadata (low risk)
- propose a plan and a commit message
- require **local approval** for destructive/high-impact steps
- execute locally via a GitTool (no cloud execution)
- stream progress and return concise results to WeCom + local UI

Core rule:
> Remote intelligence proposes. Local machine executes.

---

## 1. Scope & Non-goals

### In scope (Phase 1)
- Git sync flow: status → diff summary → add → commit → push
- Risk-based gating:
  - auto-run low risk read-only commands
  - confirm for write operations and push
- Support both:
  - WeCom-triggered tasks
  - Local UI-triggered tasks
- Produce structured “Action Cards” in UI:
  - Run status/diff
  - Approve add/commit/push
- Handle common edge cases: no changes, no upstream, auth failure, rejected push

### Out of scope (Phase 1)
- PR creation (Phase 2)
- Advanced branch management (rebase, merge, force push)
- Secret/credential management beyond relying on existing git auth in environment
- Multi-repo operations

---

## 2. Safety & Risk Model

### 2.1 Command Risk Levels
Define risk tiers:

- **R0 (Read-only):** no workspace mutation, no remote mutation
  - `git status --porcelain=v1`
  - `git diff --stat`
  - `git diff`
  - `git log -n 10 --oneline`
  - `git branch --show-current`
  - `git remote -v`
  - `git rev-parse --abbrev-ref --symbolic-full-name @{u}`

- **R1 (Local write):** modifies local repo/index but not remote
  - `git add -A`
  - `git reset` (avoid in Phase 1 unless necessary)
  - `git commit -m ...`

- **R2 (Remote write):** modifies remote state
  - `git push origin <branch>`
  - `git push` (any push)

### 2.2 Gating Rules
- R0 commands may be auto-executed if `codexbridge.git.autoRunReadOnly = true` (default true).
- R1 and R2 **always require local approval**.
- For WeCom-triggered tasks:
  - approval must happen on local VS Code (dialog)
  - never auto-approve

### 2.3 Prohibited Operations (Phase 1)
Explicitly disallow:
- `git push --force` or `--force-with-lease`
- `git reset --hard`
- `git clean -fd`
- any command containing newline, `&&`, `;`, `|`, backticks, `$()`

All commands must be assembled by trusted code (GitTool), not by raw model output.

---

## 3. Task Router Integration

Add/extend TaskKind:
- `git_sync` (new)
or map to existing `run` with subtype `git`.

### 3.1 Intent Detection (heuristics)
If user text contains any:
- “同步到github / 同步到 GitHub / 推送 / push / 提交 / commit / 上传代码”
Route to:
- `kind = git_sync`
- `params.mode = "sync"`

### 3.2 Optional LLM-assisted intent
LLM may refine:
- commit message suggestion
- whether user requests push or only commit
But execution flow remains deterministic and gated.

---

## 4. GitTool (Local Executor)

Implement `GitTool` as a local-only abstraction.

### 4.1 API
```ts
type GitStatus = {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  porcelain: string;          // raw porcelain output (bounded)
  diffStat: string;           // diff --stat (bounded)
};

type GitCommitResult = {
  ok: boolean;
  commitSha?: string;
  message?: string;
  raw?: string;
};

type GitPushResult = {
  ok: boolean;
  remote?: string;
  branch?: string;
  raw?: string;
};

interface GitTool {
  detectRepo(cwd: string): Promise<boolean>;
  getStatus(cwd: string): Promise<GitStatus>;
  addAll(cwd: string): Promise<{ ok: boolean; raw: string }>;
  commit(cwd: string, message: string): Promise<GitCommitResult>;
  push(cwd: string, remote: string, branch: string): Promise<GitPushResult>;
}
4.2 Implementation constraints

Use child_process.spawn with args array (no shell).

Enforce max output bytes (e.g. 20KB per command).

Use cwd = workspace root.

Never print secrets; redact known patterns (optional).

5. Git Sync Flow (Phase 1)
5.1 Steps

Given workspace root:

R0 auto-run: detect repo + getStatus (status + branch + upstream + diffStat)

If no changes:

propose: “No changes to commit”

if ahead>0 and user asked push: propose push-only

Propose commit message:

Use LLM suggestion (safe) OR rule-based default:

e.g. “chore: update workspace”

Present Action Plan card:

[Approve & Run] git add -A (R1)

[Approve & Run] git commit -m "<msg>" (R1)

[Approve & Run] git push origin <branch> (R2)

Execute approved actions sequentially.

Summarize results:

commit sha

push output summary

errors (auth/rejected)

5.2 Upstream handling

If no upstream:

propose git push -u origin <branch> (still R2 and requires approval)
But Phase 1 may choose to:

fail with guidance: “No upstream configured, please set upstream first”
Pick one and implement deterministically (recommended: propose -u but require approval).

6. UI/WeCom Presentation
6.1 Local Chat UI

Render a Task Card:

Title: “Git Sync”

Status line (Planning / Proposal ready / Waiting approval / Executing / Completed / Failed)

Details:

branch, upstream, ahead/behind

diff --stat snippet

Actions:

Approve Add

Approve Commit

Approve Push

Logs attachment per step.

6.2 WeCom Output (concise)

Send:

TaskId

Current status (e.g. “Proposal ready; waiting local approval”)

branch + diff stats summary

When completed: commit sha + push summary

Never send full git diff.

7. Settings

Add:

codexbridge.git.enable (default true)

codexbridge.git.autoRunReadOnly (default true)

codexbridge.git.defaultRemote (default "origin")

codexbridge.git.requireApprovalForCommit (default true) [kept true]

codexbridge.git.requireApprovalForPush (default true) [always true in Phase 1]

8. Acceptance Criteria

“同步到 GitHub” triggers a git_sync task.

System auto-runs read-only status/diff and shows results.

It proposes a commit message and an action plan.

Add/Commit/Push never execute without local confirmation.

Successful flow returns:

commit sha (if committed)

push success summary (if pushed)

Failures show actionable reasons:

not a git repo

auth failure

rejected push

no changes

All commands executed via arg-array (no shell).
