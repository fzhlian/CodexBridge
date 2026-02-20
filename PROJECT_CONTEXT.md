# CodexBridge — Project Context

## 1. Project Vision

CodexBridge is a VS Code extension that enables:

Remote natural language control (e.g. WeCom)  
→ Relay server  
→ VS Code agent  
→ Codex reasoning  
→ Local execution (with strict approval gating)

Core principle:

> Remote intelligence proposes. Local machine executes.

---

## 2. Core Architecture

WeCom
  → Relay Server (WebSocket)
    → VSCode Agent (extension)
      → Codex app-server
        → Proposal
          → Approval Gate
            → Local execution (Git, patch, test, etc.)

Key rules:
- No cloud execution
- No shell:true
- All destructive actions require local approval
- Risk-based command classification (R0/R1/R2)

---

## 3. Execution Model

Task lifecycle:

RECEIVED
→ ROUTED
→ CONTEXT_COLLECTED
→ PROPOSING
→ PROPOSAL_READY
→ WAITING_APPROVAL
→ EXECUTING
→ COMPLETED / FAILED / REJECTED

UI shows per-task state (Codex-style Task Card).

No global conversation status.

---

## 4. UI Model (Codex-style)

Webview chat uses:

- Message bubbles (assistant/user)
- Task Card for task_* events:
    - Header (intent + shortTaskId)
    - Status chip (Planning / Proposal ready / Waiting approval / Executing / Completed / Failed)
    - Stream output
    - Proposal section
    - Action buttons (View / Apply / Run)
    - Logs (collapsible)

No fixed Run Test button.
Actions are generated from proposal.

---

## 5. Key Modules

VSCode Extension:
- TaskRouter
- ApprovalGate
- GitTool
- Codex client
- Relay client

Webview:
- chat.html
- chat.js
- styles.css

Relay:
- WebSocket bridge
- Machine binding
- No execution

---

## 6. Git Sync (Phase 1)

Natural language:
"同步到 GitHub"

Flow:
- Auto-run read-only git status/diff
- Propose commit message
- Render Task Card
- Require approval for:
    - git add
    - git commit
    - git push

No force push.
No destructive reset.

---

## 7. Security Model

Risk tiers:

R0 - Read only
R1 - Local write
R2 - Remote write

Rules:
- R0 may auto-run
- R1/R2 require local approval
- Remote-triggered tasks never auto-approve

---

## 8. Constraints

- Must work with Codex app-server
- Must preserve Local Authority
- Must be auditable
- Must be CI clean (pnpm, eslint, no unused vars)

---

## 9. Current Maturity

Architecture stable.
Task Card UI implemented.
Git Sync UX under refinement.
Approval gate functioning.

Next focus:
- Improve UX parity with Codex
- Context chip refinement
- Approve & Run All flow
- Performance optimization
