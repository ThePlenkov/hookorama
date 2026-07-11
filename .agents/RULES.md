# `.agents/RULES.md` — index of rules for tracked `.md` files

> **Why this file exists.** Per `AGENTS.md §2`, every tracked
> `.md` (other than the explicit allowlist) must be covered by
> one rule under `.agents/rules/`. This file is the index: for
> each rule, it states the path glob the rule covers, points at
> the rule file, and one-lines the purpose.
>
> **Format of each rule file.** Frontmatter (`appliesTo`,
> `purpose`, `owner`, `created`, optional `supersedes`) plus a
> short prose body explaining the rule, then a "Template" block
> showing the frontmatter the new `.md` must carry.
>
> **To add a new tracked `.md`** — see
> `.agents/skills/maintaining-agents-dir/SKILL.md`. The
> procedure is: write the rule first, register it here, then
> write the file. `bun run check:md` enforces this.

## Rules index

| Path glob                                    | Rule file                                            | Purpose                                                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                  | (allowlisted — root contract, no separate rule file) | The agent contract.                                                                                                                            |
| `README.md`                                  | `.agents/rules/readme.md.rule`                       | Top-level pointer to `AGENTS.md` and the project status table.                                                                                 |
| `LICENSE`                                    | `.agents/rules/license.rule`                         | MIT license text; not a doc, but lives in the `.md` check universe.                                                                            |
| `docs/adr/README.md`                         | `.agents/rules/adr-readme.md.rule`                   | Defines what an ADR is, when to write one, and the format.                                                                                     |
| `docs/adr/NNNN-*.md`                         | `.agents/rules/adr.md.rule`                          | One ADR per product/architecture decision; cites principles, jobs, and traceability. The README is allowlisted; numbered ADRs match this glob. |
| `SPEC.md`                                    | `.agents/rules/spec.md.rule`                         | Component index — one row per shipped component, grows with each ADR.                                                                          |
| `ROADMAP.md`                                 | `.agents/rules/roadmap.md.rule`                      | Ordered phase plan; each phase cites the ADRs it ships.                                                                                        |
| `CHANGELOG.md`                               | `.agents/rules/changelog.md.rule`                    | Keep-a-changelog log; entries added by the PR that ships each phase.                                                                           |
| `.agents/README.md`                          | `.agents/rules/agents-readme.md.rule`                | How `.agents/` is organised and what lives where.                                                                                              |
| `.agents/RULES.md`                           | `.agents/rules/agents-rules.md.rule`                 | This index; covered by its own rule so the rule file references itself.                                                                        |
| `.agents/skills/<name>/SKILL.md`             | `.agents/rules/skill.md.rule`                        | A procedure activated by name when its `when to use` matches the task.                                                                         |
| `.agents/rules/*.md.rule`                    | (allowlisted — these are the rule files themselves)  | Rule files are self-describing.                                                                                                                |
| `.agents/memory/README.md`                   | `.agents/rules/memory-readme.md.rule`                | How to add a fact / retro / lesson.                                                                                                            |
| `.agents/memory/{facts,retros,lessons}/*.md` | `.agents/rules/memory-entry.md.rule`                 | Each entry has frontmatter (`id`, `type`, `tags`, `created`, `summary`).                                                                       |
| `packages/<name>/README.md`                  | `.agents/rules/package-readme.md.rule`               | One short README per package; describes what it is for, not what it ships.                                                                     |
| `packages/<name>/src/README.md`              | `.agents/rules/package-src-readme.md.rule`           | Optional src-level README for packages whose entry is not `src/index.ts` (e.g. the VS Code extension).                                         |
| `.github/pull_request_template.md`           | `.agents/rules/pr-template.md.rule`                  | Enforces ADR cite, FR/NFR cite, AC checklist, memory update, and rule addition.                                                                |
| `.github/CODEOWNERS`                         | `.agents/rules/codeowners.md.rule`                   | One-row file listing reviewers; tracked as `.md` for the check, but content is the GitHub CODEOWNERS syntax.                                   |
| `.github/workflows/ci.yml`                   | `.agents/rules/ci-workflow.md.rule`                  | Runs `bun install && bun run ci` on PRs and on `main`.                                                                                         |
| `.github/workflows/release.yml`              | `.agents/rules/release-workflow.md.rule`             | Placeholder until the first release PR.                                                                                                        |
| `scripts/README.md`                          | `.agents/rules/scripts-readme.md.rule`               | What is allowed in `scripts/` (small, throwaway tooling only).                                                                                 |
| `scripts/check-md.ts`                        | `.agents/rules/check-md-script.md.rule`              | Walks tracked `.md`; fails on unmatched `appliesTo`.                                                                                           |
| `scripts/check-files.ts`                     | `.agents/rules/check-files-script.md.rule`           | Walks `packages/`; asserts siblings and allowlists.                                                                                            |
| `scripts/reindex-memory.ts`                  | `.agents/rules/reindex-memory-script.md.rule`        | Builds `.agents/memory/index.tsv` from frontmatter.                                                                                            |
| `.vscode/settings.json`                      | (allowlisted — IDE config, not a doc)                | Bun format on save; oxlint on save.                                                                                                            |
| `.vscode/extensions.json`                    | (allowlisted — IDE recommendation, not a doc)        | Recommended extensions.                                                                                                                        |

## Allowlist (no rule required)

- `AGENTS.md`
- `.agents/RULES.md`
- `.agents/rules/*.md.rule`
- `.agents/skills/*/SKILL.md`
- `.vscode/settings.json`
- `.vscode/extensions.json`

## Adding a new rule

1. Decide the path glob the rule will cover (e.g. `packages/<name>/*.flow.md`).
2. Create `.agents/rules/<file-slug>.md.rule` with the required frontmatter (`appliesTo`, `purpose`, `owner`, `created`).
3. Add a row to the table above.
4. Now write the file(s) the rule covers.

The check (`bun run check:md`) will pass only after steps 1–3 are complete.
