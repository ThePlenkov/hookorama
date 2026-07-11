#!/usr/bin/env bun
// check-files.ts — enforces sibling-README under packages/.
// Walks git-tracked packages files (`.ts`, `.tsx`, `.json`)
// and asserts each has a sibling README.md or is allowlisted.
// Globs are passed via `git ls-files` so PowerShell does not
// expand them.

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

const REPO_ROOT = resolve(import.meta.dir, '..');

const ALLOWLIST = new Set<string>([
  'package.json',
  'tsconfig.json',
  'vitest.config.ts',
  'tsdown.config.ts',
]);

function listFiles(): string[] {
  const r = spawnSync(
    'git',
    ['ls-files', '--', 'packages/**/*.ts', 'packages/**/*.tsx', 'packages/**/*.json'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  if (r.status !== 0) {
    console.error('git ls-files failed:', r.stderr);
    process.exit(2);
  }
  return r.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => p.replaceAll('\\', '/'));
}

// Paths that never need a sibling README. Files inside
// `packages/<name>/src/` are documented by the package's
// top-level README.md and (when relevant) by an src/README.md.
// The check still flags every .ts, .tsx, and .json file outside
// `packages/<name>/src/` that is not in the file-level
// allowlist. The match is anchored to "any `src/` segment
// immediately under `packages/<name>/`" — it does not skip
// directories like `src-snapshot/` or other names that merely
// contain `src`.
function isInPackageSrc(path: string): boolean {
  return /^packages\/[^/]+\/src\//.test(path);
}

async function main(): Promise<number> {
  const paths = listFiles();
  const violations: string[] = [];

  for (const path of paths) {
    const base = path.split('/').pop()!;
    if (ALLOWLIST.has(base)) continue;
    if (base === 'index.ts' && path.endsWith('/src/index.ts')) continue;
    if (isInPackageSrc(path)) continue;
    const readme = resolve(REPO_ROOT, dirname(path), 'README.md');
    if (!existsSync(readme)) {
      violations.push(`${path} (missing sibling README.md)`);
    }
  }

  if (violations.length > 0) {
    console.error(`\ncheck-files: ${violations.length} file(s) without sibling README.md:\n`);
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      `\nFix: add a README.md next to the file (governed by .agents/rules/package-readme.md.rule).`,
    );
    return 1;
  }

  console.log(`check-files: OK (${paths.length} files matched)`);
  return 0;
}

process.exit(await main());
