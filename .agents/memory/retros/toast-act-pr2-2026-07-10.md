---
id: toast-act-pr2-2026-07-10
type: retro
tags: [gt:act, hookorama, pr-2, deepsource, codacy, retro]
created: 2026-07-10
summary: /act on PR #2 caught 8 convergent bugs and ~100 review threads; DeepSource absence from `gh pr checks` ≠ pass — read `statusCheckRollup` for the conclusion.
---

# /act retro on hookorama PR #2 — 2026-07-10

## Trigger

Bead dispatched to address failing CI on `hookorama/hookorama` PR #2
(`feat/supervisor-shape`). `gh pr checks` at the time showed
Codacy as `fail` and DeepSource as `fail`; cubic, CodeRabbit, and
CodeFactor had also posted dozens of inline review threads.

## What went wrong

1. **DeepSource was reported as "effectively green" via absence from
   `gh pr checks`.** DeepSource reports via a StatusContext (not a
   CheckRun), so it does not appear in the commit `check-runs`
   endpoint — but it **does** appear in the PR's `statusCheckRollup`.
   Concluding success from absence in `gh pr checks` is incorrect;
   future automation reading this retro should check
   `statusCheckRollup` for a `SUCCESS` conclusion on the
   `DeepSource: JavaScript` context before recording green.
2. **First /act pass treated CodeRabbit "actionable comments posted: N"
   as if N inline threads existed.** Some entries were auto-managed
   pauses, not open threads; resolving required walking the actual
   review thread id list, not the AI summary count.
3. **The retro written at the end of the pass was an activity log,
   not a retro.** It lacked the required `## Trigger`,
   `## What went wrong`, `## What we change` headings and the
   `summary` exceeded the 200-char limit set by
   `.agents/memory/README.md`. cubic correctly flagged this on the
   subsequent re-review.
4. **One supervisor.test.ts path (`closeSubagentOf` fallback in
   `endSubagent`) had no test.** A cubic review noted that
   `supervisor.ts:137` calls into `closeSubagentOf` whenever
   `closeSubagentByKey` returns false (e.g. wrong `toolUseId`), and
   the test for that path had been dropped earlier.

## What we change

1. **Memory entries: future /act retros MUST be written to the
   contract in `.agents/memory/README.md` from the first edit.**
   Required body headings (`## Trigger`, `## What went wrong`,
   `## What we change`) and a `summary` <= 200 chars. Run
   `bun run memory:reindex` and verify the entry round-trips.
2. **CI verification: read `statusCheckRollup` for StatusContext
   providers (DeepSource, CodeFactor) — `gh pr checks` misses them.**
   Always look up the `conclusion` field on each rollup item;
   never treat absence as success.
3. **PR-fixup workflow: when a reviewer (cubic, CodeRabbit) lists
   actionable inline findings, address each one in the next commit
   on the PR branch, then reply to the thread with the commit SHA
   and resolve via the GraphQL `resolveReviewThread` mutation.**
   Do not push a follow-up commit without first walking the full
   review-thread list (the AI summary may omit threads or count
   paused reviews).
4. **Supervisor fallback coverage: keep `closeSubagentOf` exercised
   by tests.** The cubic finding on PR #2 is now closed by the new
   `closeSubagentOf closes the most-recent non-done child of a
   parent` test in `packages/supervisor/src/state/store.test.ts`.

## Commits cited

- `b072d36` — fix(supervisor): resolve 8 convergent review bugs
- `fc23ec3` — fix(supervisor): address DeepSource stylistic nits
- `45676a0` — docs(memory): retro for /act pass on PR #2
- `590ac24` — docs(check-files): fix stale extension comment
- `a0f9566` — fix(supervisor): address Codacy findings
- plus a follow-up commit covering the cubic findings on this retro
  and the supervisor fallback coverage.
