# Changelog

All notable changes to this project are documented in this file.
The format follows [keep-a-changelog](https://keepachangelog.com/).

## [0.2.0] — 2026-07-10

PR: https://github.com/hookorama/hookorama/pull/2

Compare: https://github.com/hookorama/hookorama/compare/v0.1.0...HEAD

ADR: [`docs/adr/0001-supervisor-shape.md`](./docs/adr/0001-supervisor-shape.md),
[`docs/adr/0002-v1-postmortem.md`](./docs/adr/0002-v1-postmortem.md)

### Added

- Component: **Supervisor** (one row in `SPEC.md`).
- ADR: `0001-supervisor-shape` — identity model (`pidChain` → cwd
  fallback → `session_id` enrichment), in-memory state schema,
  lifecycle (one supervisor per machine, user-mode local service),
  single-writer contract. Replaces v1's two-tier design.
- ADR: `0002-v1-postmortem` — failure-mode record for the v1
  per-window + global supervisor design and the rationale for
  rejecting it.
- Supervisor package: `Supervisor` class in
  `packages/supervisor/src/supervisor.ts`, exported from the
  package barrel `packages/supervisor/src/index.ts`. The
  supervisor wires identity resolution, the live state store,
  process discovery, and the PID-file slot lifecycle.
- PID-file slot acquisition with stale-PID reclaim
  (`packages/supervisor/src/lifecycle/pid-file.ts`).
- Cross-platform `isProcessRunning(pid)` probe
  (`packages/supervisor/src/lifecycle/pid.ts`).
- Process discovery walkers for Linux (`/proc`), macOS (`ps`),
  and Windows (`wmic`) in `packages/supervisor/src/process-discovery/index.ts`.
- State store with virtual subagent nesting
  (`packages/supervisor/src/state/store.ts`).
- Identity resolution with cwd canonicalisation
  (`packages/supervisor/src/identity/resolve.ts`).
- Memory fact: `.agents/memory/facts/pid-chain-beats-session-id.md`.
- Repository docs: `SPEC.md`, `ROADMAP.md`, `CHANGELOG.md` (this file).
- CI / governance: `.oxlintrc.json` relaxations for modern TS patterns,
  `scripts/check-files.ts` allowlist for `packages/<name>/src/**`,
  `tsconfig.base.json` enables `rewriteRelativeImportExtensions`.

### Changed

- `packages/supervisor/src/index.ts` is no longer a placeholder; it
  re-exports the real public API from `./supervisor.js`.

### Deferred (to PR 3 — wire protocol + persistence)

- NDJSON Unix-socket / named-pipe daemon entry, HTTP/WS on
  127.0.0.1, SIGTERM/SIGKILL shutdown, idempotent auto-start on
  first client connection (ADR 0004 will pin the wire protocol).
- Drizzle + better-sqlite3 history layer (ADR 0003 will pin the
  persistence choice).
- Platform service install (`launchd` / `systemd` / `schtasks`).
- Wire-protocol-observable surface for `seedFromProcessDiscovery`
  (rows are now retained in a side table; PR 3 surfaces them).

## [0.1.0] — 2026-07-10

PR: https://github.com/hookorama/hookorama/pull/1

### Added

- Initial bootstrap: bun workspaces + tsdown workspace build,
  TypeScript strict (TS 7, ES2024, Node 24), oxlint, prettier,
  vitest.
- Agent contract at `AGENTS.md` (read-first order, the `.md` rule,
  role-boundary, invariants).
- 20 `.agents/rules/*.md.rule` files + `.agents/RULES.md` index
  enforcing "no random `.md` files".
- Two repo-local skills: `navigating-project-docs`,
  `maintaining-agents-dir`.
- Memory layer (markdown-only, no DB): `facts/`, `retros/`,
  `lessons/`, with frontmatter and `index.tsv` reindex.
- Three repo-root scripts: `check-md`, `check-files`,
  `reindex-memory`.
- CI workflow at `.github/workflows/ci.yml`.
- Five empty package skeletons: `@hookorama/client`,
  `@hookorama/supervisor`, `hookorama` (CLI),
  `@hookorama/extension`, `@hookorama/web-app`.
