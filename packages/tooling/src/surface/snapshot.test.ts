import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  SNAPSHOT_JSON_PATH,
  SNAPSHOT_MD_PATH,
  buildSnapshotJson,
  evaluateCheck,
  renderSnapshotMarkdown,
  writeSnapshotFiles,
} from './snapshot.js';
import { SURFACE_CATEGORIES, type SurfaceEntry } from './types.js';

function entry(overrides: Partial<SurfaceEntry>): SurfaceEntry {
  return {
    category: 'components',
    file: 'src/x.ts',
    symbol: 'ButtonBuilder',
    count: 1,
    ...overrides,
  };
}

describe('buildSnapshotJson', () => {
  it('produces byte-identical output across calls', () => {
    const entries = [entry({ category: 'flags', symbol: 'Ephemeral' }), entry({ count: 3 })];
    expect(buildSnapshotJson(entries)).toBe(buildSnapshotJson(entries));
  });

  it('parses as JSON with correct totals and sorted entries', () => {
    const entries = [
      entry({ category: 'webhook-options', symbol: 'username' }),
      entry({ category: 'flags', symbol: 'Ephemeral' }),
      entry({ count: 4 }),
    ];
    const doc = JSON.parse(buildSnapshotJson(entries)) as {
      meta: { generator: string; scope: string };
      totals: { entries: number; sites: number };
      entries: SurfaceEntry[];
    };
    expect(doc.meta.generator).toBe('pnpm ops surface:inventory');
    expect(doc.meta.scope).toContain('services/bot-client/src');
    expect(doc.totals.entries).toBe(3);
    expect(doc.totals.sites).toBe(6);
    expect(doc.entries.map(e => e.category)).toEqual(['components', 'flags', 'webhook-options']);
  });

  it('carries no timestamps or elapsed-time tokens in the bytes', () => {
    const bytes = buildSnapshotJson([entry({})]);
    expect(bytes.includes('generatedAt')).toBe(false);
    expect(bytes.toLowerCase().includes('elapsed')).toBe(false);
  });

  it('emits a zero-total document for an empty inventory', () => {
    const doc = JSON.parse(buildSnapshotJson([])) as { totals: { entries: number; sites: number } };
    expect(doc.totals).toEqual({ entries: 0, sites: 0 });
  });
});

describe('renderSnapshotMarkdown', () => {
  it('contains the preamble markers, including the routing lines', () => {
    const md = renderSnapshotMarkdown([entry({})]);
    expect(md).toContain('services/bot-client/src');
    expect(md).toContain('groups 4 (voice) and 7 (snowflakes) are semantic and stay manual');
    expect(md).toContain('`unclassified` category is required and never dropped');
    expect(md).toContain('unmapped constructions and object-literal keys');
    expect(md).toContain('methods and property accesses land in `client-methods`');
    expect(md).toContain('`discord-enums` under container-qualified names');
    expect(md).toContain('`message-options` (the MESSAGE_OPTION_KEYS vocabulary)');
    expect(md).toContain('string-literal URLs only');
  });

  it('renders every category heading even when empty', () => {
    const md = renderSnapshotMarkdown([entry({ category: 'flags', symbol: 'Ephemeral' })]);
    for (const category of SURFACE_CATEGORIES) {
      expect(md).toContain(`## ${category}`);
    }
    expect(md).toContain('(no entries)');
    expect(md).toContain('| src/x.ts | Ephemeral | 1 |');
  });

  it('ends with the totals line', () => {
    const md = renderSnapshotMarkdown([entry({}), entry({ symbol: 'ModalBuilder', count: 2 })]);
    expect(md.trimEnd().endsWith('Total: 2 entries across 3 sites.')).toBe(true);
  });
});

