/**
 * Tests for the surface definitions and their measurement.
 *
 * Pure measurement lives here; the ratchet that compares a measurement to a
 * baseline is tested in `lines-check.test.ts`. Anything that needs a real
 * filesystem is in this file, which is the practical half of the same split.
 */

import { describe, it, expect } from 'vitest';
import {
  countLines,
  measureSurfaces,
  getLinesConfigFingerprint,
  assertSurfaceName,
  trackedSurfaceNames,
  LINES_IMPL_VERSION,
} from './lines-surfaces.js';
import { UsageError } from '../utils/errors.js';

async function withTmpDir(run: (tmp: string) => Promise<void>): Promise<void> {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const tmp = await mkdtemp(join(tmpdir(), 'lines-surfaces-test-'));
  try {
    await run(tmp);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

describe('countLines', () => {
  it('counts newline-terminated lines like wc -l', () => {
    expect(countLines('a\nb\nc\n')).toBe(3);
  });

  it('counts a final unterminated line', () => {
    expect(countLines('a\nb\nc')).toBe(3);
  });

  it('counts an empty file as zero lines', () => {
    expect(countLines('')).toBe(0);
  });
});

describe('measureSurfaces', () => {
  it('sums rules/*.md counts and measures CURRENT.md individually', async () => {
    await withTmpDir(async tmp => {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await mkdir(join(tmp, '.claude/rules'), { recursive: true });
      await writeFile(join(tmp, '.claude/rules/00-a.md'), 'one\ntwo\n');
      await writeFile(join(tmp, '.claude/rules/01-b.md'), 'one\ntwo\nthree\n');
      // Non-markdown files in the rules dir must not count toward the budget.
      await writeFile(join(tmp, '.claude/rules/notes.txt'), 'x\n'.repeat(50));
      await writeFile(join(tmp, 'CURRENT.md'), 'status\n');

      expect(measureSurfaces(tmp)).toEqual({
        rules: { lines: 5, bytes: 22, fileCount: 2 },
        current: { lines: 1, bytes: 7, fileCount: 1 },
      });
    });
  });

  it('counts bytes as UTF-8, not as characters', async () => {
    // The whole point of the dimension is measuring what is actually loaded.
    // A multi-byte character costs its bytes, and `.length` would under-report.
    await withTmpDir(async tmp => {
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await mkdir(join(tmp, '.claude/rules'), { recursive: true });
      await writeFile(join(tmp, '.claude/rules/00-a.md'), 'x\n');
      // "— ✓" is 3 characters but 8 bytes: em-dash 3 + space 1 + check 3 + newline 1.
      await writeFile(join(tmp, 'CURRENT.md'), '— ✓\n');

      const result = measureSurfaces(tmp);
      expect(result.current.lines).toBe(1);
      expect(result.current.bytes).toBe(8);
    });
  });

  it('reports zero matched files for missing surfaces instead of throwing', async () => {
    await withTmpDir(async tmp => {
      expect(measureSurfaces(tmp)).toEqual({
        rules: { lines: 0, bytes: 0, fileCount: 0 },
        current: { lines: 0, bytes: 0, fileCount: 0 },
      });
    });
  });
});

describe('getLinesConfigFingerprint', () => {
  it('contains exactly the measurement-affecting inputs', () => {
    // The fingerprint IS the drift contract: implementation version, the
    // surface set, and each surface's glob. Adding a surface or moving a
    // glob must invalidate baselines.
    expect(getLinesConfigFingerprint()).toEqual({
      implVersion: LINES_IMPL_VERSION,
      surfaces: ['rules', 'current'],
      dimensions: ['lines', 'bytes'],
      globs: {
        rules: '.claude/rules/*.md',
        current: 'CURRENT.md',
      },
    });
  });
});

describe('assertSurfaceName', () => {
  it('accepts a tracked surface', () => {
    expect(assertSurfaceName('rules')).toBe('rules');
  });

  it('rejects an unknown surface by name, listing the valid ones', () => {
    // A typo'd --surface must not silently refresh nothing and report success.
    expect(() => assertSurfaceName('rulez')).toThrow('Unknown surface "rulez"');
    expect(() => assertSurfaceName('rulez')).toThrow('rules, current');
  });

  it('rejects it as a UsageError, so the CLI prints one line and no stack', () => {
    expect(() => assertSurfaceName('rulez')).toThrow(UsageError);
  });
});

describe('trackedSurfaceNames', () => {
  it('returns the canonical set when the baseline holds exactly it', () => {
    expect(trackedSurfaceNames({ rules: {}, current: {} })).toEqual(['rules', 'current']);
  });

  it('includes a canonical surface the baseline does not carry', () => {
    // The whole point: iterating the baseline alone would drop `current`
    // entirely, and a surface nobody iterates is a surface nobody gates.
    expect(trackedSurfaceNames({ rules: {} })).toEqual(['rules', 'current']);
  });

  it('appends stray baseline keys after the canonical ones, without duplicating', () => {
    expect(trackedSurfaceNames({ current: {}, retired: {} })).toEqual([
      'rules',
      'current',
      'retired',
    ]);
  });

  it('returns the canonical set for an empty baseline', () => {
    expect(trackedSurfaceNames({})).toEqual(['rules', 'current']);
  });
});

describe('measureSurfaces — byte counting is the file, not a re-encoding', () => {
  it('counts the real on-disk size of a file holding an invalid UTF-8 byte', async () => {
    // Decoding to a string and re-encoding substitutes U+FFFD (3 bytes) for the
    // lone 0xFF (1 byte), so the old path reported MORE bytes than the file has.
    // Reading the Buffer once is what makes the module's "exact" claim true.
    await withTmpDir(async tmp => {
      const { mkdir, writeFile, stat } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await mkdir(join(tmp, '.claude/rules'), { recursive: true });
      await writeFile(join(tmp, '.claude/rules/00-a.md'), Buffer.from([0x61, 0xff, 0x0a]));
      await writeFile(join(tmp, 'CURRENT.md'), 'status\n');

      const onDisk = (await stat(join(tmp, '.claude/rules/00-a.md'))).size;
      expect(onDisk).toBe(3);
      expect(measureSurfaces(tmp).rules.bytes).toBe(onDisk);
    });
  });
});
