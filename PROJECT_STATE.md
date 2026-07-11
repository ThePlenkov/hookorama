# Project state — Hookorama

> **Groundhog-day anchor.** Read this file on every context reset,
> before re-deriving project context from conversation history.
> Owned by `governance`; updated by PRs that change topology or
> close an open question.

## Mission

- Hookorama is a local supervisor for LLM/CLI agents (Claude Code,
  Devin, Codex, …).
- Started as a rewrite-from-scratch of `vtsm`
  (`/workspace/rigs/c7dcf8ac-09c5-469b-8220-0ecac7372934/browse`),
  **not** a migration. vtsm is source-only — no beads land there.
- Web-app UI is taken from Lovable designs living in the
  `agent-panorama` rig
  (`/workspace/rigs/93096bb2-12e3-4df4-8a67-70654e143bd6/browse` —
  currently empty, design assets TBD from user). **Do not invent
  UI; wait for user to provide.**

## Town topology (4 rigs)

| rig id                                 | name                           | role                                         | touched? |
| -------------------------------------- | ------------------------------ | -------------------------------------------- | -------- |
| `75e301b7-9076-41f2-b6e9-ea7b6f66d856` | hookorama                      | **TARGET** — all product work lands here     | yes      |
| `c7dcf8ac-09c5-469b-8220-0ecac7372934` | vscode-terminal-status-manager | **SOURCE** — read-only, no beads             | no       |
| `93096bb2-12e3-4df4-8a67-70654e143bd6` | agent-panorama                 | **DESIGN** — Lovable assets, currently empty | no       |
| `330be7ad-05fb-4289-8a13-4b1e96b05239` | skills                         | skill library                                | no       |

## Operating model

- **act-with-handoff**: ship small PRs, merge early, fix regressions
  via a `gt:pr-fixup` bead (label `gt:pr-fixup`) into the original
  PR without re-review.
- **SDD + TDD**: ADRs (`docs/adr/`) come first; tests live next to
  source as `*.test.ts`; bun + vitest + tsdown + oxlint.
- **Governance is sacred**: every tracked `.md` needs a rule in
  `.agents/rules/` (CI `bun run check:md` enforces). Every PR cites
  at least one ADR. Public API via each package's `src/index.ts`
  barrel. No `any`. No `vscode` import outside `packages/extension`.

## Mayor behavior contract

- On every context reset: read `AGENTS.md`, then this
  `PROJECT_STATE.md`, then `.agents/RULES.md`. **Do not** re-derive
  project context from conversation history.
- **Architectural decisions** (new ADR, schema changes, package
  boundaries, public API surface, design-to-code mapping): staged
  convoy, user approves before dispatch.
- **Micro-tasks inside an approved PR**: dispatch without
  confirmation.
- **Single bead** (one PR, one file, one decision): `gt_sling`.
  **Multi-bead convoy**: `gt_sling_batch` with `depends_on` DAG.
  `parallel: true` ONLY when beads touch completely unrelated files
  with zero shared state.

## Open questions (blockers, not nice-to-have)

- **Q1**: Where do Lovable design assets physically live?
  `agent-panorama/repo/` is empty. Blocks Phase 5 web-app
  implementation. Until resolved, `packages/web-app` stays a
  placeholder.
- **Q2**: PR 1 (governance bootstrap) needs `SPEC.md` + `ROADMAP.md`
  - `CHANGELOG.md` to land. Beads queueing Phase 2/3 work before
    these exist are governance violations — delete them.

## Out-of-scope

- Migrating vtsm code into hookorama (rewrite, not migration).
- Touching the vtsm rig with beads.
- Modifying the agent-panorama rig until the user provides design
  assets.
- Inventing web-app UI without user-supplied Lovable assets.
