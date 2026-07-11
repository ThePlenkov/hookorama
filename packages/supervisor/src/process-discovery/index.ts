/**
 * Process discovery — walk the OS process table and return a
 * snapshot the supervisor uses to seed its live state on
 * startup and to back the extension's `pidChain` resolution.
 *
 * The supervisor never spawns or terminates processes here; it
 * only reads. Each platform ships its own walker behind the
 * same interface. The walkers use `node:child_process` and
 * `node:fs/promises` so the package is runtime‑neutral and the
 * test runner (vitest under Node) can exercise them.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
}

export interface ProcessDiscovery {
  list(): Promise<readonly ProcessRow[]>;
}

function spawnLines(cmd: readonly string[]): Promise<readonly string[]> {
  const head = cmd[0];
  if (head === undefined) {
    return Promise.reject(new Error('spawnLines: empty command'));
  }
  return new Promise<readonly string[]>((resolve, reject) => {
    const child = spawn(head, cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err.push(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`spawn ${cmd.join(' ')} failed: ${Buffer.concat(err).toString()}`));
        return;
      }
      const text = decodeStdout(Buffer.concat(out));
      resolve(
        text
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      );
    });
  });
}

/**
 * Decode a child-process stdout buffer to text. Windows `wmic`
 * emits UTF-16LE (with a leading BOM) by default; treating that
 * as UTF-8 corrupts the first row's header so `parseWmicCsv`
 * returns an empty list. Sniff the BOM and fall back to
 * `utf16le` when present; default to UTF-8 otherwise.
 */
export function decodeStdout(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString('utf16le').replace(/^\uFEFF/, '');
  }
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}

/**
 * Linux walker: parses `/proc/<pid>/stat`. No shell, no external
 * commands.
 */
export class LinuxProcDiscovery implements ProcessDiscovery {
  async list(): Promise<readonly ProcessRow[]> {
    const entries: ProcessRow[] = [];
    const names = await readDirNames('/proc');
    for (const name of names) {
      if (!/^\d+$/.test(name)) continue;
      const pid = Number(name);
      const statPath = `/proc/${pid}/stat`;
      const commPath = `/proc/${pid}/comm`;
      let stat: string;
      try {
        stat = await readFile(statPath, 'utf8');
      } catch {
        continue;
      }
      const row = parseStat(stat);
      if (row === null) continue;
      let command = '';
      try {
        command = (await readFile(commPath, 'utf8')).trim();
      } catch {
        // ignore — comm is optional
      }
      entries.push({ pid, ppid: row.ppid, command });
    }
    return entries;
  }
}

async function readDirNames(dir: string): Promise<readonly string[]> {
  const { readdir } = await import('node:fs/promises');
  return readdir(dir);
}

export function parseStat(stat: string): { ppid: number } | null {
  // `/proc/<pid>/stat` layout: pid (comm) state ppid ...
  // The comm field is wrapped in parens and may contain spaces
  // and parens, so we split from the right.
  const lastParen = stat.lastIndexOf(')');
  if (lastParen === -1) return null;
  const after = stat.slice(lastParen + 1).trim();
  const fields = after.split(/\s+/);
  // PPID 0 is legal on Linux — kernel threads and init/swapper
  // (PID 1 on some distros) report it. Only reject NaN.
  const ppid = Number(fields[1]);
  if (!Number.isFinite(ppid)) return null;
  return { ppid };
}

/**
 * macOS walker: shells out to `ps -axo pid=,ppid=,comm=`. The
 * `=` suffixes suppress headers; we parse by whitespace.
 */
export class MacPsDiscovery implements ProcessDiscovery {
  async list(): Promise<readonly ProcessRow[]> {
    const lines = await spawnLines(['ps', '-axo', 'pid=,ppid=,comm=']);
    const rows: ProcessRow[] = [];
    for (const line of lines) {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      if (match === null) continue;
      const pid = Number(match[1] ?? '');
      const ppid = Number(match[2] ?? '');
      if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
      rows.push({ pid, ppid, command: match[3] ?? '' });
    }
    return rows;
  }
}

/**
 * Windows walker: shells out to `wmic process get
 * ProcessId,ParentProcessId,Name /FORMAT:CSV`. The CSV always
 * prepends a leading `Node` column (the hostname), so the
 * header is `Node,Name,ParentProcessId,ProcessId`. We map by
 * header name rather than position so column reordering does
 * not silently corrupt the output. `wmic` is deprecated on
 * recent Windows; if it fails the caller sees an empty list and
 * the supervisor falls back to extension‑reported terminal
 * identity.
 */
export class WindowsWmicDiscovery implements ProcessDiscovery {
  async list(): Promise<readonly ProcessRow[]> {
    let lines: readonly string[];
    try {
      lines = await spawnLines([
        'wmic',
        'process',
        'get',
        'ProcessId,ParentProcessId,Name',
        '/FORMAT:CSV',
      ]);
    } catch {
      return [];
    }
    return parseWmicCsv(lines);
  }
}

/**
 * Parse the CSV output of `wmic process get ... /FORMAT:CSV`.
 *
 * The header always starts with `Node` (the hostname) followed
 * by the requested columns in the order the operator typed them.
 * Parsing by header name keeps us correct regardless of column
 * order, so future query reordering does not silently corrupt
 * the output.
 *
 * Exported for unit testing.
 */
export function parseWmicCsv(lines: readonly string[]): readonly ProcessRow[] {
  if (lines.length < 2) return [];
  const header = lines[0]?.split(',') ?? [];
  const idxName = header.indexOf('Name');
  const idxPpid = header.indexOf('ParentProcessId');
  const idxPid = header.indexOf('ProcessId');
  if (idxName < 0 || idxPpid < 0 || idxPid < 0) return [];
  const rows: ProcessRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const name = cols[idxName] ?? '';
    const ppid = Number(cols[idxPpid]);
    const pid = Number(cols[idxPid]);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    rows.push({ pid, ppid, command: name });
  }
  return rows;
}

export type SupportedPlatform = 'linux' | 'darwin' | 'win32';

/**
 * Pick the discovery walker for the current platform. Linux,
 * macOS, and Windows are supported. Anything else (BSD, others)
 * returns `null` and the supervisor logs that process discovery is
 * not available for this platform.
 */
export function pickDiscovery(platform: string): ProcessDiscovery | null {
  switch (platform) {
    case 'linux':
      return new LinuxProcDiscovery();
    case 'darwin':
      return new MacPsDiscovery();
    case 'win32':
      return new WindowsWmicDiscovery();
    default:
      return null;
  }
}
