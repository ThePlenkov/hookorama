#!/usr/bin/env bun
/**
 * reindex-memory.ts — builds .agents/memory/index.tsv.
 *
 * Walks .agents/memory/{facts,retros,lessons}/*.md, parses the
 * YAML frontmatter between the first pair of `---` lines, validates
 * required fields, and emits a TSV index.
 */

import { resolve } from 'node:path';
import { Glob } from 'bun';

const REPO_ROOT = resolve(import.meta.dir, '..');
const MEMORY_DIR = resolve(REPO_ROOT, '.agents/memory');
const OUT = resolve(MEMORY_DIR, 'index.tsv');

const REQUIRED = ['id', 'type', 'tags', 'created', 'summary'] as const;

interface Entry {
  path: string;
  id: string;
  type: string;
  tags: string[];
  created: string;
  summary: string;
}

function parseFrontmatter(text: string): Record<string, string> | null {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return null;
  const block = lines.slice(1, end);
  const out: Record<string, string> = {};
  let i = 0;
  while (i < block.length) {
    const line = block[i]!;
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1]!;
    let value = m[2] ?? '';
    if (value === '' || value === '|' || value === '>') {
      const collected: string[] = [];
      i++;
      while (i < block.length && (/^\s+/.test(block[i]!) || block[i]!.trim() === '')) {
        collected.push(block[i]!.trim());
        i++;
      }
      value = collected.join(' ').trim();
      out[key] = value;
      continue;
    }
    out[key] = value.trim();
    i++;
  }
  return out;
}

function sanitize(s: string): string {
  return s.replace(/[\t\r\n]+/g, ' ').trim();
}

async function main(): Promise<number> {
  const entries: Entry[] = [];
  const failures: string[] = [];
  const seenIds = new Map<string, string>();

  for (const sub of ['facts', 'retros', 'lessons']) {
    const dir = resolve(MEMORY_DIR, sub);
    const glob = new Glob('*.md');
    for await (const file of glob.scan({ cwd: dir })) {
      if (file === 'README.md') continue;
      const path = `.agents/memory/${sub}/${file}`;
      const text = await Bun.file(resolve(dir, file)).text();
      const fm = parseFrontmatter(text);
      if (!fm) {
        failures.push(`${path}: no frontmatter`);
        continue;
      }
      for (const k of REQUIRED) {
        if (!(k in fm)) failures.push(`${path}: missing frontmatter field "${k}"`);
      }
      if (failures.length) continue;
      const id = fm.id!;
      const dup = seenIds.get(id);
      if (dup) failures.push(`${path}: duplicate id "${id}" (already in ${dup})`);
      seenIds.set(id, path);
      let tags: string[] = [];
      const rawTags = fm.tags!.replace(/^\[/, '').replace(/\]$/, '').trim();
      if (rawTags) {
        tags = rawTags
          .split(',')
          .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
      }
      entries.push({
        path,
        id,
        type: fm.type!,
        tags,
        created: fm.created!,
        summary: sanitize(fm.summary!),
      });
    }
  }

  if (failures.length > 0) {
    console.error('\nreindex-memory: validation failed:\n');
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));

  const lines = ['path\tid\ttype\ttags\tcreated\tsummary'];
  for (const e of entries) {
    lines.push(
      [e.path, e.id, e.type, e.tags.join(','), e.created, e.summary].join('\t'),
    );
  }
  lines.push('');
  await Bun.write(OUT, lines.join('\n'));
  console.log(`reindex-memory: indexed ${entries.length} entries → ${OUT}`);
  return 0;
}

process.exit(await main());