---
id: pid-chain-beats-session-id
type: fact
tags: [identity, pid, session-id, cwd, v1-lesson]
created: 2026-07-10
summary: v1 learned that process identity must be pid-first, not session_id or cwd.
---

# `pidChain` beats `session_id` for process identity

The v1 supervisor tried every cheaper key before settling on PID.
Each had a concrete failure:

- **`session_id`** — the agent CLI's session id changes across
  `/clear` and `/new` even within the same terminal. Keying on
  it splits a single process into many rows.
- **`cwd`** — two terminals in the same directory are two
  different processes. Keying on cwd merges them into one row
  and interleaves their status updates unpredictably (the
  actual bug v1 FR‑D.6 documented and fixed).
- **PID** — stable for the lifetime of a terminal. The agent's
  own PID is reported in the hook payload as `pidChain[0]`;
  `vscode.Terminal.processId` is the matching extension‑side
  number. PID → cwd is the right order; `session_id` is never a
  key, only an enrichment field.

Use `pidChain` to match hook events to open terminals; fall back
to `cwd` only when no PID in the chain resolves. Never use
`session_id` as a key.
