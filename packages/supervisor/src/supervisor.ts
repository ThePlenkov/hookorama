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

export interface SupervisorOptions {
  readonly lifecycle?: { readonly customPidPath?: string };
  readonly discovery?: ProcessDiscovery | null;
  readonly now?: () => Date;
  /**
   * Override the maximum time `stop()` will wait for an in-flight
   * `start()` before releasing the PID slot anyway. Used by tests
   * to assert the "stop beats hung discovery" contract without
   * waiting the production 5-second default.
   */
  readonly stopWaitMs?: number;
}

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

  /** Open terminals reported by the extension. */
  openTerminals(): OpenTerminal[] {
    return Array.from(this.openTerminalsByPid.values());
  }
  private readonly openTerminalsByPid = new Map<number, OpenTerminal>();

  setOpenTerminals(terminals: readonly OpenTerminal[]): void {
    this.openTerminalsByPid.clear();
    for (const t of terminals) this.openTerminalsByPid.set(t.pid, t);
  }

  /** Per-call state for the most recent in-flight `start()`. */
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

  /** Acquire the PID slot. Returns false if another supervisor is alive. */
  start(): Promise<boolean> {
    return this.enqueueStart();
  }

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

  /** Release the PID slot and mark the supervisor as stopping. */
  stop(): Promise<void> {
    return this.runStop();
  }

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

  /** True after `stop()` has been called. */
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

  /** Snapshot for surfaces (read‑only). */
  snapshot(): readonly ProcessEntry[] {
    return this.store.snapshot();
  }

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

  /** Normalise cwd — re‑exported so callers don't import identity directly. */
  static normaliseCwd = normaliseCwd;
}

/** Convenience for the daemon entry script and tests. */
export const SupervisorProcess = Supervisor;
