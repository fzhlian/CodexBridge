# CodexBridge Project Context

## Goal
Remote NL → VSCode → Codex → local execution (Local Authority)

## Architecture
- WeCom → Relay Server → VSCode Agent → Codex
- Task state machine
- Proposal + Approval gate

## UI
- Codex-style Task Card
- task_start/task_state/task_proposal/task_end events
- No global conversation status

## Key Modules
- chat.html
- chat.js
- styles.css
- GitTool
- TaskRouter
- ApprovalGate

## Constraints
- Local-only execution
- No shell:true
- Risk-based gating

## Current milestone
- Codex-style Task Card UI implemented
- Working on Git Sync UX
