# CodexBridge - Security Model

## Security Philosophy
Assume every external system is compromised.

## Critical Rule
Local machine is the root of trust.
Nothing executes without local approval.

## Top Threats and Defenses
- Remote command injection: confirmation required, default deny terminal.
- Prompt injection: never execute model output directly.
- Replay attacks: message id dedupe with TTL.
- Unauthorized device control: machine binding.
- Data exfiltration: minimal context strategy.

## Production Hardening Baseline
- WSS only
- secrets in environment or secret manager
- rate limiting
- audit logs
- allowlist and machine binding

