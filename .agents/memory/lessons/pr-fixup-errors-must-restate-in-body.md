---
id: pr-fixup-errors-must-restate-in-body
type: lesson
tags: [pr-fixup, ci, bead-format]
created: 2026-07-10
summary: PR-fixup beads must restate CI errors verbatim in the body; polecats miss errors that arrive only as PR annotations.
---

## Rule

When dispatching a `gt:pr-fixup` bead (or any bead whose goal is to fix a failing PR), the bead body MUST restate every CI/check failure verbatim under a `## CI errors to fix` heading, with file path, line number, and the failure text. Do NOT rely on PR annotations, GitHub check names alone, or "see CI" pointers.

The bead body is the only signal the polecat sees during the dispatch loop. PR annotations, bot comments, and check names can be missed, parsed late, or fail to surface in the agent's context window. The bead body is the canonical source.

## Applies when

- Slinging a `gt:pr-fixup` bead for any rig.
- Slinging a bead whose body references a failing PR check.
- Forwarding an escalation, error report, or review comment from the user as a task.
