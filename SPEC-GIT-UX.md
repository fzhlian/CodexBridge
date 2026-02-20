# SPEC-GIT-UX.md — Git Sync Action Card (Codex-like UX)

## 0. Objective

Make Git Sync feel like Codex:

- User types: “同步到 GitHub”
- System automatically:
  - collects git status + diffStat (R0 auto-run)
  - proposes commit message
  - prepares a Git Sync Action Card
- User chooses:
  - "Approve & Run All" (single confirmation) OR
  - step-by-step approvals
- System executes:
  - add → commit → push (or push-only)
- UI shows clear task states and streaming logs.

---

## 1. UI Concept: Git Sync Task Card

Each Git Sync request becomes a **Task Card** (not just chat bubbles).

### 1.1 Card layout (recommended)
Header:
- Icon: 🔧
- Title: `Git Sync`
- Subtitle: `branch: <branch>  upstream: <upstream|none>  ahead/behind: <a>/<b>`

Status strip (single line):
- `🟡 Planning` / `🟢 Proposal ready` / `🔵 Waiting approval` / `⚙ Executing` / `✅ Completed` / `❌ Failed`

Body:
- `Changes:` show diffStat snippet (bounded)
- `Proposed commit message:` "<message>"
- `Planned steps:` list:
  - `git add -A` (R1)
  - `git commit -m "<msg>"` (R1)
  - `git push origin <branch>` (R2)

Actions (buttons):
- Primary: `Approve & Run All`
- Secondary:
  - `Approve Add`
  - `Approve Commit`
  - `Approve Push`
- Utility:
  - `Copy summary`
  - `Show full logs` (expand)

Logs panel (collapsible):
- show per-step stdout/stderr tail

---

## 2. Interaction Model (Codex-like)

### 2.1 Auto-run low risk preflight
When task starts:
- auto-run R0:
  - detectRepo
  - git status porcelain
  - git diff --stat
  - branch/upstream/ahead/behind (best-effort)
- show state updates:
  - `🟡 Planning → Collecting git status...`
  - `🟡 Planning → Summarizing changes...`

### 2.2 Proposal Ready
Once preflight done:
- generate commit message
- render Action Card
- set state: `🟢 Proposal ready`

### 2.3 Approve & Run All (single confirmation)
Clicking primary button:
- MUST show local confirmation dialog including:
  - repo path
  - branch
  - planned steps (add/commit/push)
  - commit message
  - warning: push modifies remote
- If approved:
  - state: `⚙ Executing`
  - execute sequentially:
    1) addAll
    2) commit
    3) push
- If rejected:
  - state: `❌ Rejected` (or `🔵 Waiting approval` with reason)
  - no actions executed

### 2.4 Step-by-step approvals
If user clicks step actions:
- each click prompts local approval for that step
- steps can be disabled until prerequisites met:
  - Commit disabled until Add done (unless nothing to add)
  - Push disabled until Commit done OR push-only case

### 2.5 Push-only case
If repo has no uncommitted changes but `ahead>0`:
- Card changes planned steps:
  - `git push origin <branch>` only
- Primary button becomes:
  - `Approve & Push`

---

## 3. Safety Guarantees

- No shell execution; use spawn args.
- All R1/R2 actions require local approval.
- For WeCom-triggered tasks:
  - always require local approval (no remembered approvals for remote)
- Prohibit dangerous flags:
  - --force / --force-with-lease / reset --hard / clean -fd
- Commit message sanitized:
  - no newline
  - max length (80)
  - no quotes injection (use args array)

---

## 4. WeCom UX (Codex-like but concise)

### 4.1 Proposal-ready message
When action card is ready:
- send WeCom:
  - `Git Sync proposal ready (taskId=...)`
  - `branch: ...`
  - `changes: <diffStat first line>`
  - `waiting local approval on dev-machine-1`
  - optional: `Open VS Code CodexBridge Chat to approve`

### 4.2 Execution progress (optional throttled)
Send only major milestones:
- `Executing: add`
- `Executing: commit`
- `Executing: push`

### 4.3 Completion message
- `✅ Completed`
- `commit: <sha>`
- `push: success / rejected`
- `ahead/behind now: ...`

Never send full logs or full diff.

---

## 5. Protocol additions (UI actions)

Add UI actions:
- `git_sync_run_all`
- `git_sync_add`
- `git_sync_commit`
- `git_sync_push`

Payload:
```ts
{ type: "git_sync_action", threadId, taskId, action: "run_all"|"add"|"commit"|"push" }
Extension responses:

state updates

log attachments

final summary

6. Acceptance Criteria (UX)

Natural language “同步到 GitHub” produces a Git Sync Task Card.

Card shows branch, upstream, ahead/behind, diffStat, commit message.

Primary button Approve & Run All works:

shows a single confirmation dialog

runs add → commit → push sequentially

Step-by-step buttons work and respect prerequisites.

UI clearly indicates states with icons.

WeCom receives concise proposal + final result.

No destructive action runs without local approval.

---

## 你下一步该怎么喂给 Codex（建议指令）
你可以把下面这段作为“总任务”发给 Codex：

> 实现 `SPEC-GIT-UX.md`：把 Git Sync 做成 Task Card（类似 Codex UX），支持自动预检（status/diffStat）、生成 commit message、渲染 Action Card（Approve & Run All + step buttons）、执行状态流（Planning/Proposal ready/Waiting approval/Executing/Completed/Failed）、本地确认弹窗、顺序执行 add→commit→push，并把关键里程碑摘要回传到 WeCom。

---

## 小提醒（你会明显感觉“像 Codex”的关键）
1) **去掉固定 Run Test 按钮**，改成“动作卡片按钮”
2) **让状态机可视化**（Planning / Executing 等）
3) **一键执行**但必须“一次确认”

---

如果你把你当前 Webview 的前端文件结构（chat.html/chat.js 或 React 组件）贴一点出来，我还能把上面这套 Task Card 的 DOM/组件结构给你直接画出来（包括 CSS 风格建议），这样 Codex 写 UI 会更稳、更像官方。
::contentReference[oaicite:0]{index=0}
