# SPEC.md — Hookorama component index

> Read `AGENTS.md` and `docs/adr/README.md` before extending this
> document. Rows are added by the PR that introduces the component;
> pre‑written rows are forbidden.

| Component  | Package(s)            | ADR(s)                                                                | Rule(s)                  | Skill(s) | Memory facts                                                            |
| ---------- | --------------------- | --------------------------------------------------------------------- | ------------------------ | -------- | ----------------------------------------------------------------------- |
| Supervisor | `packages/supervisor` | `docs/adr/0001-supervisor-shape.md`, `docs/adr/0002-v1-postmortem.md` | `package-readme.md.rule` | none     | `.agents/memory/facts/pid-chain-beats-session-id.md` (added by this PR) |
