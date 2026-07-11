/**
 * Daemon entry. Wires together identity, state, process
 * discovery, and lifecycle. The full NDJSON socket and HTTP/WS
 * servers ship in PR 3 (wire protocol); PR 2 ships the daemon
 * skeleton so the lifecycle and PID‑file behaviour are
 * exercised by CI.
 */

import { acquirePidSlot, pidFilePath, releasePidSlot } from './lifecycle/pid-file.js';
import { StateStore, type ProcessEntry, type Status } from './state/store.js';
import {
  pickDiscovery,
  type ProcessDiscovery,
  type ProcessRow,
} from './process-discovery/index.js';
import {
  normaliseCwd,
  resolveIdentity,
  type OpenTerminal,
  type ResolvedIdentity,
} from './identity/resolve.js';

/**
 * Construction-time knobs for `Supervisor`. Every field is
 * optional; production code constructs `new Supervisor()` with
 * no arguments. Tests pass `discovery`, `now`, and `stopWaitMs`
 * to remove non-determinism, and `lifecycle.customPidPath` to
 * keep the PID file out of a real runtime directory.
 */
export interface SupervisorOptions {
  /**
   * Lifecycle overrides. `customPidPath` redirects the PID file
   * to a test-controlled location so two parallel test runs do
   * not collide on the platform default.
   */
  readonly lifecycle?: { readonly customPidPath?: string };
  /**
   * Process discovery walker to use instead of `pickDiscovery(
   * process.platform)`. Pass `null` to disable discovery entirely
   * (the supervisor will then rely on extension-reported identity).
   */
  readonly discovery?: ProcessDiscovery | null;
  /**
   * Clock function for timestamps written into `ProcessEntry.at`.
   * Tests inject a fixed clock so snapshots are deterministic.
   */
  readonly now?: () => Date;
  /**
   * Override the maximum time `stop()` will wait for an in-flight
   * `start()` before releasing the PID slot anyway. Used by tests
   * to assert the "stop beats hung discovery" contract without
   * waiting the production 5-second default.
   */
  readonly stopWaitMs?: number;
}

/**
 * The supervisor. Owns the PID-file slot, the live state store,
 * the open-terminal cache, and the discovery walker. Exposes
 * lifecycle methods (`start`/`stop`), identity application
 * (`applyHook`), and subagent helpers (`startSubagent`/
 * `endSubagent`). Thread-safety: a single instance is safe to
 * call from multiple awaits because `start` is serialised on
 * the start tail and `stop` only races against the in-flight
 * promise with a bounded timeout.
 */
export class Supervisor {
  private static readonly DEFAULT_STOP_WAIT_MS = 5_000;
  private readonly store = new StateStore();
  private readonly discovery: ProcessDiscovery | null;
  private readonly now: () => Date;
  private readonly pidFile: { path: string };
  private readonly stopWaitMs: number;
  private pidSlot: { acquired: true } | { acquired: false; existingPid: number } | null = null;
  private stopping = false;

  constructor(opts: SupervisorOptions = {}) {
    this.discovery =
      opts.discovery !== undefined ? opts.discovery : pickDiscovery(process.platform);
    this.now = opts.now ?? (() => new Date());
    this.stopWaitMs = opts.stopWaitMs ?? Supervisor.DEFAULT_STOP_WAIT_MS;
    this.pidFile = pidFilePath({
      product: 'hookorama-supervisor',
      ...(opts.lifecycle?.customPidPath !== undefined
        ? { customPath: opts.lifecycle.customPidPath }
        : {}),
    });
  }

  /**
   * Open terminals reported by the extension, in pid order.
   *
   * Used as the authoritative source for `resolveIdentity`'s
   * `pidChain` walk. The supervisor never mutates this list
   * itself; it is pushed over the wire from the extension
   * (PR 3) and stored here verbatim.
   */
  openTerminals(): OpenTerminal[] {
    return Array.from(this.openTerminalsByPid.values());
  }
  private readonly openTerminalsByPid = new Map<number, OpenTerminal>();

  /**
   * Replace the cached open-terminal list atomically. Pass a
   * fresh array from the wire — the store clears and refills
   * rather than mutating in place so concurrent readers see a
   * single consistent snapshot.
   */
  setOpenTerminals(terminals: readonly OpenTerminal[]): void {
    this.openTerminalsByPid.clear();
    for (const t of terminals) this.openTerminalsByPid.set(t.pid, t);
  }

