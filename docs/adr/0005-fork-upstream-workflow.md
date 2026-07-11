---
id: 0005
title: Fork-upstream single-branch workflow
type: governance
status: accepted
created: 2026-07-11
supersedes: []
principles: [P-3]
jobs: []
---

# ADR 0005 — Fork-upstream single-branch workflow

## Context

The user maintains `ThePlenkov/hookorama` as a personal fork of
`hookorama/hookorama` and reviews all contribution work through
that fork. Polecats in this rig draft feature branches in the
fork, push the **same branch** (identical SHA, no cherry-pick,
no rebase, no squash) to upstream, and open the upstream PR
there. CI and review bots run on the fork PR; final review and
merge happen on the upstream PR.

This model is non-standard. v1 polecat sessions repeatedly fell
into the same trap: they `git merge feat/*` into fork `main`,
producing a fork PR with a SHA that did not exist upstream, so
the upstream-side fast-forward sync from `upstream/main` could
not close it and the work had to be redone. The workflow
previously lived only in the Mayor's chat context, which
resets across container restarts and polecat dispatches. It
must persist in the rig.

See `.agents/memory/retros/toast-act-pr2-2026-07-10.md` for the
incident pattern and
`.agents/memory/lessons/fork-upstream-auto-merge-on-sync.md`
for the auto-merge mechanics.

## Decision

### Fork `main` is a read-only mirror of upstream `main`

Fork `main` advances **only** by `git merge upstream/main`. The
flag is `--no-ff` when a merge commit is required for
provenance, or the default fast-forward when clean. No
feature branch is ever merged into fork `main` directly. No
rebase lands on `main`. No squash of a feature branch lands on
fork `main`.

### Feature branches live in the fork first

A polecat opens a worktree in the fork, commits fix-ups to a
`feat/*` branch, pushes to `origin` (the fork), and opens the
fork PR. CI and review bots (Codacy, DeepSource, cubic,
CodeRabbit, CodeFactor) run there. The polecat replies to
inline threads on the fork PR and resolves them via
`resolveReviewThread`.

### Promotion to upstream

When the fork PR is green and the bead's `gt_done` lands:

1. The polecat pushes the **same branch** to `upstream` so the
   branch head in upstream is byte-identical (same SHA) to the
   branch head in fork.
2. No commit, no cherry-pick, no squash, no rebase occurs
   between the two pushes. The same commits exist in both
   repositories at the same SHAs.
3. The upstream PR is opened from that branch and targets
   upstream `main`. The upstream PR is what the refinery
   merges.

### Never force-push a public feature branch

Force-pushing a `feat/*` branch that has been pushed to
upstream rewrites SHAs in upstream and breaks the
auto-merge-on-sync trick described in the lesson. If a
force-push is genuinely required (e.g. to drop a committed
secret), the polecat opens a new branch and restarts from
scratch; never rewrite a published SHA.

### Auto-merge on `main` sync

Because the fork feature branch and the upstream feature
branch are the same bytes (same SHAs), a routine
`git merge upstream/main` into fork `main` causes GitHub to
auto-mark the fork PR as merged. The polecat does **not** run
`gh pr close` on the fork PR manually — it will flip to
MERGED on its own once fork `main` advances. If the fork PR
does not auto-close, the SHAs diverged and the lesson's
"Applies when" checklist applies.

## Consequences

### Positive

- The fork-upstream model is captured in a single place and
  survives container restarts and polecat dispatches.
- One canonical rule for "where do feature branches live"
  removes the v1 trap of polecats merging `feat/*` into fork
  `main`.
- The auto-merge-on-sync trick is documented as an explicit
  invariant rather than a happy accident; polecats do not
  close fork PRs manually.
- The same-branch-same-SHA rule is enforced by ADRs +
  lessons, so the rule cannot drift away from the mechanics.

### Negative

- Polecats must remember to push the branch to both remotes
  with identical SHAs. CI does not currently verify this; a
  drift would be caught only when the fork PR fails to
  auto-close (see the lesson's "Applies when").
- The fork `main` reads-only-mirror rule means fixes cannot
  land on fork `main` via the standard PR flow; everything
  routes through the same feature branch. This is by design
  but adds one push step per bead.
- Two remotes (`origin` = fork, `upstream` = upstream) adds
  ceremony. The cost is paid once per bead; the protection it
  buys is permanent.

### Reversibility

`easy`. The fork-upstream model is a process choice, not a
code-shaped choice. Reverting it means changing how polecats
open PRs and updating this ADR plus the lesson; no package,
no wire frame, no state machine depends on it.

## Alternatives considered

- **Single-repo workflow: everything lives in
  `hookorama/hookorama`.** Rejected — the user owns
  `ThePlenkov/hookorama` and reviews there; the rig must work
  with that fork as the drafting surface.
- **Squash-merge fork PR, then cherry-pick to upstream.** Rejected
  — the SHAs differ, the auto-merge trick breaks, and two PRs
  carry the same content forever.
- **Allow `git merge feat/*` into fork `main` and reconcile
  manually.** Rejected — the v1 incident pattern (see
  retro `toast-act-pr2-2026-07-10.md`) is exactly this; we
  know it loses work.
- **Force-push allowed on feature branches.** Rejected —
  rewrites SHAs in both remotes, breaks the auto-merge trick,
  and silently invalidates any already-merged upstream PR.

## Open questions

- Should the rig provide a `gt sync-fork-main` script that
  performs `git fetch upstream && git merge upstream/main
--no-ff` with safety checks (clean tree, no unmerged paths)?
  Deferred — the bead's manual workflow is correct and
  scriptable later without changing this ADR.
- What happens when upstream `main` advances while a fork
  feature branch is being reviewed? The branch tip in fork
  must be re-pushed to upstream so the SHAs stay in lockstep.
  Deferred — the lesson covers the failure mode if this is
  skipped.

## Traceability

- **Mission:** the user operates the rig through a personal
  fork; the rig must remain compatible with that workflow.
- **Principles:** `P-3` (workflow survives context loss —
  governance is the only durable storage).
- **Jobs:** none yet (`SPEC.md` is later).
- **SPEC.md row:** none (governance ADR; not a component).
- **ROADMAP.md phase:** none (governance ADR; not a phase).
- **Files this decision creates / owns:**
  `docs/adr/0005-fork-upstream-workflow.md` (this ADR),
  `.agents/memory/lessons/fork-upstream-auto-merge-on-sync.md`
  (the mechanics lesson), `AGENTS.md` (the checklist that
  polecats read on every bead).
