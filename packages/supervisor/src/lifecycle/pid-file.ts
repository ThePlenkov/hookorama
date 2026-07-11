/**
 * Lifecycle: PID file, idempotent auto‑start, signal handling.
 *
 * The supervisor writes its PID to a platform‑specific path
 * (XDG runtime dir on Linux, per‑user Application Support on
 * macOS, %LOCALAPPDATA% on Windows) and refuses to start a
 * second instance while that file exists and points at a live
 * process.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir, platform, tmpdir } from 'node:os';
import { isProcessRunning } from './pid.js';

export interface PidPath {
  readonly path: string;
}

export interface LifecycleOptions {
  readonly product: 'hookorama-supervisor';
  readonly customPath?: string;
}

/**
 * Compute the platform‑appropriate PID file path.
 *
 * Linux:  `$XDG_RUNTIME_DIR/hookorama/supervisor.pid` or
 *         `~/.cache/hookorama/supervisor.pid` if XDG_RUNTIME_DIR
 *         is unset.
 * macOS:  `~/Library/Application Support/dev.hookorama/supervisor.pid`.
 * Windows: `%LOCALAPPDATA%\hookorama\supervisor.pid`.
 *
 * Override with `customPath` for tests.
 */
export function pidFilePath(opts: LifecycleOptions): PidPath {
  if (opts.customPath !== undefined) {
    return { path: opts.customPath };
  }
  switch (platform()) {
    case 'linux': {
      const xdg = process.env['XDG_RUNTIME_DIR'];
      const base = xdg !== undefined && xdg.length > 0 ? xdg : join(homedir(), '.cache');
      return { path: join(base, 'hookorama', 'supervisor.pid') };
    }
    case 'darwin':
      return {
        path: join(homedir(), 'Library', 'Application Support', 'dev.hookorama', 'supervisor.pid'),
      };
    case 'win32': {
      const local = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
      return { path: join(local, 'hookorama', 'supervisor.pid') };
    }
    default:
      return { path: join(tmpdir(), 'hookorama-supervisor.pid') };
  }
}

/**
 * Acquire the PID file slot.
 *
 * Returns `{ acquired: false, existingPid }` when another live
 * supervisor already owns the slot; returns `{ acquired: true }`
 * when the caller has written its PID (including after replacing
 * a stale PID file whose owner was dead).
 *
 * Atomic on POSIX because `writeFile` with `flag: 'wx'` does an
 * O_CREAT|O_EXCL dance when the parent directory exists. If a
 * stale PID file (owner dead) is present, it is removed before
 * the new write so a daemon can restart after a crash.
 */
export async function acquirePidSlot(
  target: PidPath,
  myPid: number,
): Promise<{ acquired: true } | { acquired: false; existingPid: number }> {
  const resolvedPath = resolve(target.path);
  const parentDir = dirname(resolvedPath);
  await mkdir(parentDir, { recursive: true });
  if (existsSync(resolvedPath)) {
    const raw = await readFile(resolvedPath, 'utf8').catch(() => '');
    const existing = Number(raw.trim());
    if (Number.isFinite(existing) && isProcessRunning(existing)) {
      return { acquired: false, existingPid: existing };
    }
    await rm(resolvedPath, { force: true });
  }
  try {
    await writeFile(resolvedPath, `${myPid}\n`, { flag: 'wx' });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'EEXIST') {
      const raw = await readFile(resolvedPath, 'utf8').catch(() => '');
      const existing = Number(raw.trim());
      return { acquired: false, existingPid: Number.isFinite(existing) ? existing : 0 };
    }
    throw err;
  }
  return { acquired: true };
}

/**
 * Release the PID file. Idempotent: removing a non‑existent
 * file is not an error.
 */
export async function releasePidSlot(target: PidPath): Promise<void> {
  await rm(resolve(target.path), { force: true });
}