  /**
   * Per-call state for the most recent in-flight `start()`. Held
   * so a concurrent `stop()` can race a `setTimeout`-bounded
   * wait against it and force-release the slot on timeout. Always
   * cleared in the IIFE's `finally` if it is still the latest
   * attempt (a `stop()` that force-released us may have installed
   * a newer attempt that must not be clobbered).
   */
  private inflightStart: Promise<boolean> | null = null;
  /**
   * Serial tail of start transitions. Two concurrent `start()`
   * calls share the same underlying work, so the second sees
   * the already-acquired slot and returns true. Stop does NOT
   * chain onto this; it runs concurrently and only awaits
   * `inflightStart` (bounded by `stopWaitMs`) so a hung
   * discovery spawn cannot pin the PID slot forever.
   */
  private startTail: Promise<boolean> = Promise.resolve(false);

  /**
   * Run a start transition on the serial tail. Repeated calls
   * observe the previous one's settlement; rejected transitions
   * never poison the tail.
   */
  private enqueueStart(): Promise<boolean> {
    const prior = this.startTail;
    const next = prior.then(() => this.runStart());
    this.startTail = next.catch(() => false);
    return next;
  }

  /**
   * Acquire the PID slot. Idempotent: a second concurrent call
   * shares the first call's underlying work via the start tail
   * and observes the same result.
   *
   * Returns `true` when the slot was acquired (or was already
   * owned by this supervisor), `false` when another live
   * supervisor already owns it. On a force-release race with a
   * concurrent `stop()` while discovery is still in flight, the
   * call returns `false` rather than reporting a slot we no
   * longer own.
   */
  start(): Promise<boolean> {
    return this.enqueueStart();
  }

  /**
   * Underlying single attempt that acquires the PID slot and
   * seeds discovery. Called from `enqueueStart`'s serial tail so
   * concurrent `start()` calls share work. The IIFE pattern with
   * a captured `ours` promise is what lets the `finally` only
   * clear `inflightStart` when it is still the latest attempt.
   */
  private async runStart(): Promise<boolean> {
    if (this.pidSlot?.acquired) return true;
    if (this.inflightStart !== null) return this.inflightStart;
    let ours: Promise<boolean> = Promise.resolve(false);
    ours = (async (): Promise<boolean> => {
      try {
        this.pidSlot = await acquirePidSlot(this.pidFile, process.pid);
        if (!this.pidSlot.acquired) return false;
        try {
          await this.seedFromProcessDiscovery();
        } catch (err) {
          this.pidSlot = null;
          await releasePidSlot(this.pidFile);
          throw err;
        }
        // A concurrent `stop()` may have force-released the slot while
        // discovery was hung. Do not report a slot we no longer own.
        if (!this.pidSlot?.acquired) return false;
        return true;
      } finally {
        // Only clear `inflightStart` if we are still the latest
        // attempt; a `stop()` that force-released us may have been
        // replaced by a new in-flight start, and we must not clobber
        // it on our way out.
        if (this.inflightStart === ours) {
          this.inflightStart = null;
        }
      }
    })();
    this.inflightStart = ours;
    return ours;
  }

  /**
   * Release the PID slot and mark the supervisor as stopping.
   * Idempotent: a second concurrent `stop()` call observes the
   * first call's start tail so callers do not race past a slot
   * that is being torn down.
   *
   * If an in-flight `start()` is still running, `stop()` waits
   * up to `stopWaitMs` (default 5s) for it to settle before
   * force-releasing the slot and detaching the wedged promise.
   * `releasePidSlot` is called best-effort: filesystem errors
   * are swallowed so callers can retry the cleanup on the next
   * `stop()` call.
   */
  stop(): Promise<void> {
    return this.runStop();
  }

