# CodexBridge - Architecture

## Architectural Vision
CodexBridge is a secure remote AI development bridge that enables developers to orchestrate AI-assisted coding workflows from mobile chat while preserving strict local execution control.

Core philosophy:

> Remote intelligence. Local authority.

## High-Level Architecture
WeCom User
  -> Relay Server (Cloud)
  -> WSS
  -> VSCode Agent (Local Machine)
  -> Webview Chat (CodexBridge Chat)
  -> stdio JSONL
  -> Codex app-server

Local interaction flow:
Developer
  -> CodexBridge Chat Webview
  -> Extension Host (thread state, protocol, gating)
  -> Codex app-server / local actions (diff view, apply, test)

## Key ADR Summary
- ADR-001: Local execution authority.
- ADR-002: Integrate with codex app-server, not third-party extension UI.
- ADR-003: Persistent codex process.
- ADR-004: Outbound WebSocket for agents.
- ADR-005: Minimal context transmission.
- ADR-006: Chat UI is first-party webview; no third-party extension UI injection.
- ADR-007: Destructive operations (`apply`, `test`) always require local modal confirmation.
