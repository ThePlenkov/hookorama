import { describe, expect, test } from 'vitest';
import { decodeStdout, parseStat, parseWmicCsv } from './index.js';

describe('parseStat', () => {
  test('accepts PPID 0 (kernel threads / swapper)', () => {
    // /proc/<pid>/stat layout: pid (comm) state ppid ...
    // Comm can contain spaces and parens — split from the right.
    const stat = '1 (systemd) S 0 1 1 0 -1 4194560';
    expect(parseStat(stat)).toEqual({ ppid: 0 });
  });

  test('returns null when the comm parens are missing', () => {
    expect(parseStat('1 systemd S 0 1 1 0 -1 4194560')).toBeNull();
  });

  test('returns null when PPID is not a number', () => {
    expect(parseStat('1 (init) S ? 1 1 0 -1 4194560')).toBeNull();
  });
});

describe('parseWmicCsv', () => {
  test('parses rows with the leading Node column', () => {
    const lines = [
      'Node,Name,ParentProcessId,ProcessId',
      'HOST1,explorer.exe,1234,5678',
      'HOST1,cmd.exe,5678,9012',
    ];
    const rows = parseWmicCsv(lines);
    expect(rows).toEqual([
      { pid: 5678, ppid: 1234, command: 'explorer.exe' },
      { pid: 9012, ppid: 5678, command: 'cmd.exe' },
    ]);
  });

  test('ignores rows with non-numeric pid/ppid', () => {
    const lines = [
      'Node,Name,ParentProcessId,ProcessId',
      'HOST1,explorer.exe,foo,5678',
      'HOST1,cmd.exe,5678,bar',
      'HOST1,powershell.exe,1,42',
    ];
    expect(parseWmicCsv(lines)).toEqual([{ pid: 42, ppid: 1, command: 'powershell.exe' }]);
  });

  test('returns empty when the header is missing required columns', () => {
    const lines = ['Node,Name', 'HOST1,explorer.exe'];
    expect(parseWmicCsv(lines)).toEqual([]);
  });

  test('returns empty when there is no data', () => {
    expect(parseWmicCsv(['Node,Name,ParentProcessId,ProcessId'])).toEqual([]);
    expect(parseWmicCsv([])).toEqual([]);
  });

  test('decodeStdout sniffs UTF-16LE and yields parseable wmic lines', () => {
    const text = '\uFEFFNode,Name,ParentProcessId,ProcessId\nHOST1,powershell.exe,1,42\n';
    const buf = Buffer.from(text, 'utf16le');
    const lines = decodeStdout(buf)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    expect(parseWmicCsv(lines)).toEqual([{ pid: 42, ppid: 1, command: 'powershell.exe' }]);
  });

  test('decodeStdout strips a UTF-8 BOM', () => {
    const text = '\uFEFFplain ascii line';
    const buf = Buffer.from(text, 'utf8');
    expect(decodeStdout(buf)).toBe('plain ascii line');
  });
});