  /**
   * Underlying stop transition. Bounded-wait the in-flight
   * `start()`, then release the PID file. Detaches any wedged
   * start promise on timeout so a hung discovery cannot pin the
   * slot forever.
   */
  private async runStop(): Promise<void> {
    if (this.stopping) {
      // A previous `stop()` is in-flight. Await the start tail
      // so callers observe the slot actually released, and so
      // a subsequent `start()` does not acquire a still-held slot.
      await this.startTail;
      return;
    }
    this.stopping = true;
    if (this.inflightStart !== null) {
      // Wait for the in-flight `start()` to finalise. A hung
      // discovery spawn — one that never resolves its `list()`
      // — would pin the slot forever; bound the wait to
      // `stopWaitMs` and force-release the slot on timeout so
      // the supervisor is not stuck.
      let timedOut = false;
      const timeoutPromise = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          timedOut = true;
          resolve();
        }, this.stopWaitMs);
        timer.unref();
      });
      try {
        await Promise.race([this.inflightStart.then(() => undefined), timeoutPromise]);
      } catch {
        // start() will have cleaned up; nothing to release
      }
      if (timedOut) {
        // The in-flight `start()` is wedged in a hung discovery.
        // Detach it so future `start()` calls do not await this
        // dead promise forever. Clear `inflightStart` so `runStart`
        // does not dedupe to the wedged promise, and reset
        // `startTail` so the wedged chain does not gate subsequent
        // starts. The wedged IIFE's `finally` is a no-op when its
        // captured promise is no longer current (see `runStart`).
        this.inflightStart = null;
        this.startTail = Promise.resolve(false);
      }
    }
    if (this.pidSlot?.acquired) {
      // Mark the slot as released BEFORE the awaited release so a
      // concurrent `start()` IIFE waking up during the await cannot
      // observe `pidSlot?.acquired === true` and falsely report a
      // slot we no longer own.
      this.pidSlot = null;
      await releasePidSlot(this.pidFile).catch(() => {
        /* best effort; a re-entrant acquire may need retry */
      });
    }
    this.stopping = false;
  }

  /**
   * True between the moment `stop()` is called and the moment
   * the underlying `runStop` releases the PID slot. Used by
   * surfaces that want to refuse new hook events during shutdown.
   */
  isStopping(): boolean {
    return this.stopping;
  }

  /**
   * Seed the live state from process discovery. The supervisor
   * does not record status from discovery alone — that arrives
   * via hook events. Discovery only provides the open terminal
   * list, which is the source of truth for `pid` resolution.
   */
  async seedFromProcessDiscovery(): Promise<void> {
    if (this.discovery === null) return;
    const rows = await this.discovery.list();
    this.ingestProcessTable(rows);
  }

  /**
   * Apply a hook event. Returns the resolved identity if the
   * event could be mapped to a known process.
   */
  applyHook(input: {
    readonly pidChain?: readonly number[];
    readonly cwd?: string;
    readonly sessionId?: string;
    readonly agent?: string;
    readonly status: Status;
  }): ResolvedIdentity | null {
    const identity = resolveIdentity(input.pidChain, input.cwd, this.openTerminals());
    if (identity === null) return null;
    this.store.applyEvent(identity, input.status, this.now().toISOString(), {
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.agent !== undefined ? { agent: input.agent } : {}),
      ...(input.pidChain !== undefined ? { pidChain: input.pidChain } : {}),
    });
    return identity;
  }

  /**
   * `parentKey → toolUseId → actualKey[]` index. The state store
   * remints colliding keys when two subagents share a toolUseId
   * in the same millisecond; this lets `endSubagent(toolUseId)`
   * close every actual key written by `startSubagent(toolUseId)`
   * even after one or more collisions.
   */
  private readonly subagentKeysByToolUseId = new Map<string, Map<string, string[]>>();

  /**
   * Record the (parent, toolUseId, actualKey) triple so a future
   * `endSubagent(toolUseId)` can close a child even if the
   * state store reminted its key on collision. Idempotent: a
   * duplicate `(parent, toolUseId, actualKey)` triple is a no-op,
   * so repeat `startSubagent` calls do not grow the index.
   */
  private rememberSubagentKey(parentKey: string, toolUseId: string, actualKey: string): void {
    let perParent = this.subagentKeysByToolUseId.get(parentKey);
    if (perParent === undefined) {
      perParent = new Map();
      this.subagentKeysByToolUseId.set(parentKey, perParent);
    }
    const existing = perParent.get(toolUseId) ?? [];
    if (!existing.includes(actualKey)) existing.push(actualKey);
    perParent.set(toolUseId, existing);
  }

  /**
   * Insert a virtual subagent child under `identity`. The
   * desired key is derived from `toolUseId` when present (so
   * tool-lifecycle events can close the same child that opened)
   * or from the timestamp otherwise.
   *
   * The state store may remint the key on collision (two subagents
   * sharing the same toolUseId in the same millisecond); the
   * **actual** key written is always returned so callers can
   * close that exact child later. When `toolUseId` is provided,
   * the (parent, toolUseId, actualKey) triple is remembered so
   * `endSubagent(toolUseId)` can close every reminted child that
   * `startSubagent(toolUseId)` ever opened.
   */
  startSubagent(identity: ResolvedIdentity, at: string, toolUseId?: string): string {
    const desired =
      toolUseId !== undefined
        ? `${identity.key}:subagent:${toolUseId}`
        : `${identity.key}:subagent:${at}`;
    const actualKey = this.store.upsertSubagent(identity.key, desired, at);
    if (toolUseId !== undefined) {
      this.rememberSubagentKey(identity.key, toolUseId, actualKey);
    }
    return actualKey;
  }

  /**
   * Close a subagent child. Three paths:
   *
   * 1. With `toolUseId`: walk every key `startSubagent` wrote for
   *    that triple (including reminted collisions) and try to
   *    close it by exact key. The first successful close wins;
   *    the remaining remembered keys are kept so a future
   *    `endSubagent` with the same `toolUseId` can still close a
   *    younger sibling.
   * 2. Without `toolUseId`: fall back to "close the most recent
   *    non-terminal child of this parent" (`closedByParent`).
   * 3. No match: returns `{ closedByKey: false, closedByParent: false }`.
   *    A specific `toolUseId` that does not match any live key is
   *    intentionally NOT a parent fallback — closing an unrelated
   *    live sibling would be a worse failure than a no-op.
   */
  endSubagent(
    parentKey: string,
    at: string,
    toolUseId?: string,
  ): { closedByKey: boolean; closedByParent: boolean } {
    if (toolUseId !== undefined) {
      const perParent = this.subagentKeysByToolUseId.get(parentKey);
      const rememberedKeys = perParent?.get(toolUseId) ?? [];
      const fallback = `${parentKey}:subagent:${toolUseId}`;
      const candidateKeys: string[] = [...rememberedKeys];
      if (!candidateKeys.includes(fallback)) candidateKeys.push(fallback);
      for (const candidate of candidateKeys) {
        if (this.store.closeSubagentByKey(candidate, at)) {
          const remaining = rememberedKeys.filter((k) => k !== candidate);
          if (remaining.length === 0) {
            perParent?.delete(toolUseId);
          } else {
            perParent?.set(toolUseId, remaining);
          }
          return { closedByKey: true, closedByParent: false };
        }
      }
      // No keyed match: do NOT fall back to the parent fallback,
      // because that would close an unrelated live child of the
      // parent. The caller signalled a specific toolUseId; if no
      // reminted key or fallback key is alive, treat it as a no-op.
      return { closedByKey: false, closedByParent: false };
    }
    const closed = this.store.closeSubagentOf(parentKey, at);
    return { closedByKey: false, closedByParent: closed };
  }

  /**
   * Snapshot for surfaces (read-only). A defensive copy is taken
   * at the state-store boundary so callers iterating the array
   * cannot observe mid-write corruption from a concurrent
   * `applyEvent`.
   */
  snapshot(): readonly ProcessEntry[] {
    return this.store.snapshot();
  }

  /**
   * Push a freshly-discovered process table into the state store
   * for the cwd-only fallback (PR 3). Process discovery does NOT
   * contribute to live status — status arrives over hook events.
   * Rows are kept only as a side table that a future extension-
   * absent fallback can resolve a pid chain against.
   */
  private ingestProcessTable(rows: readonly ProcessRow[]): void {
    // Process discovery does not contribute to live status; it
    // only feeds a future cwd-only fallback when the extension
    // is unavailable. The supervisor relies on the extension for
    // authoritative pid→terminal mapping. We retain the rows in
    // a side table so a future fallback (cwd-only when extension
    // is absent) can resolve a pid chain to a name. PR 3 wires
    // it into the wire protocol.
    this.store.seedFromDiscovery(rows);
  }

  /**
   * Normalise cwd — re-exported so callers don't import the
   * identity module directly. Identical signature and behaviour
   * to `normaliseCwd` in `identity/resolve`.
   */
  static readonly normaliseCwd = normaliseCwd;
}

/**
 * Convenience alias for the daemon entry script and tests. Both
 * `Supervisor` (the class) and `SupervisorProcess` (the value
 * form) are exported so the daemon can `new SupervisorProcess(...)`
 * without a separate factory.
 */
export const SupervisorProcess = Supervisor;
