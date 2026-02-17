# Migration Plan: Memory Store to Redis Store (CodexBridge `vscode-agent`)

## 1. Goal and Success Criteria

Migrate state currently held in process memory to Redis so state survives process restarts, supports multi-instance behavior, and becomes operationally observable.

Success criteria:

- no behavioral regressions in existing tests plus new store-contract tests
- Redis-backed mode can serve production traffic within latency/error budgets
- rollback to memory mode can be completed in minutes via config only

## 2. Scope

In scope:

- state/cache behavior currently implemented in this package (for example context and patch cache flows)
- store abstraction and backend selection wiring
- migration telemetry, rollout flags, operational runbook, rollback

Out of scope:

- unrelated product features
- broad protocol redesign outside storage concerns

## 3. Current State Inventory

Inventory each memory-resident state location and classify it before coding. Initial focus files:

- `src/context.ts`
- `src/patch-cache.ts`
- `src/agent.ts`
- `src/handlers.ts`
- `src/extension.ts`

For each key/domain capture:

- owner component
- read/write call sites
- data schema
- consistency requirement: best-effort cache vs correctness-critical
- TTL/retention requirement
- max key cardinality estimate

Deliverable: a short table in this document (or linked artifact) with one row per key domain.

Current implementation note (2026-02-17): Redis migration work has been implemented in `packages/relay-server` for relay runtime state. Inventory snapshot:

| Domain | Owner | Read/Write Call Sites | Schema | Consistency | TTL / Retention | Cardinality Estimate |
| --- | --- | --- | --- | --- | --- | --- |
| Idempotency dedupe | relay callback ingress | read/write in `packages/relay-server/src/router.ts` via `stores.idempotency` | key=`msgId`, value=`"1"` | correctness-critical | `idempotencyTtlMs` default 24h | proportional to recent callback volume |
| Machine state | machine registry | read/write in `packages/relay-server/src/machine-registry.ts` via `stores.machineState` | `MachineStateRecord` | correctness-critical (routing and liveness) | `REDIS_MACHINE_TTL_MS` default `MACHINE_HEARTBEAT_TIMEOUT_MS * 2` (default 90s) | active machine count |
| Inflight commands | dispatch/result tracking | read/write in `packages/relay-server/src/router.ts` via `stores.inflight` | `InflightCommandRecord` | correctness-critical (cancel/retry/timeout) | `REDIS_INFLIGHT_TTL_MS` default `max(INFLIGHT_COMMAND_TIMEOUT_MS * 2, 30m)` | concurrent inflight command count |
| Audit index | audit query API | read/write in `packages/relay-server/src/audit-store.ts` via `stores.auditIndex` | `CommandRecord` + event list | observability-critical | `AUDIT_MAX_RECORDS` default 2000 entries | bounded by retention cap |
| Command retry template cache (in-memory) | retry endpoint | read/write in `packages/relay-server/src/router.ts` (`commandTemplates`) | `Map<commandId, CommandEnvelope>` | convenience cache | `COMMAND_TEMPLATE_TTL_MS` default 24h + `COMMAND_TEMPLATE_MAX` default 5000 | bounded by max cap |

## 4. Target Architecture

## 4.1 Store Interface

Introduce or finalize a storage interface consumed by business logic (not tied to memory/Redis types):

- `get(key)`
- `set(key, value, options)` including TTL
- `delete(key)`
- `mget/mset` for hot paths where needed
- atomic helper operations for correctness-critical flows (lock/cas/increment)

Business logic in `src/context.ts` and `src/patch-cache.ts` should depend only on this interface.

## 4.2 Backend Implementations

- `MemoryStore`: keeps current semantics for local/default/fallback use
- `RedisStore`: primary target backend

Redis requirements:

- connection reuse and bounded retries with jitter
- command timeouts and circuit-breaking behavior
- namespaced keys: `<app>:<env>:<domain>:<id>`
- payload envelope: `{ version, updatedAt, data }`

## 4.3 Configuration Surface

Add runtime-selectable flags/env values (names can be adjusted to project conventions):

- `STORE_BACKEND=memory|redis`
- `STORE_DUAL_WRITE=true|false`
- `STORE_READ_PREFERENCE=memory|redis`
- `STORE_FALLBACK_TO_MEMORY=true|false`
- `STORE_SHADOW_COMPARE=true|false`

These must be overridable without code changes.

## 5. Test and Validation Strategy

## 5.1 Contract Tests

Create backend-agnostic tests that run against both MemoryStore and RedisStore:

- set/get/delete semantics
- TTL expiration behavior
- serialization round-trip and schema version handling
- concurrent write behavior for critical operations

Prefer placing under `test/` in a shared suite.

## 5.2 Integration and Failure Injection

Add tests for:

- Redis unavailable at startup
- Redis timeout mid-request
- partial dual-write failure (memory success, Redis failure and inverse)
- Redis reconnect behavior

## 5.3 Performance Checks

Track:

- p50/p95/p99 store op latency
- per-request latency delta after enabling Redis
- Redis error/timeout rates

Define rollback thresholds before canary.

## 6. Phased Rollout Plan

## Phase 0: Discovery and Design

Tasks:

- complete state inventory and classification
- confirm key schema, TTL policy, and consistency model per domain
- define SLOs and rollback thresholds

Exit gate:

- design review approved by maintainer + ops reviewer

