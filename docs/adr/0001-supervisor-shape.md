---
id: 0001
title: Supervisor shape — identity, lifecycle, single writer
type: component
status: proposed
created: 2026-07-10
supersedes: []
principles: [P-2, P-5]
jobs: [H-1, H-2, H-4]
---

# ADR 0001 — Supervisor shape

## Context

Hookorama is a local supervisor for LLM and CLI agents. The
supervisor is the only stateful component of the system: it
accepts hook events from agents, keeps a live picture of what is
running right now, and persists an append‑only history of every
event it has ever seen (per `docs/NORTH-STAR.md`). Every other
surface (the VS Code extension, the CLI, the web dashboard, the
MCP server) is a peer consumer of that state.

This ADR pins the supervisor's shape: its identity model, its
in‑memory state schema, its lifecycle, and the single‑writer
contract that the rest of the system depends on. v1's predecessor
shipped a two‑tier design (per‑window + global supervisors) that
failed in five concrete ways (documented in `docs/adr/0002-v1-postmortem.md`).

> **Scope of this PR.** PR 2 ships the supervisor _skeleton_:
> identity resolution, in-memory state, the PID-file slot, the
> process-discovery walkers, the public `Supervisor` class, and
> the test surface that exercises them. The NDJSON/HTTP wire
> servers, signal handling, idempotent auto-start, platform
> service-install, and the Drizzle history layer ship in later
> PRs (ADRs 0003, 0004). Where this document describes behaviour
> that has not shipped yet, the Lifecycle and Single‑writer
> sections call out the gap explicitly.

## Decision

### Identity model (P‑2: pid > cwd; session_id is never a key)

A process is identified, in order of preference:

1. **OS PID** — the supervisor receives a `pidChain` (own pid
   first, ancestors after, FR‑D.6 of the predecessor) and walks
   the open terminal table (`vscode.Terminal.processId` shipped
   by the extension over the wire) for an exact match.
2. **`cwd`** — only when no pid in `pidChain` resolves to a
   known open terminal. Multiple terminals sharing a `cwd` are
   collapsed into one row, marked with a visible "ambiguous" badge
   in the UI.

`session_id` is never used as a key. It is always carried as
enrichment only. A session id changes across `/clear` and
`/new` even within the same terminal (v1 FR‑D.6 documented
this as a learned lesson), and two agents sharing a session id
is rare but possible.

Rationale: see `.agents/memory/facts/pid-chain-beats-session-id.md`.

### State schema

The supervisor holds two kinds of state:

- **Live state** (in memory) — a `Map<ProcessKey, ProcessEntry>`
  where `ProcessKey` is one of:
  - `pid:<n>` — a terminal matched by PID in the open-terminal
    table;
  - `cwd:<normalized-path>` — a process resolved by cwd
    fallback (canonicalised so `C:\foo` and `C:/foo` collide);
  - `<parentKey>:subagent:<toolUseId>` (or `<parentKey>:subagent:<iso-ts>`
    when no `toolUseId` is available) — a virtual subagent
    child. When two such keys collide on the same parent, the
    store remints the second with a `#<counter>` suffix so every
    reminted child remains independently closeable.

  `ProcessEntry` carries `{ status, at, cwd, sessionId?, agent?,
pid?, pidChain?, parentKey?, terminalName? }`. `parentKey` is
  set only for virtual subagent nodes (see below). Status rows
  are populated exclusively by incoming hook events — process
  discovery does not contribute live status. On every
  supervisor startup a fresh discovery snapshot from `/proc`
  (Linux), `ps` (macOS), or `wmic` (Windows) is retained in a
  side `Map<pid, ProcessRow>` so a future cwd-only fallback
  (when the extension is unavailable) can resolve a pid chain
  to a command name.

- **History** (SQLite, append‑only) — opened in‑process by the
  supervisor. Schema, retention policy, and migrations land in
  ADR 0003 (Phase 2). PR 2 ships the supervisor shape; PR 3
  ships the history layer.

### Lifecycle (P‑5: long‑running local service)

PR 2 ships the lifecycle _skeleton_: the `Supervisor` class,
the PID-file slot acquisition/release with stale-PID reclaim,
and the public `start()` / `stop()` methods. Behaviour listed
below that is not yet exercised by CI is **deferred to a later
PR** (the specific PR is recorded in `ROADMAP.md`):

- **One supervisor per machine** — installed as a user‑mode
  local service via `hookorama install-service` (PR 3 or later):
  - macOS: `~/Library/LaunchAgents/dev.hookorama.supervisor.plist`
    via `launchctl bootstrap gui/$UID`.
  - Linux: `~/.config/systemd/user/hookorama-supervisor.service`
    via `systemctl --user enable --now hookorama-supervisor`.
  - Windows: per‑user scheduled task via `schtasks /create` with
    trigger "at logon".
- **Idempotent auto‑start** (PR 3) — on every client
  connection attempt, the surface checks the PID file. If it
  exists, it dials the socket. If not, it spawns the supervisor
  and waits up to 5 seconds for the socket to appear.
- **Signals** (PR 3) — `SIGTERM` → graceful shutdown → `SIGKILL`
  after 10 seconds. `SIGHUP` reloads config.
