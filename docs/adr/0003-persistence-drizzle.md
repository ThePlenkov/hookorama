---
id: 0003
title: Persistence via Drizzle ORM + better-sqlite3
type: component
status: proposed
created: 2026-07-11
supersedes: []
principles: []
jobs: []
---

# ADR 0003 — Persistence via Drizzle + better-sqlite3

## Context

ADR 0001 pins the supervisor as the **single writer** of live
state and history. Hook events must persist before the client is
acknowledged; the history is durable across restarts and
answerable to "yesterday at 3pm". Surfaces read through the
supervisor, never the database.

## Decision

**Drizzle ORM on better-sqlite3** for the append-only history.
Schema-as-code at
`packages/supervisor/src/persistence/schema.ts`; SQL migrations
committed under `packages/supervisor/migrations/`. Default
retention 30 days; `HOOKORAMA_RETENTION_DAYS` overrides (`0`
disables GC). Postgres swap is one import.

Tables: `agents(id, name, version, first_seen_at)`;
`sessions(id, pid_chain, cwd, agent_id, started_at, ended_at)`;
`events(id, session_id, ts, type, payload_json, agent_kind)`.
Indexes `events(session_id, ts)`, `events(ts)`,
`sessions(agent_id, started_at)`. `payload_json` opaque.

## Consequences

### Positive

TS-first schema, no codegen, plain-SQL migrations reviewed in PR;
driver swap is one import.

### Negative

Drizzle API to learn; better-sqlite3 file-level write lock
(serialized by ADR 0001 already).

### Reversibility

`medium`. SQL survives any ORM swap; query API does not.

## Alternatives considered

**Prisma** — codegen duplicates TS-first. **Kysely** — too thin.
**Raw better-sqlite3** — no migration tooling.

## Open questions

Per-session retention vs. global. Compression of old
`payload_json`.

## Traceability

**ADR cited:** ADR 0001. **Principles:** P-5. **Jobs:** H-4.
**Files:** `packages/supervisor/src/persistence/schema.ts`,
`packages/supervisor/migrations/`,
`packages/supervisor/src/persistence/retention.ts`.
