import { describe, expect, test } from 'vitest';
import { normaliseCwd, resolveIdentity, type OpenTerminal } from './resolve.js';

const TERMINALS: readonly OpenTerminal[] = [
  { pid: 100, cwd: '/Users/alice/projects/hookorama' },
  { pid: 200, cwd: '/Users/alice/projects/other' },
];

describe('resolveIdentity', () => {
  test('prefers pid when it matches an open terminal', () => {
    const result = resolveIdentity([100], '/Users/alice/projects/other', TERMINALS);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('pid');
    expect(result?.key).toBe('pid:100');
    expect(result?.pid).toBe(100);
    expect(result?.cwd).toBe('/Users/alice/projects/hookorama');
  });

  test('falls back to cwd when no pid matches', () => {
    const result = resolveIdentity([999], '/Users/alice/projects/lone', TERMINALS);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('cwd');
    expect(result?.key).toBe('cwd:/Users/alice/projects/lone');
    expect(result?.pid).toBeUndefined();
  });

  test('walks pidChain and picks the first match', () => {
    const result = resolveIdentity([1, 2, 200, 3], undefined, TERMINALS);
    expect(result?.kind).toBe('pid');
    expect(result?.pid).toBe(200);
  });

  test('returns null when both pidChain and cwd are missing', () => {
    expect(resolveIdentity(undefined, undefined, TERMINALS)).toBeNull();
    expect(resolveIdentity([], '', TERMINALS)).toBeNull();
  });

  test('ignores invalid pids in the chain', () => {
    const result = resolveIdentity([0, -1, NaN, 100], undefined, TERMINALS);
    expect(result?.pid).toBe(100);
  });

  test('session_id is never used as a key (smoke check)', () => {
    const result = resolveIdentity([100], undefined, TERMINALS);
    expect(result?.key).not.toContain('session');
  });
});

describe('normaliseCwd', () => {
  test('strips trailing slashes', () => {
    expect(normaliseCwd('/a/b/')).toBe('/a/b');
    expect(normaliseCwd('/a/b\\')).toBe('/a/b');
  });

  test('lowercases Windows drive letters and canonicalises separators', () => {
    expect(normaliseCwd('C:\\Users\\Alice')).toBe('c:/Users/Alice');
    expect(normaliseCwd('C:/Users/Alice')).toBe('c:/Users/Alice');
    expect(normaliseCwd('c:\\Users\\Alice')).toBe('c:/Users/Alice');
  });

  test('preserves Windows drive roots so they do not collapse with drive-relative paths', () => {
    expect(normaliseCwd('C:/')).toBe('c:/');
    expect(normaliseCwd('C:\\')).toBe('c:/');
    expect(normaliseCwd('c:/')).toBe('c:/');
  });

  test('leaves POSIX paths untouched', () => {
    expect(normaliseCwd('/Users/alice/Projects/Hookorama')).toBe('/Users/alice/Projects/Hookorama');
  });

  test('returns the empty string unchanged', () => {
    expect(normaliseCwd('')).toBe('');
  });
});
