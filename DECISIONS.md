# CodexBridge — Architecture Decision Records (ADR)

This document records significant architectural decisions made in CodexBridge.

The purpose is:

- to document rationale
- to prevent regression
- to reduce repeated debate
- to preserve architectural integrity over time

Each decision includes:

- Context
- Decision
- Rationale
- Consequences

---

# ADR-001 — Local Execution Authority

## Status
Accepted

## Context

Remote AI systems inherently increase risk exposure:

- cloud compromise
- credential leakage
- replay attacks
- malicious command injection

Allowing remote systems to directly execute code on developer machines significantly amplifies breach impact.

## Decision

All destructive operations must require explicit local confirmation.

This includes:

- file modification
- patch application
- shell execution
- test execution

Remote systems may propose — never execute.

## Rationale

If the relay server is compromised:

→ attackers must still bypass local confirmation.

This dramatically reduces the blast radius of a cloud breach.

## Consequences

- Slightly slower automation
- Stronger security guarantees
- Developer remains in control
- Reduced catastrophic risk

This decision is non-negotiable.

---

# ADR-002 — Do Not Control Third-Party VSCode Plugin UI

## Status
Accepted

## Context

One design path involved programmatically controlling the Codex VSCode extension UI.

This approach introduces:

- undocumented API dependencies
- version fragility
- UI coupling
- high maintenance overhead

## Decision

CodexBridge integrates directly with Codex app-server, not the VSCode plugin UI.

## Rationale

Engine-layer integration is:

- more stable
- version-independent
- testable
- portable

UI automation is fragile and unacceptable for core infrastructure.

## Consequences

- Slightly more integration work
- Long-term stability
- Vendor flexibility

---

# ADR-003 — Persistent Codex Process

## Status
Accepted

## Context

Two options:

1. Spawn a new Codex process per request
2. Maintain a long-lived app-server process

## Decision

Use persistent `codex app-server` process.

## Rationale

- Lower latency
- Streaming support
- Reduced overhead
- Improved reliability

Cold-start costs are unacceptable for interactive developer workflows.

## Consequences

- Need crash recovery handling
- Need lifecycle management
- Improved performance

---

# ADR-004 — WebSocket Agent Model

## Status
Accepted

## Context

Agent could either:

- expose local HTTP endpoint
- use polling
- maintain outbound WebSocket connection

## Decision

Agent maintains outbound WSS connection to relay.

## Rationale

- No inbound firewall configuration required
- NAT-friendly
- Real-time delivery
- Simplified deployment

Inbound ports on developer machines are unacceptable from a security standpoint.

## Consequences

- Need heartbeat mechanism
- Need reconnection logic
- Improved reliability and security

---

# ADR-005 — Minimal Context Transmission

## Status
Accepted

## Context

Large context improves AI output quality but increases:

- token cost
- data exposure risk
- intellectual property leakage

## Decision

Only transmit:

- active file
- selected text
- explicitly requested files
- bounded directory summaries

Never automatically transmit full repositories.

## Rationale

Security and cost control outweigh marginal AI quality gains.

## Consequences

- Slightly reduced AI completeness
- Stronger confidentiality guarantees

---

# ADR-006 — AI Output Is Treated as Untrusted Input

## Status
Accepted

## Context

Large language models may:

- hallucinate
- produce unsafe shell commands
- be manipulated via prompt injection

## Decision

AI output must never directly execute without validation and confirmation.

All patches must be validated before application.

## Rationale

Trusting AI output directly creates high-severity failure modes.

AI is advisory, not authoritative.

## Consequences

- Additional validation logic required
- Reduced automation risk

---

# ADR-007 — Chat Adapter Abstraction Layer

## Status
Accepted

## Context

Initial implementation uses WeCom.

Future platforms may include:

- Slack
- Telegram
- Discord
- Feishu

Hardcoding platform logic would create tight coupling.

## Decision

Relay implements a ChatAdapter interface.

Platform-specific logic is isolated.

## Rationale

Future extensibility without core refactor.

## Consequences

- Slightly more abstraction upfront
- Long-term portability

---

# ADR-008 — Default Deny Permission Model

## Status
Accepted

## Context

Systems often evolve toward permissive defaults.

This increases accidental risk.

## Decision

Default configuration denies:

- apply
- test
- terminal access

Permissions must be explicitly granted.

## Rationale

Principle of least privilege.

Safer onboarding posture.

## Consequences

- Additional setup friction
- Significantly reduced accidental misuse

---

# ADR-009 — No Autonomous Background Refactoring

## Status
Accepted

## Context

Future temptation: continuous AI-driven background code improvement.

This introduces:

- silent code drift
- unpredictable diffs
- debugging difficulty

## Decision

CodexBridge will not implement autonomous background refactoring.

All AI operations must be explicitly triggered.

## Rationale

Predictability and developer awareness outweigh automation gains.

## Consequences

- Slower theoretical improvement
- Stronger repository stability

---

# ADR-010 — Stateless Relay by Default

## Status
Accepted

## Context

Stateful servers increase operational complexity.

Horizontal scaling becomes harder.

## Decision

Relay remains stateless except for:

- ephemeral machine registry
- optional Redis-backed dedupe and rate limit

## Rationale

Stateless services scale better and recover faster.

## Consequences

- Requires external store for advanced features
- Improved deployment flexibility

---

# ADR-011 — Atomic Patch Application

## Status
Accepted

## Context

Partial file writes can corrupt repositories.

## Decision

All patch applications must be atomic.

Write to temp file, validate, then swap.

## Rationale

Repository integrity is paramount.

## Consequences

- Slight implementation complexity
- High reliability guarantee

---

# ADR-012 — Observability Is Required

## Status
Accepted

## Context

Distributed systems fail in unexpected ways.

Without structured logging, debugging becomes guesswork.

## Decision

Emit structured logs for:

- commandId
- machineId
- latency
- result
- errors

## Rationale

Debuggability is reliability.

## Consequences

- Additional logging overhead
- Improved operational clarity

---

# Decision Philosophy

If a proposed feature conflicts with:

- Local Authority
- Security as Architecture
- Human-in-the-loop

It must be rejected.

CodexBridge prioritizes integrity over convenience.
