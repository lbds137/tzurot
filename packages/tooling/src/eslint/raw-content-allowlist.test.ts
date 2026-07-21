import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './no-raw-content-literals.js';
import { RAW_CONTENT_ALLOWLIST, rawContentBudgetTotal } from './raw-content-allowlist.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('allowlist contract (shrink-only)', () => {
  it('never grows past the grandfathered ceiling', () => {
    // Shrinking (migrating copy onto ux/catalog) passes without touching this
    // pin; new raw copy fails it. Lower the ceiling opportunistically when
    // the total drops.
    expect(rawContentBudgetTotal()).toBeLessThanOrEqual(168);
  });

  it('contains no stale entries — every allowlisted file still exists', () => {
    const stale = Object.keys(RAW_CONTENT_ALLOWLIST).filter(
      relPath => !existsSync(path.join(repoRoot, relPath))
    );
    expect(stale).toEqual([]);
  });

  it('lists only positive budgets', () => {
    for (const [file, budget] of Object.entries(RAW_CONTENT_ALLOWLIST)) {
      expect(budget, `${file} has a zero/negative budget — remove the entry`).toBeGreaterThan(0);
    }
  });
});

describe('budgets stay exact (live staleness sweep)', () => {
  // Lint every allowlisted file under an UNLISTED path (same commands-tree
  // marker, so scope applies, but budget 0 → every violation reports) and
  // require the actual count to EQUAL the recorded budget. Under-budget means
  // copy migrated without shrinking the entry — the ratchet only stays a
  // ratchet if every reduction is banked; a leftover budget is headroom for
  // new raw copy to sneak back in. Over-budget files fail `pnpm lint` itself;
  // this sweep is the shrink side.
  const linter = new Linter({ configType: 'flat' });
  const config = [
    {
      files: ['**/*.ts'],
      languageOptions: {
        parser: tseslint.parser as unknown as Linter.Parser,
        ecmaVersion: 2022 as const,
        sourceType: 'module' as const,
      },
      plugins: { test: { rules: { 'no-raw-content-literals': rule } } },
      rules: { 'test/no-raw-content-literals': 'error' as const },
    },
  ];

  it(
    'every allowlisted budget equals the file’s actual raw-literal count',
    { timeout: 30_000 },
    () => {
      const mismatches: string[] = [];
      for (const [relPath, budget] of Object.entries(RAW_CONTENT_ALLOWLIST)) {
        const full = path.join(repoRoot, relPath);
        if (!existsSync(full)) {
          continue; // the existence test reports these with a better message
        }
        const code = readFileSync(full, 'utf-8');
        const actual = linter.verify(
          code,
          config,
          'services/bot-client/src/commands/__staleness__/probe.ts'
        ).length;
        if (actual !== budget) {
          mismatches.push(`${relPath}: budget ${budget}, actual ${actual}`);
        }
      }
      expect(
        mismatches,
        'budget ≠ actual — bank reductions by shrinking the allowlist entry (delete at 0)'
      ).toEqual([]);
    }
  );
});
