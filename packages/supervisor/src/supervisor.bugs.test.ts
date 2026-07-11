import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Supervisor } from './supervisor.js';
import type { ProcessDiscovery, ProcessRow } from './process-discovery/index.js';
import { StateStore } from './state/store.js';

describe('Supervisor bug fixes', () => {
  let workDir: string;
  let pidPath: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'hookorama-supervisor-bugs-'));
    pidPath = join(workDir, 'supervisor.pid');
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  test('start reclaims a stale PID file pointing at a dead process', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 0)'], { stdio: 'ignore' });
    const stalePid = child.pid;
    if (stalePid === undefined) {
      throw new Error('spawn returned no pid; cannot exercise stale-PID reclaim');
    }
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => {
        resolve(code);
      });
    });
    expect(exitCode).not.toBeNull();
    writeFileSync(pidPath, `${stalePid}\n`, 'utf8');
    const sup = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
    expect(await sup.start()).toBe(true);
    await sup.stop();
  });

  test('start refuses to reclaim when the PID file owner is alive', async () => {
    writeFileSync(pidPath, `${process.pid}\n`, 'utf8');
    const sup = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
    expect(await sup.start()).toBe(false);
  });

  test('start releases the PID slot if discovery throws', async () => {
    const failing: ProcessDiscovery = { list: () => Promise.reject(new Error('boom')) };
    const sup = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: failing });
    await expect(sup.start()).rejects.toThrow('boom');
    const fresh = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
    expect(await fresh.start()).toBe(true);
    await fresh.stop();
  });

  test('two subagents opened at the same timestamp do not collide', () => {
    const sup = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
    sup.setOpenTerminals([{ pid: 7, cwd: '/p' }]);
    const identity = sup.applyHook({ pidChain: [7], cwd: '/p', status: 'thinking' });
    expect(identity).not.toBeNull();
    if (identity === null) throw new Error('identity should resolve');
    const ts = '2026-07-10T00:00:01.000Z';
    const first = sup.startSubagent(identity, ts);
    const second = sup.startSubagent(identity, ts);
    expect(first).not.toBe(second);
    expect(sup.snapshot()).toHaveLength(3);
    // Exercise endSubagent for both colliding children so the remint
    // path is verified end-to-end, not just uniqueness.
    const closeFirst = sup.endSubagent(identity.key, '2026-07-10T00:00:02.000Z');
    const closeSecond = sup.endSubagent(identity.key, '2026-07-10T00:00:02.500Z');
    expect(closeFirst.closedByKey || closeFirst.closedByParent).toBe(true);
    expect(closeSecond.closedByKey || closeSecond.closedByParent).toBe(true);
    const remaining = sup
      .snapshot()
      .filter((e) => e.parentKey === identity.key)
      .filter((e) => e.status !== 'done');
    expect(remaining).toHaveLength(0);
  });

  test('two subagents with the same toolUseId remint and can each be closed', () => {
    const sup = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
    sup.setOpenTerminals([{ pid: 7, cwd: '/p' }]);
    const identity = sup.applyHook({ pidChain: [7], cwd: '/p', status: 'thinking' });
    expect(identity).not.toBeNull();
    if (identity === null) throw new Error('identity should resolve');
    const first = sup.startSubagent(identity, '2026-07-10T00:00:01.000Z', 'tool-1');
    const second = sup.startSubagent(identity, '2026-07-10T00:00:02.000Z', 'tool-1');
    expect(first).not.toBe(second);
    expect(sup.snapshot()).toHaveLength(3);
    const closeSecond = sup.endSubagent(identity.key, '2026-07-10T00:00:03.000Z', 'tool-1');
    expect(closeSecond.closedByKey).toBe(true);
    const closeFirst = sup.endSubagent(identity.key, '2026-07-10T00:00:04.000Z', 'tool-1');
    expect(closeFirst.closedByKey).toBe(true);
    const remaining = sup
      .snapshot()
      .filter((e) => e.parentKey === identity.key)
      .filter((e) => e.status !== 'done');
    expect(remaining).toHaveLength(0);
  });

  test('a discovery that returns rows keeps the PID slot acquired', async () => {
    const rows: readonly ProcessRow[] = [{ pid: 42, ppid: 1, command: 'sh' }];
    const discovery: ProcessDiscovery = { list: () => Promise.resolve(rows) };
    const sup = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery });
    expect(await sup.start()).toBe(true);
    const second = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
    expect(await second.start()).toBe(false);
    await sup.stop();
  });
});

