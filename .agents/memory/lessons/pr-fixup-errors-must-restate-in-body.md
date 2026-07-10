---
id: pr-fixup-errors-must-restate-in-body
type: lesson
tags: [pr-fixup, ci, bead-format]
created: 2026-07-10
summary: PR-fixup beads must restate CI errors verbatim in the body; polecats miss errors that arrive only as PR annotations.
---

## Rule

When dispatching a `gt:pr-fixup` bead (or any bead whose goal is to fix a failing PR), the bead body MUST restate every CI/check failure verbatim under a `## CI errors to fix` heading, including the file path and line number when provided by CI, plus the failure text. If file/line metadata is not provided by CI (timeouts, deployment errors, policy checks, etc.), state that explicitly rather than fabricating details. Do NOT rely on PR annotations, GitHub check names alone, or "see CI" pointers.

The bead body is the only signal the polecat sees during the dispatch loop. PR annotations, bot comments, and check names can be missed, parsed late, or fail to surface in the agent's context window. The bead body is the canonical source.

For example:

```markdown
## CI errors to fix

- File: packages/supervisor/src/index.ts:8
- Error: Type 'true' is not assignable to type 'false'.
```

Or, when CI provides no file/line:

```markdown
## CI errors to fix

- File: (not provided by CI)
- Line: (not provided by CI)
- Error: vitest timed out after 30s on packages/supervisor/src/discovery.test.ts
```

## Applies when

- Slinging a `gt:pr-fixup` bead for any rig.
- Slinging a bead whose body references a failing PR check.
- Forwarding an escalation, error report, or review comment from the user as a task.
