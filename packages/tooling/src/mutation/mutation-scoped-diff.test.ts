import { describe, it, expect, vi, afterEach } from 'vitest';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import type { PathLike, PathOrFileDescriptor } from 'node:fs';
import {
  parseGitDiff,
  isMutationTarget,
  resolveOwningPackage,
  buildPlans,
  type ResolvedFile,
} from './mutation-scoped-diff.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockExists = vi.mocked(existsSync);
const mockRead = vi.mocked(readFileSync);

const REPO_ROOT = '/repo';
const IDENTITY_MANIFEST = JSON.stringify({
  name: '@tzurot/identity',
  devDependencies: { '@stryker-mutator/core': '^10.0.0' },
});
const COMMON_TYPES_MANIFEST = JSON.stringify({ name: '@tzurot/common-types' });

const IDENTITY_FILE = 'packages/identity/src/personality/PersonalityLoader.ts';

const DIFF_SAMPLE = [
  `diff --git a/${IDENTITY_FILE} b/${IDENTITY_FILE}`,
  'index 1111111..2222222 100644',
  `--- a/${IDENTITY_FILE}`,
  `+++ b/${IDENTITY_FILE}`,
  '@@ -0,0 +1,3 @@',
  '+export const fresh = true;',
  '+export const eager = false;',
  '+export const third = 3;',
  `diff --git a/packages/identity/src/personality/PersonalityLoader.test.ts b/packages/identity/src/personality/PersonalityLoader.test.ts`,
  `+++ b/packages/identity/src/personality/PersonalityLoader.test.ts`,
  '@@ -5,2 +5,0 @@',
  '-stale test line one',
  '-stale test line two',
  '@@ -10 +11,2 @@',
  '+it("covers the new branch", () => {});',
  '+it("covers the other branch", () => {});',
  'diff --git a/packages/common-types/src/utils/dateUtils.ts b/packages/common-types/src/utils/dateUtils.ts',
  '+++ b/packages/common-types/src/utils/dateUtils.ts',
  '@@ -12 +13 @@',
  '-old',
  '+new',
].join('\n');

describe('parseGitDiff', () => {
  it('collects added/changed ranges per file from hunk headers', () => {
    const parsed = parseGitDiff(DIFF_SAMPLE);
    expect(parsed.get(IDENTITY_FILE)).toEqual([{ start: 1, end: 3 }]);
    expect(parsed.get('packages/common-types/src/utils/dateUtils.ts')).toEqual([
      { start: 13, end: 13 },
    ]);
  });

  it('parses several hunks on one file into several ranges', () => {
    const diff = [
      '+++ b/packages/identity/src/a.ts',
      '@@ -1 +2 @@',
      '+x',
      '@@ -40,2 +41,2 @@',
      '+y',
      '+z',
    ].join('\n');
    expect(parseGitDiff(diff).get('packages/identity/src/a.ts')).toEqual([
      { start: 2, end: 2 },
      { start: 41, end: 42 },
    ]);
  });

  it('gives deleted-only hunks (newCount 0) no range — nothing to mutate', () => {
    const diff = '+++ b/packages/identity/src/a.ts\n@@ -5,2 +5,0 @@\n-deleted one\n-deleted two';
    expect(parseGitDiff(diff).size).toBe(0);
  });

  it('defaults omitted hunk counts to one line', () => {
    const diff = '+++ b/packages/identity/src/a.ts\n@@ -12 +13 @@\n+new';
    expect(parseGitDiff(diff).get('packages/identity/src/a.ts')).toEqual([{ start: 13, end: 13 }]);
  });

  it('does not leak a deleted file (+/dev/null) hunks into the previous file', () => {
    const diff = [
      '+++ b/packages/identity/src/one.ts',
      '@@ -1 +2 @@',
      '+x',
      'diff --git a/packages/identity/src/gone.ts b/packages/identity/src/gone.ts',
      '--- a/packages/identity/src/gone.ts',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
      '-gone line',
    ].join('\n');
    const parsed = parseGitDiff(diff);
    expect([...parsed.keys()]).toEqual(['packages/identity/src/one.ts']);
    expect(parsed.get('packages/identity/src/one.ts')).toEqual([{ start: 2, end: 2 }]);
  });

  it('returns an empty map for an empty diff', () => {
    expect(parseGitDiff('').size).toBe(0);
  });
});

describe('isMutationTarget', () => {
  it.each([
    ['packages/identity/src/personality/PersonalityLoader.ts', true],
    ['packages/identity/src/personality/PersonalityLoader.test.ts', false],
    ['packages/identity/src/personality/PersonalityLoader.d.ts', false],
    ['packages/identity/src/personality/component.tsx', false],
    ['packages/clients/dist/index.ts', false],
    ['packages/identity/src/generated/prisma/client.ts', false],
    ['packages/clients/src/clients/_generated/user-client.ts', false],
    ['docs/notes.ts', true],
  ])('%s → %s', (file, expected) => {
    expect(isMutationTarget(file)).toBe(expected);
  });

  it('excludes the package top-level barrel when the package dir is given', () => {
    expect(isMutationTarget('packages/identity/src/index.ts', 'packages/identity')).toBe(false);
  });

  it('keeps nested index files mutable and leaves the barrel check inert without a package dir', () => {
    expect(isMutationTarget('packages/identity/src/commands/index.ts', 'packages/identity')).toBe(
      true
    );
    expect(isMutationTarget('packages/identity/src/index.ts')).toBe(true);
  });
});

