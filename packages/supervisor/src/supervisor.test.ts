import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Supervisor } from './supervisor.js';

describe('Supervisor', () => {
  let workDir: string;
  let pidPath: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'hookorama-supervisor-'));
    pidPath = join(workDir, 'supervisor.pid');
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  test('start acquires the PID slot when free', async () => {
    const sup = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
    expect(await sup.start()).toBe(true);
    await sup.stop();
  });

  test('start refuses when another supervisor holds the slot', async () => {
    const alpha = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
    expect(await alpha.start()).toBe(true);
    const beta = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
    expect(await beta.start()).toBe(false);
    await alpha.stop();
  });

  test('applyHook upserts a known process and remembers it', () => {
    const sup = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
    sup.setOpenTerminals([{ pid: 7, cwd: '/p' }]);
    const identity = sup.applyHook({
      pidChain: [7],
      cwd: '/p',
      status: 'thinking',
      agent: 'claude',
    });
    expect(identity?.pid).toBe(7);
    expect(sup.snapshot()).toHaveLength(1);
    expect(sup.snapshot()[0]?.agent).toBe('claude');
  });

  test('applyHook returns null when identity is unresolvable', () => {
    const sup = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
    expect(sup.applyHook({ status: 'idle' })).toBeNull();
  });

  test('subagent lifecycle: start, exact end', () => {
    const sup = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
    sup.setOpenTerminals([{ pid: 7, cwd: '/p' }]);
    const identity = sup.applyHook({ pidChain: [7], cwd: '/p', status: 'thinking' });
    if (identity === null) throw new Error('identity should resolve');
    const childKey = sup.startSubagent(identity, '2026-07-10T00:00:01.000Z', 'tool-1');
    expect(sup.snapshot()).toHaveLength(2);
    const exact = sup.endSubagent(identity.key, '2026-07-10T00:00:02.000Z', 'tool-1');
    expect(exact.closedByKey).toBe(true);
    expect(sup.snapshot()).toHaveLength(2);
    const childAfter = sup.snapshot().find((entry: { key: string }) => entry.key === childKey);
    expect(childAfter?.status).toBe('done');
  });

  test('stop is idempotent', async () => {
    const sup = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
    await sup.start();
    await sup.stop();
    await sup.stop();
    expect(sup.isStopping()).toBe(true);
  });

  test('start after stop clears the stopping flag and re-acquires the slot', async () => {
    const sup = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
    expect(await sup.start()).toBe(true);
    await sup.stop();
    expect(sup.isStopping()).toBe(true);
    expect(await sup.start()).toBe(true);
    expect(sup.isStopping()).toBe(false);
    await sup.stop();
    const fresh = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
    expect(await fresh.start()).toBe(true);
    await fresh.stop();
  });

  test('two concurrent start() calls yield a single acquired slot', async () => {
    const sup = new Supervisor({ lifecycle: { customPidPath: pidPath }, discovery: null });
    const results = await Promise.all([sup.start(), sup.start()]);
    expect(results).toEqual([true, true]);
    await sup.stop();
  });
});
