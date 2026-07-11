# ROADMAP.md — phases

> Read `AGENTS.md` §3 before extending this document. Each phase
> row is justified by at least one ADR in `docs/adr/`. Phase
> status is one of `shipped` | `in progress` | `planned`
> (the controlled vocabulary defined in
> `.agents/rules/roadmap.md.rule`).

| Phase                                                  | ADR(s)                                                                                       | Component(s)                                           | Status  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------- |
| Phase 0 — Bootstrap                                    | (none — tooling only)                                                                        | (none — no components shipped)                         | shipped |
| Phase 1 — Supervisor                                   | `docs/adr/0001-supervisor-shape.md`, `docs/adr/0002-v1-postmortem.md`                        | Supervisor                                             | shipped |
| Phase 2 — Wire protocol + persistence                  | `docs/adr/0004-wire-protocol.md` (to open), `docs/adr/0003-persistence-drizzle.md` (to open) | Persistence, Wire protocol, Supervisor (consumes both) | planned |
| Phase 3 — CLI                                          | (ADR to open with that PR)                                                                   | CLI                                                    | planned |
| Phase 4 — VS Code extension                            | (ADR to open with that PR)                                                                   | Extension                                              | planned |
| Phase 5 — Web dashboard                                | (ADR to open with that PR)                                                                   | Web app                                                | planned |
| Phase 6 — MCP server                                   | (ADR to open with that PR)                                                                   | MCP                                                    | planned |
| Phase 7 — Multi‑IDE                                    | (ADR to open with that PR)                                                                   | Extension (other IDEs)                                 | planned |
| Phase 8 — Analytics + cost guardrails + adoption score | (ADR per formula in that PR)                                                                 | Analytics, Cost guardrails                             | planned |
