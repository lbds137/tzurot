import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { invokesTsc, findBuildScriptViolations } from './check-build-scripts.js';

/**
 * Flipped on for the ordering test only. `readdirSync` happens to return
 * alphabetical order on the dev filesystem, so a sort assertion over real
 * directory entries passes whether or not the sort exists — it has to be fed
 * a deliberately reversed listing to mean anything.
 */
let reverseReaddir = false;

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: (...args: Parameters<typeof actual.readdirSync>) => {
      const entries = actual.readdirSync(...args);
      return reverseReaddir ? [...entries].reverse() : entries;
    },
  };
});

describe('invokesTsc', () => {
  it('detects a bare tsc invocation', () => {
    expect(invokesTsc('tsc')).toBe(true);
  });

  it('detects tsc with flags', () => {
    expect(invokesTsc('tsc -b')).toBe(true);
    expect(invokesTsc('tsc --build')).toBe(true);
  });

  it('detects tsc as a later step in a compound script', () => {
    expect(invokesTsc('node scripts/gen.js && tsc')).toBe(true);
    expect(invokesTsc('rm -rf dist tsconfig.tsbuildinfo && tsc')).toBe(true);
    expect(invokesTsc('rm -rf dist && tsc')).toBe(true);
    expect(invokesTsc('tsc; echo done')).toBe(true);
    expect(invokesTsc('tsc || exit 1')).toBe(true);
    expect(invokesTsc('foo | tsc')).toBe(true);
  });

  it('detects tsc behind a package runner', () => {
    expect(invokesTsc('npx tsc')).toBe(true);
    expect(invokesTsc('pnpm tsc')).toBe(true);
    expect(invokesTsc('pnpm exec tsc -b')).toBe(true);
    expect(invokesTsc('yarn dlx tsc')).toBe(true);
    expect(invokesTsc('bunx tsc')).toBe(true);
    expect(invokesTsc('rm -rf dist && npx tsc')).toBe(true);
  });

  it('detects tsc behind an arbitrary wrapper, not just a known runner list', () => {
    expect(invokesTsc('cross-env FOO=bar tsc')).toBe(true);
    expect(invokesTsc('dotenv -e .env -- tsc')).toBe(true);
  });

  it('detects tsc with clinging shell punctuation, e.g. inside a subshell', () => {
    expect(invokesTsc('(cd packages/foo && tsc)')).toBe(true);
    expect(invokesTsc('(tsc)')).toBe(true);
    expect(invokesTsc('"tsc"')).toBe(true);
  });

  it('detects a path-qualified tsc, which runs the same compiler as a bare one', () => {
    expect(invokesTsc('./node_modules/.bin/tsc')).toBe(true);
    expect(invokesTsc('packages/foo/node_modules/.bin/tsc -b')).toBe(true);
    expect(invokesTsc('$(npm bin)/tsc')).toBe(true);
    // A path prefix must not smuggle in the substring cases either.
    expect(invokesTsc('./node_modules/.bin/tsc-helper')).toBe(false);
  });

  it('does not false-positive on tsconfig.tsbuildinfo or a package/argument named like tsc', () => {
    expect(invokesTsc('rm -rf dist tsconfig.tsbuildinfo')).toBe(false);
    expect(invokesTsc('tsc-helper --check')).toBe(false);
    expect(invokesTsc('npx tsc-helper --check')).toBe(false);
    expect(invokesTsc('some-tool --project tsconfig.build.json')).toBe(false);
    expect(invokesTsc('echo tsconfig.tsbuildinfo')).toBe(false);
    expect(invokesTsc('pnpm run build')).toBe(false);
    expect(invokesTsc('pnpm run build:tsc')).toBe(false);
  });

  it('is out of class for non-tsc build tools', () => {
    expect(invokesTsc('astro build')).toBe(false);
    expect(invokesTsc('vite build')).toBe(false);
  });
});

