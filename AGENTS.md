# AGENTS.md — the agent contract

> **Read first.** Every AI agent (Claude Code, Cursor, Codex, Kilo,
> Aider, Continue, Windsurf, …) and every human contributor reads
> this file before doing anything else in the repo. If a tool
> contradicts this file, this file wins until an ADR explicitly
> demotes it.

## 1. Read-first order

When you arrive in this repo for a task:

1. **`AGENTS.md`** (this file) — the contract.
2. **`README.md`** — pointer to this file and to the workflow.
3. **`.agents/RULES.md`** — the index of rules that govern tracked `.md` files.
4. **The relevant `.agents/skills/<name>/SKILL.md`** — the procedure for the kind of work you are about to do. If no skill matches your task, you are doing something the repo has never seen before; **stop** and check `docs/adr/` first, because that work may belong to a future PR.
5. **`SPEC.md`** (when it exists — PR 2+) — the component index. **Until `SPEC.md` exists, treat its absence as "no components have been shipped yet"; do not invent one.**
6. **`ROADMAP.md`** (when it exists — PR 2+) — the phase list.
7. **The ADR the task cites** (if any) — the product/architecture decision that justifies the change.
8. **The package's `README.md`** — what the package is for.

If a doc in this chain does **not** exist, **stop**. It might be a future PR's job to create it, not yours.

## 2. The `.md` rule — no random files

Every tracked `.md` file (other than those in the explicit allowlist below) must be covered by an entry in `.agents/RULES.md`. The procedure to add a new tracked `.md` is in `.agents/skills/maintaining-agents-dir/SKILL.md`. Concretely:

1. Decide which category the file falls into (see §3).
2. Create the corresponding rule file under `.agents/rules/<file>.md.rule` with frontmatter (`appliesTo`, `purpose`, `owner`, `created`).
3. Add a row to `.agents/RULES.md`.
4. Now write the file.

`bun run check:md` enforces this; CI fails if you skip it.

**Explicit allowlist** (no rule required):

- `AGENTS.md` itself.
- `.agents/RULES.md`.
- Rule files (`.agents/rules/*.md.rule`).
- Skill files (`.agents/skills/*/SKILL.md`).
- The per-`package` `README.md` files (these are governed by `.agents/rules/package-readme.md.rule`).

## 3. Role boundary — do not cross the categories