describe('evaluateCheck + writeSnapshotFiles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surface-snapshot-'));
  const unreadableDir = mkdtempSync(join(tmpdir(), 'surface-snapshot-unreadable-'));
  const mixedDir = mkdtempSync(join(tmpdir(), 'surface-snapshot-mixed-'));

  afterAll(() => {
    // Test-created temp paths only (mkdtemp above) — removed after the suite.
    rmSync(dir, { recursive: true, force: true });
    // recursive+force removes the directory planted AT the snapshot path too.
    rmSync(unreadableDir, { recursive: true, force: true });
    rmSync(mixedDir, { recursive: true, force: true });
  });

  it('reports missing files as drift', () => {
    const result = evaluateCheck(dir, [entry({})]);
    expect(result.ok).toBe(false);
    expect(
      result.drifted.some(line => line.includes(SNAPSHOT_JSON_PATH) && line.includes('missing'))
    ).toBe(true);
    expect(
      result.drifted.some(line => line.includes(SNAPSHOT_MD_PATH) && line.includes('missing'))
    ).toBe(true);
    expect(result.hint).toContain('surface:inventory --write');
  });

  it('names the read-error code and drops the write hint when a snapshot path is unreadable', () => {
    // A directory at the snapshot path makes readFileSync throw EISDIR — a
    // real non-ENOENT read failure with a dependency-free setup. The md file
    // is written MATCHING so this stays a pure only-unreadable state: a
    // missing md would be drift of its own and tip the hint into mixed.
    mkdirSync(join(unreadableDir, SNAPSHOT_JSON_PATH), { recursive: true });
    writeFileSync(join(unreadableDir, SNAPSHOT_MD_PATH), renderSnapshotMarkdown([entry({})]));
    const result = evaluateCheck(unreadableDir, [entry({})]);
    expect(result.ok).toBe(false);
    expect(result.drifted).toEqual([`${SNAPSHOT_JSON_PATH} (EISDIR)`]);
    // Only-unreadable state: the read-error instruction, never the write hint.
    expect(result.hint).toContain('could not be read');
    expect(result.hint).not.toContain('--write');
  });

  it('gives both instructions when one snapshot file is unreadable and the other drifted', () => {
    // Mixed state: the JSON path is a directory (EISDIR → unreadable) while
    // the md file exists with drifted bytes — fixing only one still leaves
    // the gate red, so the hint must carry BOTH instructions.
    mkdirSync(join(mixedDir, SNAPSHOT_JSON_PATH), { recursive: true });
    writeFileSync(join(mixedDir, SNAPSHOT_MD_PATH), 'drifted md bytes');
    const result = evaluateCheck(mixedDir, [entry({})]);
    expect(result.ok).toBe(false);
    expect(result.drifted).toContain(`${SNAPSHOT_JSON_PATH} (EISDIR)`);
    expect(result.drifted).toContain(SNAPSHOT_MD_PATH);
    expect(result.hint).toContain('could not be read');
    expect(result.hint).toContain('surface:inventory --write');
  });

  it('passes when the committed bytes match the generator output', () => {
    writeSnapshotFiles(dir, buildSnapshotJson([entry({})]), renderSnapshotMarkdown([entry({})]));
    const result = evaluateCheck(dir, [entry({})]);
    expect(result.ok).toBe(true);
    expect(result.drifted).toEqual([]);
  });

  it('fails on a one-byte mutation of the committed JSON', () => {
    writeSnapshotFiles(dir, buildSnapshotJson([entry({})]), renderSnapshotMarkdown([entry({})]));
    const jsonPath = join(dir, SNAPSHOT_JSON_PATH);
    const original = readFileSync(jsonPath, 'utf-8');
    writeFileSync(jsonPath, original.replace('"count": 1', '"count": 2'));
    const result = evaluateCheck(dir, [entry({})]);
    expect(result.ok).toBe(false);
    expect(result.drifted).toContain(SNAPSHOT_JSON_PATH);
    // Only-drift state (readable file, drifted bytes): the write hint applies.
    expect(result.hint).toContain('surface:inventory --write');
    expect(result.hint).not.toContain('could not be read');
  });
});