describe('findBuildScriptViolations', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'guard-build-scripts-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function writePkg(rel: string, scripts: Record<string, string> | undefined): void {
    const dir = join(tmp, rel);
    mkdirSync(dir, { recursive: true });
    const body: { name: string; scripts?: Record<string, string> } = { name: rel };
    if (scripts !== undefined) body.scripts = scripts;
    writeFileSync(join(dir, 'package.json'), JSON.stringify(body, null, 2));
  }

  it('flags a bare `tsc` build script', () => {
    writePkg('packages/a', { build: 'tsc' });
    const violations = findBuildScriptViolations(tmp);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.script).toBe('tsc');
    expect(violations[0]?.packagePath).toBe(join(tmp, 'packages/a/package.json'));
  });

  it('accepts the clean-first prefix', () => {
    writePkg('packages/a', { build: 'rm -rf dist tsconfig.tsbuildinfo && tsc' });
    expect(findBuildScriptViolations(tmp)).toEqual([]);
  });

  it('skips a build script that does not invoke tsc at all (out of class)', () => {
    writePkg('services/website', { build: 'astro build' });
    expect(findBuildScriptViolations(tmp)).toEqual([]);
  });

  it('does not false-positive on a tsc-like token that is not an actual tsc invocation', () => {
    writePkg('packages/a', { build: 'some-tool --project tsconfig.build.json' });
    expect(findBuildScriptViolations(tmp)).toEqual([]);
  });

  it('flags `tsc -b` / `tsc --build`', () => {
    writePkg('packages/a', { build: 'tsc -b' });
    writePkg('packages/b', { build: 'tsc --build' });
    const violations = findBuildScriptViolations(tmp);
    expect(violations.map(v => v.packagePath)).toEqual([
      join(tmp, 'packages/a/package.json'),
      join(tmp, 'packages/b/package.json'),
    ]);
  });

  it('returns violations sorted by package path, not in readdir order', () => {
    writePkg('packages/alpha', { build: 'tsc' });
    writePkg('packages/zeta', { build: 'tsc' });
    reverseReaddir = true;
    try {
      expect(findBuildScriptViolations(tmp).map(v => v.packagePath)).toEqual([
        join(tmp, 'packages/alpha/package.json'),
        join(tmp, 'packages/zeta/package.json'),
      ]);
    } finally {
      reverseReaddir = false;
    }
  });

  it('flags a compound script that runs something else first then bare tsc', () => {
    writePkg('packages/a', { build: 'node scripts/gen.js && tsc' });
    expect(findBuildScriptViolations(tmp)).toHaveLength(1);
  });

  it('flags a runner-prefixed tsc build script', () => {
    writePkg('packages/a', { build: 'npx tsc' });
    expect(findBuildScriptViolations(tmp)).toHaveLength(1);
  });

  it('flags a partial prefix missing tsbuildinfo', () => {
    writePkg('packages/a', { build: 'rm -rf dist && tsc' });
    expect(findBuildScriptViolations(tmp)).toHaveLength(1);
  });

  it('skips packages with no scripts key, or scripts with no build entry, without crashing', () => {
    writePkg('packages/a', undefined);
    writePkg('packages/b', { test: 'vitest run' });
    expect(findBuildScriptViolations(tmp)).toEqual([]);
  });

  it('skips a non-string build value rather than crashing the whole guard', () => {
    // Valid JSON, invalid semantics. Written raw because writePkg is typed to
    // string values — which is exactly why the compiler cannot catch this.
    const dir = join(tmp, 'packages/a');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"a","scripts":{"build":null}}');
    expect(() => findBuildScriptViolations(tmp)).not.toThrow();
    expect(findBuildScriptViolations(tmp)).toEqual([]);
  });

  it('scans both packages/ and services/ roots', () => {
    writePkg('packages/a', { build: 'tsc' });
    writePkg('services/b', { build: 'tsc' });
    const violations = findBuildScriptViolations(tmp);
    expect(violations.map(v => v.packagePath)).toEqual([
      join(tmp, 'packages/a/package.json'),
      join(tmp, 'services/b/package.json'),
    ]);
  });
});
