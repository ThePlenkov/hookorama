# `@hookorama/supervisor`

The Hookorama supervisor: one process per machine, installed as a
user-mode local service. Owns the live in-memory state and (in a
later PR) the append-only SQLite history. The only writer in the
system.

PR 2 ships the supervisor _skeleton_: the public `Supervisor`
class, identity resolution, the live state store with virtual
subagent nesting, cross-platform process discovery, and the
PID-file slot lifecycle with stale-PID reclaim. The wire
protocol (NDJSON socket + HTTP) and the Drizzle persistence
layer ship in later PRs; both will be pinned by future ADRs in
Phase 2 (see `ROADMAP.md`).

## Public API

```ts
import { Supervisor } from '@hookorama/supervisor';
```

The full public surface is re-exported from
[`packages/supervisor/src/index.ts`](./src/index.ts).

## Pinned by

- ADR(s): [`docs/adr/0001-supervisor-shape.md`](../../docs/adr/0001-supervisor-shape.md),
  [`docs/adr/0002-v1-postmortem.md`](../../docs/adr/0002-v1-postmortem.md)
- Rules: `.agents/rules/package-readme.md.rule`
- Skills: none
- Memory: `.agents/memory/facts/pid-chain-beats-session-id.md`
