/**
 * `process.kill(pid, 0)` cross‑platform "is this PID alive?"
 * probe. On POSIX it returns `true` for any process the caller
 * could signal (including zombies). On Windows, `process.kill`
 * throws `EPERM` for live but inaccessible PIDs (which we
 * treat as alive so a supervisor we cannot signal still
 * blocks a second instance) and `ESRCH` for dead PIDs
 * (which we treat as dead so the stale PID file is reclaimable).
 */

export function isProcessRunning(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (err === null || typeof err !== 'object') return false;
    return (err as { code?: string }).code === 'EPERM';
  }
}