describe('resolveOwningPackage', () => {
  afterEach(() => {
    mockExists.mockReset();
    mockRead.mockReset();
  });

  function stubFs(files: Record<string, string>): void {
    mockExists.mockImplementation((path: PathLike) =>
      Object.prototype.hasOwnProperty.call(files, String(path))
    );
    mockRead.mockImplementation((path: PathOrFileDescriptor) => {
      const content = files[String(path)];
      if (content === undefined) {
        throw new Error(`unexpected readFileSync: ${String(path)}`);
      }
      return content;
    });
  }

  it('walks up to the nearest manifest and reads the Stryker dep off it', () => {
    stubFs({ [`${REPO_ROOT}/packages/identity/package.json`]: IDENTITY_MANIFEST });
    expect(resolveOwningPackage(REPO_ROOT, 'packages/identity/src/a/deep/file.ts')).toEqual({
      name: '@tzurot/identity',
      dir: 'packages/identity',
      stryker: true,
    });
  });

  it('flags a package without the Stryker dep as stryker: false', () => {
    stubFs({ [`${REPO_ROOT}/packages/common-types/package.json`]: COMMON_TYPES_MANIFEST });
    const owner = resolveOwningPackage(REPO_ROOT, 'packages/common-types/src/utils/date.ts');
    expect(owner?.stryker).toBe(false);
  });

  it('returns null when no manifest exists anywhere up the tree', () => {
    stubFs({});
    expect(resolveOwningPackage(REPO_ROOT, 'packages/identity/src/a.ts')).toBeNull();
  });

  it('returns null when the manifest does not parse', () => {
    stubFs({ [`${REPO_ROOT}/packages/identity/package.json`]: '{not json' });
    expect(resolveOwningPackage(REPO_ROOT, 'packages/identity/src/a.ts')).toBeNull();
  });
});

describe('buildPlans', () => {
  const resolved: ResolvedFile[] = [
    {
      file: 'packages/identity/src/b.ts',
      packageName: '@tzurot/identity',
      packageDir: 'packages/identity',
      ranges: [{ start: 5, end: 5 }],
    },
    {
      file: 'packages/identity/src/a.ts',
      packageName: '@tzurot/identity',
      packageDir: 'packages/identity',
      ranges: [
        { start: 2, end: 2 },
        { start: 1, end: 2 },
      ],
    },
    {
      file: 'packages/clients/src/http.ts',
      packageName: '@tzurot/clients',
      packageDir: 'packages/clients',
      ranges: [{ start: 9, end: 12 }],
    },
  ];

  it('groups per package with a comma-joined, package-relative --mutate value', () => {
    const plans = buildPlans(resolved);
    expect(plans).toHaveLength(2);
    const identity = plans.find(plan => plan.packageName === '@tzurot/identity');
    expect(identity?.mutateArg).toBe('src/a.ts:1-2,src/a.ts:2-2,src/b.ts:5-5');
    expect(identity?.rangeCount).toBe(3);
    expect(identity?.files).toEqual(['packages/identity/src/a.ts', 'packages/identity/src/b.ts']);
  });

  it('strips the @tzurot/ scope for the report-path short name', () => {
    expect(buildPlans(resolved).map(plan => plan.shortName)).toEqual(['clients', 'identity']);
  });
});

describe('stryker config negation drift guard', () => {
  // This module hand-repeats the package configs' `mutate` negations as
  // EXCLUDED_SEGMENTS / barrel checks; when a config grows a negation, the
  // hand-copy must grow with it or the scoped `-m` list silently mutates files
  // the full runs exclude. The negation set is closed and small; each entry
  // maps a package-relative negation glob to one concrete example file shape
  // it must exclude.
  const NEGATION_EXAMPLES: Record<string, string> = {
    'src/**/*.test.ts': 'src/utils/dateUtils.test.ts',
    'src/index.ts': 'src/index.ts',
    'src/clients/_generated/**': 'src/clients/_generated/user-client.ts',
  };

  it('isMutationTarget excludes an example file for every negation in every real package config', async () => {
    // The file's module-level node:fs mock is for resolveOwningPackage; the
    // drift guard reads the REAL configs, so it uses the real fs and imports
    // each config by absolute URL (the configs import cleanly from node).
    const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const packagesDir = path.resolve(__dirname, '../../..');
    const configPaths = realFs
      .readdirSync(packagesDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(packagesDir, entry.name, 'stryker.config.mjs'))
      .filter(configPath => realFs.existsSync(configPath));

    expect(configPaths.length).toBeGreaterThan(0);

    for (const configPath of configPaths) {
      const packageDir = path
        .relative(path.resolve(packagesDir, '..'), path.dirname(configPath))
        .split(path.sep)
        .join('/');
      const mod = (await import(pathToFileURL(configPath).href)) as {
        default?: { mutate?: string[] };
        mutate?: string[];
      };
      const negations = ((mod.default ?? mod).mutate ?? []).filter(entry => entry.startsWith('!'));

      expect(negations.length, `${packageDir}/stryker.config.mjs negations found`).toBeGreaterThan(
        0
      );

      for (const negation of negations) {
        const example = NEGATION_EXAMPLES[negation.slice(1)];
        if (example === undefined) {
          throw new Error(
            `${packageDir}/stryker.config.mjs carries negation "${negation}" with no ` +
              'NEGATION_EXAMPLES mapping — add the pattern → example pair here AND the ' +
              'matching exclusion to isMutationTarget, or the scoped -m list will mutate ' +
              'files the full runs exclude'
          );
        }
        expect(
          isMutationTarget(`${packageDir}/${example}`, packageDir),
          `${packageDir}: negation ${negation} must exclude ${example}`
        ).toBe(false);
      }
    }
  });
});
