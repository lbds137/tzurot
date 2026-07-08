import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateUxLiterals,
  measureUxLiterals,
  parseUxLiteralsBaseline,
  runUxLiteralsCheck,
  runUxLiteralsUpdateBaseline,
  getUxLiteralsConfigFingerprint,
  SCAN_ROOT,
  UX_LITERALS_IMPL_VERSION,
  type UxLiteralsBaseline,
} from './ux-literals-check.js';
import { buildBaselineMeta, hashConfigSlice } from './baseline-meta.js';

/** Build a temp repo-root with a commands tree containing given file contents. */
function makeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ux-literals-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, SCAN_ROOT, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function validMeta() {
  return buildBaselineMeta(
    `ux-literals-check/${UX_LITERALS_IMPL_VERSION}`,
    hashConfigSlice(getUxLiteralsConfigFingerprint())
  );
}

let roots: string[] = [];

beforeEach(() => {
  roots = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

function trackedRoot(files: Record<string, string>): string {
  const root = makeRoot(files);
  roots.push(root);
  return root;
}

describe('measureUxLiterals', () => {
  it('counts both pattern classes across command files', () => {
    const root = trackedRoot({
      'a/one.ts': `reply('❌ Failed to save. Please try again.');`,
      'b/two.ts': `editReply('❌ Not found.'); followUp('please try again later');`,
    });
    const m = measureUxLiterals(root);
    expect(m.byPattern['emoji-prefixed']).toBe(2);
    expect(m.byPattern['try-again']).toBe(2); // case-insensitive
    expect(m.total).toBe(4);
    expect(m.fileCount).toBe(2);
  });

  it('skips test files', () => {
    const root = trackedRoot({
      'a/one.test.ts': `expect(x).toBe('❌ nope');`,
      'a/one.ts': `reply('❌ real');`,
    });
    const m = measureUxLiterals(root);
    expect(m.total).toBe(1);
    expect(m.fileCount).toBe(1);
  });

  it('reports zero files as the hollow-measurement signal', () => {
    const root = mkdtempSync(join(tmpdir(), 'ux-literals-empty-'));
    roots.push(root);
    const m = measureUxLiterals(root);
    expect(m.fileCount).toBe(0);
  });
});

describe('evaluateUxLiterals', () => {
  const baseline: UxLiteralsBaseline = { total: 5, graceMargin: 2 };

  it('passes at or below the limit', () => {
    expect(
      evaluateUxLiterals(
        { total: 7, byPattern: { 'emoji-prefixed': 7, 'try-again': 0 }, fileCount: 3 },
        baseline
      ).status
    ).toBe('ok');
  });

  it('fails above the limit with the adoption steer', () => {
    const outcome = evaluateUxLiterals(
      { total: 8, byPattern: { 'emoji-prefixed': 8, 'try-again': 0 }, fileCount: 3 },
      baseline
    );
    expect(outcome.status).toBe('fail');
    expect(outcome.failures[0]).toContain('ux/catalog');
  });

  it('fails LOUDLY on zero files scanned (never a silent 0-literal pass)', () => {
    const outcome = evaluateUxLiterals(
      { total: 0, byPattern: { 'emoji-prefixed': 0, 'try-again': 0 }, fileCount: 0 },
      baseline
    );
    expect(outcome.status).toBe('fail');
    expect(outcome.failures[0]).toContain('hollow');
  });
});

describe('runUxLiteralsCheck (CLI shell)', () => {
  it('fails when the baseline is missing', () => {
    const root = trackedRoot({ 'a/one.ts': `reply('ok');` });
    expect(runUxLiteralsCheck({ rootDir: root, noFail: true })).toBe('fail');
  });

  it('fails on configHash drift, steering to the refresh command', () => {
    const root = trackedRoot({ 'a/one.ts': `reply('ok');` });
    const baseline: UxLiteralsBaseline = {
      total: 100,
      graceMargin: 10,
      meta: { ...validMeta(), configHash: 'stale-hash-000' },
    };
    writeFileSync(join(root, 'baseline.json'), JSON.stringify(baseline), 'utf-8');
    expect(runUxLiteralsCheck({ rootDir: root, baseline: 'baseline.json', noFail: true })).toBe(
      'fail'
    );
  });

  it('passes end-to-end with a fresh baseline', () => {
    const root = trackedRoot({ 'a/one.ts': `reply('❌ nope');` });
    runUxLiteralsUpdateBaseline({ rootDir: root, baseline: 'baseline.json' });
    expect(runUxLiteralsCheck({ rootDir: root, baseline: 'baseline.json', noFail: true })).toBe(
      'ok'
    );
  });

  it('the ratchet trips when literals grow past the captured baseline + grace', () => {
    const root = trackedRoot({ 'a/one.ts': `reply('❌ nope');` });
    const baseline: UxLiteralsBaseline = { total: 0, graceMargin: 0, meta: validMeta() };
    writeFileSync(join(root, 'baseline.json'), JSON.stringify(baseline), 'utf-8');
    expect(runUxLiteralsCheck({ rootDir: root, baseline: 'baseline.json', noFail: true })).toBe(
      'fail'
    );
  });
});

describe('parseUxLiteralsBaseline', () => {
  it('rejects malformed baselines with a descriptive error', () => {
    expect(() => parseUxLiteralsBaseline('{"graceMargin": 5}', 'x.json')).toThrow(/total/);
    expect(() => parseUxLiteralsBaseline('{"total": 5}', 'x.json')).toThrow(/graceMargin/);
    expect(() => parseUxLiteralsBaseline('null', 'x.json')).toThrow(/not an object/);
  });
});

describe('runUxLiteralsUpdateBaseline', () => {
  it('preserves graceMargin and notes across refreshes', () => {
    const root = trackedRoot({ 'a/one.ts': `reply('❌ nope');` });
    const prev: UxLiteralsBaseline = {
      total: 50,
      graceMargin: 25,
      notes: 'keep me',
      meta: validMeta(),
    };
    writeFileSync(join(root, 'baseline.json'), JSON.stringify(prev), 'utf-8');

    runUxLiteralsUpdateBaseline({ rootDir: root, baseline: 'baseline.json' });

    const updated = parseUxLiteralsBaseline(
      readFileSync(join(root, 'baseline.json'), 'utf-8'),
      'baseline.json'
    );
    expect(updated.total).toBe(1);
    expect(updated.graceMargin).toBe(25);
    expect(updated.notes).toBe('keep me');
    expect(updated.meta?.configHash).toBeDefined();
  });

  it('refuses to bless a hollow measurement', () => {
    const root = mkdtempSync(join(tmpdir(), 'ux-literals-empty-'));
    roots.push(root);
    expect(() => runUxLiteralsUpdateBaseline({ rootDir: root, baseline: 'baseline.json' })).toThrow(
      /zero files/
    );
  });
});