describe('discovery is observable in the supervisor', () => {
  test('rows from a ProcessDiscovery land in discoveredSnapshot', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'hookorama-discovery-'));
    const pidPath = join(workDir, 'supervisor.pid');
    try {
      const rows: readonly ProcessRow[] = [
        { pid: 42, ppid: 1, command: 'sh' },
        { pid: 99, ppid: 0, command: 'kernel-worker' },
      ];
      const discovery: ProcessDiscovery = { list: () => Promise.resolve(rows) };
      const sup = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery });
      expect(await sup.start()).toBe(true);
      const seen = (sup as unknown as { store: StateStore }).store.discoveredSnapshot();
      expect(seen).toHaveLength(2);
      expect(seen.find((r) => r.pid === 42)?.command).toBe('sh');
      expect(seen.find((r) => r.pid === 99)?.ppid).toBe(0);
      await sup.stop();
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

describe('three or more concurrent subagents sharing a toolUseId', () => {
  test('each can be closed independently', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'hookorama-subagents-multi-'));
    const pidPath = join(workDir, 'supervisor.pid');
    try {
      const sup = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
      sup.setOpenTerminals([{ pid: 7, cwd: '/p' }]);
      const identity = sup.applyHook({ pidChain: [7], cwd: '/p', status: 'thinking' });
      expect(identity).not.toBeNull();
      if (identity === null) throw new Error('identity should resolve');
      const k1 = sup.startSubagent(identity, '2026-07-10T00:00:01.000Z', 'tool-shared');
      const k2 = sup.startSubagent(identity, '2026-07-10T00:00:01.500Z', 'tool-shared');
      const k3 = sup.startSubagent(identity, '2026-07-10T00:00:02.000Z', 'tool-shared');
      expect(new Set([k1, k2, k3]).size).toBe(3);
      expect(sup.snapshot()).toHaveLength(4);
      for (const _ of [k1, k2, k3]) {
        const result = sup.endSubagent(identity.key, '2026-07-10T00:00:03.000Z', 'tool-shared');
        expect(result.closedByKey).toBe(true);
      }
      const remaining = sup
        .snapshot()
        .filter((e) => e.parentKey === identity.key)
        .filter((e) => e.status !== 'done');
      expect(remaining).toHaveLength(0);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

describe('acquirePidSlot EEXIST race', () => {
  test('returns acquired:false (not throw) when writeFile races a competing winner', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'hookorama-pid-race-'));
    const pidPath = join(workDir, 'supervisor.pid');
    try {
      const { acquirePidSlot } = await import('./lifecycle/pid-file.js');
      const myPid = process.pid;
      const winner = await acquirePidSlot({ path: pidPath }, myPid);
      expect(winner).toEqual({ acquired: true });
      const loser = await acquirePidSlot({ path: pidPath }, myPid + 1);
      expect(loser.acquired).toBe(false);
      if (!loser.acquired) {
        expect(loser.existingPid).toBe(myPid);
      }
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

describe('closeSubagentByKey idempotency', () => {
  test('returns false when called on an already-terminal subagent', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'hookorama-subagent-idemp-'));
    const pidPath = join(workDir, 'supervisor.pid');
    try {
      const sup = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
      sup.setOpenTerminals([{ pid: 7, cwd: '/p' }]);
      const identity = sup.applyHook({ pidChain: [7], cwd: '/p', status: 'thinking' });
      expect(identity).not.toBeNull();
      if (identity === null) throw new Error('identity should resolve');
      const childKey = sup.startSubagent(identity, '2026-07-10T00:00:01.000Z', 'tool-1');
      const first = sup.endSubagent(identity.key, '2026-07-10T00:00:02.000Z', 'tool-1');
      expect(first.closedByKey).toBe(true);
      const second = sup.endSubagent(identity.key, '2026-07-10T00:00:03.000Z', 'tool-1');
      expect(second.closedByKey).toBe(false);
      expect(childKey).toBeTruthy();
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
