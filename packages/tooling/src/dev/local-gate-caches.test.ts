/**
 * Guards the two local gate caches that were deliberately shaped for
 * correctness over speed (TASK-902, TASK-940).
 *
 * depcruise's `strategy: 'content'` result cache was observed serving a
 * stale green verdict over a real circular import on disk — this test
 * asserts `.dependency-cruiser.cjs` carries no `cache` key, so a future edit
 * cannot silently reintroduce it. `turbo run lint`'s cache key must hash the
 * ROOT `eslint.config.js` through `$TURBO_ROOT$` rather than a bare
 * package-relative entry, which resolves against each package's own
 * directory and matches nothing there — a bare entry would let a rule change
 * report a stale green on every package's lint task.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url);

interface TurboRootConfig {
  tasks: Record<string, { inputs?: string[] }>;
}

describe('depcruise local result cache (TASK-902)', () => {
  it('.dependency-cruiser.cjs options carry no cache key', () => {
    const config = require(path.join(repoRoot, '.dependency-cruiser.cjs')) as {
      options: Record<string, unknown>;
    };
    expect(
      Object.keys(config.options),
      'A `cache` key on .dependency-cruiser.cjs options reintroduces the content-strategy ' +
        'result cache that served a stale green over a real circular import (TASK-902) — ' +
        'depcruise must run uncached.'
    ).not.toContain('cache');
  });
});

describe('turbo lint task inputs (TASK-940)', () => {
  it('keys on the root eslint.config.js via $TURBO_ROOT$, never a bare package-relative entry', () => {
    const turboConfig = JSON.parse(
      readFileSync(path.join(repoRoot, 'turbo.json'), 'utf-8')
    ) as TurboRootConfig;
    const inputs = turboConfig.tasks['lint']?.inputs ?? [];
    expect(
      inputs,
      'turbo.json "lint".inputs must key on the root config via $TURBO_ROOT$/eslint.config.js ' +
        '(TASK-940) — a bare "eslint.config.js" entry resolves package-relative and matches ' +
        "nothing, so an ESLint rule change would report every package's lint task as a stale green."
    ).toContain('$TURBO_ROOT$/eslint.config.js');
    expect(
      inputs,
      'turbo.json "lint".inputs must not carry a bare "eslint.config.js" entry (TASK-940) — ' +
        'it is package-relative and matches nothing at the root, silently un-guarding the cache.'
    ).not.toContain('eslint.config.js');
  });
});