- **PID file** (PR 2) — `pidFilePath()` selects the
  platform-appropriate path: `os.tmpdir()/hookorama-supervisor.pid`
  on Linux, `~/Library/Application Support/dev.hookorama/supervisor.pid`
  on macOS, and `%LOCALAPPDATA%\hookorama\supervisor.pid` on
  Windows. A second supervisor noticing this file at startup
  exits cleanly and lets the first one keep serving. Stale PID
  files (dead owner) are reclaimed on next start.

### Single‑writer contract

- The supervisor is the **only writer of both live state and
  history**. Surfaces read by querying (live state via the
  NDJSON socket in PR 3; history via the supervisor's read‑only
  HTTP endpoint that fronts SQLite in PR 3).
- Every hook event is **written to history before it is
  acknowledged** to the client (PR 3). The wire frame is
  `{ kind: 'ack', id: <client-request-id> }` and is only sent
  after the SQLite write commits.
- Surfaces never write to live state directly. A surface that
  needs a write calls into the supervisor over the wire; the
  supervisor mutates its own state and broadcasts the diff.

### Subagent handling (virtual parent key)

When a `start_subagent` hook arrives, the supervisor creates a
virtual child entry on top of the parent's `Map<ProcessKey,
ProcessEntry>` with `parentKey = <parent-key>`. The child shares
the parent's pid (subagents run in the parent's own process);
`parentKey` plus the per-parent remint suffix (see _State
schema_ above) is what keeps them distinguishable in the tree
and closeable individually. `end_subagent` closes the matching
child by `toolUseId` (if supplied) without touching the parent's
own status; the supervisor keeps a `parentKey × toolUseId →
actualKey[]` index so three or more subagents sharing the same
`toolUseId` are each independently closeable.

## Consequences

### Positive

- One machine → one picture. Surfaces never see conflicting
  states from competing supervisors (F1 of the v1 postmortem is
  solved by construction).
- Identity by `pidChain` removes the "two terminals in the same
  directory merge into one row" bug (v1 FR‑D.6 / FR‑U.11).
- Append‑only history is durable across supervisor restarts.
  "Yesterday at 3pm" is answerable the moment the history layer
  ships in PR 3.
- Service install (deferred) gives the supervisor a stable
  lifecycle that does not depend on any IDE window being open.

### Negative

- Service installation is a real maintenance burden across three
  platforms; CI must lint the install artifacts in addition to
  building them. Deferred until a follow-up PR; until then the
  PID-file slot is the only enforcement of "one supervisor per
  machine", which is sufficient for CI and the developer
  workflow but not for unattended installs.
- The 5‑second auto‑start budget (deferred) means the first
  hook of a fresh login takes ~5s longer than v1. Acceptable:
  this happens once per login.
- We commit to a pid‑first model that is harder to debug than
  cwd‑only. The "ambiguous" badge in the UI is the only user
  visible mitigation.

### Reversibility

`hard`. Switching to a different identity model would invalidate
every surface that matches `pid:<n>`. The supervisor's other
aspects (lifecycle, single‑writer) are individually easy to
change.

## Alternatives considered

- **Two‑tier (per‑window + global) supervisor.** This is v1's
  design. Rejected: see `docs/adr/0002-v1-postmortem.md` for
  the five failures. Specifically, F1 ("window A's status bar
  cannot see window B's agents") is fatal.
- **`cwd`‑only identity.** Simpler; matches v1's first
  implementation. Rejected by P‑2 — two terminals in the same
  directory would be collapsed into one row (the actual bug v1
  FR‑D.6 documented).
- **In‑memory only, no history.** Rejected by P‑8 ("the history
  is the product, not a cache"). History ships in PR 3; this PR
  pins the contract, not the implementation.
- **Tied to the VS Code extension's lifecycle.** Rejected by
  P‑5 — the supervisor must outlive any single IDE window.

## Open questions

- Whether `session_id` is ever surfaced in the UI at all (vs.
  dropped at ingest). Tracked for the Analytics ADR.
- Whether `pidChain[0]` (the agent's own pid) is enough to
  identify subagents, or whether the supervisor must learn
  Claude/Devin's `agent_id` enrichment field. Tracked for the
  wire‑protocol ADR.

## Traceability

- **Mission:** `docs/NORTH-STAR.md` §"What 'service' means here";
  §"Vocabulary" (`Supervisor`).
- **Principles:** `P-2` (process identity beats session identity
  beats cwd identity); `P-5` (one supervisor, many surfaces).
- **Jobs:** `H-1` (panorama), `H-2` (map), `H-4` (replay — gated
  on the history ADR that follows this one).
- **SPEC.md row:** `Supervisor`.
- **ROADMAP.md phase:** Phase 1 — Supervisor.
- **Files this decision creates / owns:**
  `packages/supervisor/src/supervisor.ts` (the public Supervisor
  class), `packages/supervisor/src/index.ts` (the package
  barrel), `packages/supervisor/src/process-discovery/`
  (per-platform process walkers),
  `packages/supervisor/src/state/` (the live state map and
  subagent handling), `packages/supervisor/src/lifecycle/`
  (PID file + cross-platform `isProcessRunning`).
