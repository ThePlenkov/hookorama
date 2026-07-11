/**
 * Identity types and resolution rules for the supervisor.
 *
 * The supervisor is the only place that resolves a hook event's
 * `pidChain` / `cwd` / `session_id` triple to a stable process key.
 * See `docs/adr/0001-supervisor-shape.md` and
 * `.agents/memory/facts/pid-chain-beats-session-id.md` for the
 * rationale.
 */

/**
 * A resolved process key. Either `pid` is set (preferred), or
 * `cwd` is set (fallback), or both. `session_id` is never part
 * of the key — it is only an enrichment field.
 */
export interface ResolvedIdentity {
  /** Stable key used in the live state map. */
  readonly key: string;
  /** OS PID, when at least one pid in `pidChain` resolved. */
  readonly pid?: number;
  /** Resolved working directory (always normalised). */
  readonly cwd: string;
  /** Whether the key is exact (`pid:<n>`) or fallback (`cwd:<path>`). */
  readonly kind: 'pid' | 'cwd';
}

/**
 * Open terminals known to the supervisor, in the order the
 * extension reported them. The supervisor does not own this list;
 * the extension pushes updates over the wire. For unit testing,
 * a synthetic list is acceptable.
 */
export interface OpenTerminal {
  readonly pid: number;
  readonly cwd: string;
  readonly name?: string;
}

const pidPrefix = 'pid:';
const cwdPrefix = 'cwd:';

/**
 * Resolve identity, preferring PID. Returns the first pid in
 * `pidChain` that is in `openTerminals`, falling back to `cwd`
 * when no pid matches. `session_id` is ignored.
 *
 * Returns `null` only when `pidChain` is empty AND `cwd` is
 * empty — a degenerate payload that the caller should treat as
 * a log line, not an event.
 */
export function resolveIdentity(
  pidChain: readonly number[] | undefined,
  cwd: string | undefined,
  openTerminals: readonly OpenTerminal[],
): ResolvedIdentity | null {
  const safeCwd = (cwd ?? '').trim();
  const safeChain = pidChain ?? [];

  for (const pid of safeChain) {
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const match = openTerminals.find((t) => t.pid === pid);
    if (match !== undefined) {
      return {
        key: `${pidPrefix}${pid}`,
        pid,
        cwd: normaliseCwd(match.cwd),
        kind: 'pid',
      };
    }
  }

  if (safeCwd.length === 0) return null;

  return {
    key: `${cwdPrefix}${normaliseCwd(safeCwd)}`,
    cwd: normaliseCwd(safeCwd),
    kind: 'cwd',
  };
}

/**
 * Normalise a working directory for use as a key. Trims trailing
 * separators, normalises backslash vs forward slash on Windows
 * paths, and lowercases the Windows drive letter. The supervisor
 * stores the original `cwd` on the entry but uses the normalised
 * form for the key.
 */
export function normaliseCwd(cwd: string): string {
  let input = cwd.trim();
  if (input.length === 0) return input;
  // Detect Windows-style paths by a drive-letter prefix (e.g. "C:").
  // On those paths, collapse all separators to forward slash and
  // lowercase the drive letter so "C:\Users\Alice" and "C:/Users/Alice"
  // produce the same key. (A bare backslash path is not treated as
  // Windows here; that keeps the contract obvious.)
  const isWindowsPath = input.length >= 2 && input.charAt(1) === ':';
  if (isWindowsPath) {
    input = input.replace(/\\/g, '/');
  }
  // Strip trailing separators (POSIX "/" or, after the replace above,
  // the Windows "/" form). Keep a leading "/" on POSIX roots intact.
  // Preserve the trailing slash on Windows drive roots ("C:/" or "c:/")
  // so the drive root and a drive-relative path do not collapse to
  // the same key.
  const isDriveRoot = isWindowsPath && /^[A-Za-z]:\/?$/.test(input);
  if (!isDriveRoot) {
    while (input.length > 1 && (input.endsWith('/') || input.endsWith('\\'))) {
      input = input.slice(0, -1);
    }
  }
  // Lowercase Windows drive letter: "C:/foo" → "c:/foo".
  if (isWindowsPath) {
    const firstChar = input.charAt(0);
    if (/[A-Z]/.test(firstChar)) {
      input = firstChar.toLowerCase() + input.slice(1);
    }
  }
  return input;
}