## Phase 1: Abstraction and Non-Functional Refactor

Tasks:

- isolate store usage behind interface
- keep memory backend as default behavior
- add contract tests for current semantics

Exit gate:

- all existing tests green
- no behavior change in memory mode

## Phase 2: Redis Backend Implementation

Tasks:

- implement RedisStore and serialization envelope
- wire config and backend selection
- add telemetry for backend, latency, and failures

Exit gate:

- RedisStore passes contract + failure injection tests

## Phase 3: Shadow Mode (Dual Write, Memory Read)

Tasks:

- write to both memory and Redis
- continue reading from memory
- asynchronously compare sampled values and emit mismatch metrics

Exit gate:

- mismatch rate below target for sustained window
- Redis error/latency under budget

## Phase 4: Redis Preferred Read + Memory Fallback

Tasks:

- read from Redis first
- fallback to memory on error/timeouts
- retain dual write

Exit gate:

- fallback rate low and stable
- no correctness incidents

## Phase 5: Redis Primary (Disable Memory Writes)

Tasks:

- disable memory writes for migrated domains
- keep emergency fallback flag available for limited window

Exit gate:

- stable production period (for example 7-14 days)

## Phase 6: Cleanup

Tasks:

- remove obsolete migration-only code paths
- keep minimal memory fallback only if intentionally retained
- finalize docs/runbooks

Exit gate:

- cleanup PR approved and runbooks updated

## 7. Risk Register and Mitigations

1. Redis outage or network partition causes request failures.
   Mitigation: fallback-to-memory flag, bounded retries, circuit breaker, fast rollback playbook.

2. Dual-write divergence creates inconsistent data.
   Mitigation: shadow comparison, idempotent writes, mismatch alerting, promotion gates.

3. Incorrect TTLs cause premature expiry or unbounded growth.
   Mitigation: per-domain TTL table, canary validation, key cardinality monitoring.

4. Race conditions after moving to distributed state.
   Mitigation: atomic Redis primitives or Lua for critical sections; avoid naive read-modify-write.

5. Latency regression due to remote store dependency.
   Mitigation: connection pooling, batching hot operations, local-region Redis, strict SLO alarms.

6. Redis memory pressure/eviction drops important keys.
   Mitigation: capacity planning with headroom, explicit eviction policy, domain separation.

7. Schema evolution breaks reader compatibility.
   Mitigation: versioned envelopes, backward-compatible deserializers, staged rollout.

8. Sensitive data exposure in keys/logs.
   Mitigation: key design without raw secrets, log redaction, TLS/auth/ACL enforcement.

9. Operational complexity slows incident response.
   Mitigation: rehearsed runbook, on-call drills, clear ownership and escalation path.

## 8. Rollback Plan

Rollback objective: restore stable behavior within minutes without redeploy.

## 8.1 Rollback Triggers

Trigger rollback if any condition is sustained beyond agreed window:

- Redis timeout/error rate above threshold
- p95/p99 request latency breach with user impact
- correctness signals fail (mismatch spikes, duplicate/invalid behavior)

## 8.2 Immediate Rollback Actions (Config-Only)

1. Set `STORE_READ_PREFERENCE=memory`.
2. Set `STORE_FALLBACK_TO_MEMORY=true`.
3. If Redis instability is severe, set `STORE_DUAL_WRITE=false`.
4. If necessary, set `STORE_BACKEND=memory`.
5. Verify recovery through latency/error dashboards and smoke tests.

## 8.3 Data Handling During Rollback

- do not flush Redis keys during incident response
- preserve Redis data for post-incident reconciliation
- record incident time window for replay checks

## 8.4 Forward Recovery After Rollback

1. fix root cause (infra, code, config, capacity)
2. run reconciliation checks for affected key domains
3. re-enter rollout at last stable phase (usually Phase 3 or 4)
4. require explicit go/no-go sign-off before promotion

## 9. Operational Readiness

Required before canary:

- dashboards: store latency, errors, fallback rate, mismatch rate, key cardinality
- alerts: threshold-based paging for timeout/error/fallback/mismatch
- runbook: outage handling, rollback switches, validation steps
- ownership: engineering DRI and on-call contact

## 10. Implementation Work Breakdown

1. Inventory and design artifacts
2. Store interface extraction
3. MemoryStore conformance updates
4. RedisStore implementation
5. Config/flag wiring in initialization paths (`src/main.ts`, `src/index.ts`, `src/extension.ts` as applicable)
6. Telemetry and structured logging
7. Contract + integration + failure tests
8. Shadow mode rollout
9. Redis-read rollout
10. Redis-primary rollout and cleanup

## 11. Timeline Template

Use this template with actual dates when execution begins:

- Week 1: inventory + interface refactor + contract tests
- Week 2: RedisStore + config + telemetry
- Week 3: shadow mode in staging + failure drills
- Week 4: production canary + Redis-read promotion
- Week 5: Redis-primary + cleanup start

## 12. Go/No-Go Checklist

- [ ] key inventory and TTL table approved
- [x] contract tests pass for memory and Redis (see `packages/relay-server/test/store-factory.test.ts`)
- [x] failure injection tests pass (runtime Redis failure fallback in `packages/relay-server/test/store-factory.test.ts`)
- [ ] dashboards and alerts live
- [ ] rollback runbook tested in staging
- [ ] canary completed without threshold breaches
- [ ] incident comms and ownership confirmed