| Category                 | Path(s)                                                    | What lives here                                                                                                                                                                                                                                                                | What does NOT live here                                                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent contract**       | `AGENTS.md` (root)                                         | The rules every agent must follow. Invariants. Read-first order. Common traps.                                                                                                                                                                                                 | Procedures, tutorials, "how to use bun".                                                                                                                                                       |
| **Skills**               | `.agents/skills/<name>/SKILL.md`                           | Procedures for recurring tasks. Activated by name when relevant.                                                                                                                                                                                                               | Hard invariants (those are in `AGENTS.md`); product-specific facts (those are in memory or in the relevant ADR).                                                                               |
| **Rules**                | `.agents/rules/<file>.md.rule`                             | One rule per tracked `.md` file: what `appliesTo` (path glob), what `purpose`. Enforced by `bun run check:md`.                                                                                                                                                                 | Reasoning behind the rule (that's in `AGENTS.md` or the relevant skill).                                                                                                                       |
| **Memory**               | `.agents/memory/{facts,retros,lessons}/*.md` + `index.tsv` | Facts we learned, retros on mistakes, lessons that change behaviour. Frontmatter with `id`, `type`, `tags`, `created`, `summary`.                                                                                                                                              | Decisions about the product (those are ADRs).                                                                                                                                                  |
| **ADRs**                 | `docs/adr/NNNN-<slug>.md`                                  | **Product / architecture decisions about a component or a feature.** When we add the supervisor, an ADR pins its shape; when we add the wire protocol, an ADR pins its frames; when we add analytics, an ADR pins the adoption-score formula. Each ADR cites its memory facts. | Tooling (bun/tsdown/vitest — in `package.json` + `tsdown.config.ts` + `AGENTS.md`); processes (in skills); invariants (in `AGENTS.md`); code style (in `.oxlintrc.json` + `.prettierrc.json`). |
| **`SPEC.md`** (PR 2+)    | repo root                                                  | **Component index** — one row per component of Hookorama, pointing at the package, the ADRs that pin its shape, the rules that govern its `.md`, the skills that touch it, and the memory facts it relies on.                                                                  | Detailed component description (that lives in the ADR + the package's `README.md`); FR/NFR inventories (those live in the relevant ADR); build / process docs (in `AGENTS.md` and skills).     |
| **`ROADMAP.md`** (PR 2+) | repo root                                                  | Ordered list of phases. Each phase row cites the ADRs it ships and the components it activates.                                                                                                                                                                                | A spec for any component (those live in ADRs and `SPEC.md`).                                                                                                                                   |

If you find a `.md` that does not fit one of these rows, the PR is wrong. Either move the file to the right category, or open a new ADR / rule / skill to justify a new category.

## 4. Architecture invariants — every PR keeps them

- **TypeScript strict everywhere.** `tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Do not relax.
- **No `any` in production code.** oxlint rule `no-explicit-any: error`.
- **No `vscode` import outside `packages/extension`.** The supervisor must never depend on the VS Code API.
- **Public API exported from each package's `src/index.ts` barrel.** Internal modules stay private.
- **Tests live next to source as `*.test.ts`.** No `tests/` directory per package.
- **No new tracked `.md` without a rule.** Scripts go in `scripts/`.
- **No `docs/adr/NNNN-…` for tooling** (bun, tsdown, vitest, oxlint, prettier, CI). Those are build choices; they belong in `package.json` / config files / `AGENTS.md`, not in `docs/adr/`. ADRs are for product/architecture decisions about a **component or a feature**.
- **No product docs in PR 1.** `SPEC.md`, `ROADMAP.md`, mission/principles/architecture files appear only when an ADR needs them.
- **No code without an ADR that justifies it.** Every PR that adds a new package, new wire frame, new state machine, new persistence shape, new surface, new cost model, or new adoption-score formula must cite (or open) an ADR that explains the choice. Tooling, formatting, test scaffolding, and refactors do not need ADRs.

## 5. Standard landing sequence

Before opening a PR:

```
1. read AGENTS.md                        ← you are here
2. read README.md
3. read .agents/RULES.md
4. load the relevant .agents/skills/<name>/SKILL.md
5. read SPEC.md (if it exists)
6. read ROADMAP.md (if it exists)
7. read the ADR the task cites
8. read the package's README.md
9. open a worktree:    git worktree add .worktrees/<kebab-name> -b <branch>
10. code; tests live next to source as *.test.ts
11. add a rule + .agents/RULES.md row for any new tracked .md
12. add a memory entry for any non-obvious fact you learned
13. run: bun run typecheck && bun run lint && bun run check && bun run test && bun run build
14. push; open PR; fill the PR template; wait for green CI; respond to review
```

If you cannot satisfy steps 11, 12, or 13, the PR is **not ready to merge**. Stop and explain.

## 6. Common traps

| Trap                                                                                     | Fix                                                                                                                               |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Adding a `vscode` import to `packages/supervisor`, `packages/client`, or `packages/cli`. | Move the logic to `packages/extension`, or use a plain-string equivalent.                                                         |
| Adding code without an ADR to satisfy.                                                   | Add an ADR in `docs/adr/` first, or decline the work.                                                                             |
| Skipping the PR template.                                                                | The "Cites ADR(s)" and "Acceptance criteria" fields are required. Empty PRs are auto-rejected by reviewers.                       |
| Marking work as done without running `bun run ci`.                                       | Run it locally before pushing.                                                                                                    |
| Creating a `.md` without first adding a rule.                                            | Add the rule to `.agents/rules/` and the row to `.agents/RULES.md` first.                                                         |
| Re-doing a finished component.                                                           | Check `SPEC.md` (when it exists) and `ROADMAP.md` (when it exists) first. Phases are tracked.                                     |
| Adding `console.log` in production code.                                                 | oxlint allows only `console.warn` and `console.error`. Use `console.warn` for diagnostics.                                        |
| Treating `bun.lock` as something to commit selectively.                                  | Commit the whole lockfile. Drift in lockfiles causes irreproducible CI.                                                           |
| Using `any` to silence a type error.                                                     | Fix the type. `unknown` is allowed; `any` is not.                                                                                 |
| Writing a tooling ADR ("ADR 0001 — use bun").                                            | Tooling choices go in `AGENTS.md` and config files, not in `docs/adr/`. The ADR index is for product/architecture decisions only. |

## 7. Fork-upstream workflow

The rig operates against `ThePlenkov/hookorama` (fork) with
reviewers running on `hookorama/hookorama` (upstream). Every
bead touches both remotes; the checklist below is the
contract. See `docs/adr/0005-fork-upstream-workflow.md` for
the rationale and
`.agents/memory/lessons/fork-upstream-auto-merge-on-sync.md`
for the auto-merge mechanics.

- [ ] **Fork `main` is read-only.** The only way fork `main`
      advances is `git merge upstream/main --no-ff` (or fast-forward
      when clean). Never `git merge feat/*` into fork `main`.
- [ ] **Feature branches live in the fork first.** Commit, push
      to `origin` (fork), open the fork PR. CI + review bots run
      on the fork PR; resolve threads there.
- [ ] **Promote by pushing the same branch (same SHA) to
      upstream.** No cherry-pick, no rebase, no squash between the
      two pushes. Open the upstream PR from that branch.
- [ ] **Never force-push a public feature branch.** Rewriting
      SHAs in upstream breaks the auto-merge-on-sync trick; the
      fork PR will not close when fork `main` syncs.
- [ ] **Sync closes the fork PR automatically.** When upstream
      merges the upstream PR and fork `main` syncs from
      `upstream/main`, GitHub flips the fork PR to `MERGED` on its
      own. Do **not** run `gh pr close` manually on the fork PR.

## See also

- `README.md` — top-level pointer.
- `.agents/RULES.md` — the `.md` rule registry.
- `.agents/skills/maintaining-agents-dir/SKILL.md` — procedure to add rules, skills, memory entries.
- `.agents/skills/navigating-project-docs/SKILL.md` — procedure to read or update project docs.
- `docs/adr/README.md` — what an ADR is and when to write one.

---

_This file is intentionally short and prescriptive. Detail lives in skills, rules, memory, and ADRs. If you find yourself wanting to write a long answer here, move it into a skill or an ADR instead._
