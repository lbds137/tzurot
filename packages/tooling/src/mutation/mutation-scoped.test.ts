import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PathLike, PathOrFileDescriptor } from 'node:fs';
import { runMutationScoped } from './mutation-scoped.js';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
}));

const mockExec = vi.mocked(execFileSync);
const mockExists = vi.mocked(existsSync);
const mockRead = vi.mocked(readFileSync);
const mockWrite = vi.mocked(writeFileSync);
const mockRm = vi.mocked(rmSync);

const REPO_ROOT = '/repo';
const IDENTITY_MANIFEST = JSON.stringify({
  name: '@tzurot/identity',
  devDependencies: { '@stryker-mutator/core': '^10.0.0' },
});
const COMMON_TYPES_MANIFEST = JSON.stringify({ name: '@tzurot/common-types' });

const IDENTITY_FILE = 'packages/identity/src/personality/PersonalityLoader.ts';
const IDENTITY_REPORT_KEY = 'src/personality/PersonalityLoader.ts';

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

const IDENTITY_REPORT = JSON.stringify({
  files: {
    [IDENTITY_REPORT_KEY]: {
      mutants: [
        { status: 'Killed', location: { start: { line: 1, column: 1 } } },
        { status: 'Killed', location: { start: { line: 2, column: 1 } } },
        { status: 'Survived', location: { start: { line: 3, column: 1 } } },
      ],
    },
  },
});

const ALL_KILLED_REPORT = JSON.stringify({
  files: {
    [IDENTITY_REPORT_KEY]: {
      mutants: [
        { status: 'Killed', location: { start: { line: 1, column: 1 } } },
        { status: 'Killed', location: { start: { line: 2, column: 1 } } },
        { status: 'Killed', location: { start: { line: 3, column: 1 } } },
      ],
    },
  },
});

/** Status vocabulary from mutation-testing-report-schema (Stryker 10's report format). */
const KILLED_PLUS_NOCOVERAGE_REPORT = JSON.stringify({
  files: {
    [IDENTITY_REPORT_KEY]: {
      mutants: [
        { status: 'Killed', location: { start: { line: 1, column: 1 } } },
        { status: 'Killed', location: { start: { line: 2, column: 1 } } },
        { status: 'NoCoverage', location: { start: { line: 2, column: 1 } } },
      ],
    },
  },
});

const KILLED_PLUS_TIMEOUT_REPORT = JSON.stringify({
  files: {
    [IDENTITY_REPORT_KEY]: {
      mutants: [
        { status: 'Killed', location: { start: { line: 1, column: 1 } } },
        { status: 'Killed', location: { start: { line: 2, column: 1 } } },
        { status: 'Timeout', location: { start: { line: 3, column: 1 } } },
      ],
    },
  },
});

/** Clear-text table fallback shape (copied from a real Stryker 10 run). */
const TABLE_STDOUT = [
  '----------------|------------------|----------|-----------|------------|----------|----------|',
  'All files       |  83.33 |   83.33 |        5 |         0 |          1 |        0 |        0 |',
].join('\n');

describe('runMutationScoped', () => {
  const IDENTITY_STRYKER_CONFIG = "export default { mutate: ['src/**/*.ts'] };";
  const FS_STUB = {
    [`${REPO_ROOT}/packages/identity/package.json`]: IDENTITY_MANIFEST,
    [`${REPO_ROOT}/packages/common-types/package.json`]: COMMON_TYPES_MANIFEST,
    [`${REPO_ROOT}/packages/identity/stryker.config.mjs`]: IDENTITY_STRYKER_CONFIG,
  };
  const NO_PACKAGE_CONFIG_STUB = {
    [`${REPO_ROOT}/packages/identity/package.json`]: IDENTITY_MANIFEST,
    [`${REPO_ROOT}/packages/common-types/package.json`]: COMMON_TYPES_MANIFEST,
  };
  const IDENTITY_REPORT_PATH = `${REPO_ROOT}/reports/mutation-scoped/identity/mutation.json`;

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

  function stubExec(diff: string, strykerStdout = '', gitStatus = ''): void {
    mockExec.mockImplementation((file: unknown, argv?: unknown) => {
      if (file === 'git') {
        if (((argv as string[]) ?? [])[0] === 'status') {
          return gitStatus;
        }
        return diff;
      }
      if (file === 'pnpm') {
        return strykerStdout;
      }
      throw new Error(`unexpected exec target: ${String(file)}`);
    });
  }

  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue(REPO_ROOT);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockExec.mockReset();
    mockExists.mockReset();
    mockRead.mockReset();
    mockWrite.mockReset();
    mockRm.mockReset();
  });

  it('threads the base ref into the git diff seam and prints plans on --dry-run without invoking Stryker', () => {
    stubExec(DIFF_SAMPLE);
    stubFs(FS_STUB);

    const passed = runMutationScoped({ base: 'origin/main', dryRun: true });

    expect(passed).toBe(true);
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(mockExec).toHaveBeenCalledWith(
      'git',
      [
        'diff',
        '--unified=0',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        'origin/main...HEAD',
        '--',
        ':(glob)packages/*/src/**/*.ts',
      ],
      expect.objectContaining({ encoding: 'utf-8' })
    );
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('[dry-run] @tzurot/identity: 1 file(s), 1 range(s)')
    );
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining("-m 'src/personality/PersonalityLoader.ts:1-3'")
    );
  });

  it('runs ONE stryker invocation per package through the temp scoped config (positional configFile) and reads the scoped report', () => {
    stubExec(DIFF_SAMPLE);
    stubFs({
      ...FS_STUB,
      [IDENTITY_REPORT_PATH]: IDENTITY_REPORT,
    });

    const passed = runMutationScoped({ base: 'origin/develop' });

    expect(mockExec).toHaveBeenCalledWith(
      'pnpm',
      [
        '--filter',
        '@tzurot/identity',
        'exec',
        'stryker',
        'run',
        '.stryker-scoped.config.mjs',
        '-m',
        'src/personality/PersonalityLoader.ts:1-3',
        '--allowEmpty',
      ],
      expect.objectContaining({ cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'inherit'] })
    );
    // Both reporters must point at reports/mutation-scoped/ — pointing jsonReporter
    // back at the package report path (reports/mutation/...) reddens this test.
    expect(mockWrite).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenContent] = mockWrite.mock.calls[0] ?? [];
    expect(writtenPath).toBe(`${REPO_ROOT}/packages/identity/.stryker-scoped.config.mjs`);
    expect(writtenContent).toContain("import config from './stryker.config.mjs';");
    expect(writtenContent).toContain('../../reports/mutation-scoped/identity/mutation.json');
    expect(writtenContent).toContain('../../reports/mutation-scoped/identity/index.html');
    expect(writtenContent).toContain("tempDirName: '.stryker-scoped-tmp',");
    expect(passed).toBe(false);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('packages/identity/src/personality/PersonalityLoader.ts:3')
    );
  });

  it('plans a top-level src file (no directory under src) — the :(glob) pathspec case', () => {
    const topLevelDiff = [
      'diff --git a/packages/identity/src/PersonalityLoader.ts b/packages/identity/src/PersonalityLoader.ts',
      '+++ b/packages/identity/src/PersonalityLoader.ts',
      '@@ -3,0 +4,3 @@',
      '+export const one = 1;',
      '+export const two = 2;',
      '+export const three = 3;',
    ].join('\n');
    stubExec(topLevelDiff);
    stubFs(FS_STUB);

    expect(runMutationScoped({ base: 'origin/develop', dryRun: true })).toBe(true);

    expect(mockExec).toHaveBeenCalledWith(
      'git',
      [
        'diff',
        '--unified=0',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        'origin/develop...HEAD',
        '--',
        ':(glob)packages/*/src/**/*.ts',
      ],
      expect.objectContaining({ encoding: 'utf-8' })
    );
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining("-m 'src/PersonalityLoader.ts:4-6'")
    );
  });

  it('skips packages with no stryker.config.mjs at plan time with a note, never invoking Stryker', () => {
    stubExec(DIFF_SAMPLE);
    stubFs(NO_PACKAGE_CONFIG_STUB);

    const passed = runMutationScoped({ base: 'origin/develop' });

    expect(passed).toBe(true);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('no stryker.config.mjs — not scoped-runnable')
    );
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('use pnpm --filter @tzurot/identity test:mutation for a full run')
    );
    expect(mockExec.mock.calls.filter(call => call[0] === 'pnpm')).toHaveLength(0);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('warns when the working tree is dirty for planned files', () => {
    stubExec(DIFF_SAMPLE, '', ' M packages/identity/src/personality/PersonalityLoader.ts\n');
    stubFs({
      ...FS_STUB,
      [IDENTITY_REPORT_PATH]: ALL_KILLED_REPORT,
    });

    expect(runMutationScoped({ base: 'origin/develop' })).toBe(true);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      expect.stringContaining(
        'uncommitted edits in planned file(s): packages/identity/src/personality/PersonalityLoader.ts'
      )
    );
  });

  it('names only the new path for rename-shaped porcelain entries', () => {
    stubExec(
      DIFF_SAMPLE,
      '',
      'R  packages/identity/src/old-name.ts -> packages/identity/src/personality/PersonalityLoader.ts\n'
    );
    stubFs({
      ...FS_STUB,
      [IDENTITY_REPORT_PATH]: ALL_KILLED_REPORT,
    });

    expect(runMutationScoped({ base: 'origin/develop' })).toBe(true);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      expect.stringContaining(
        'uncommitted edits in planned file(s): packages/identity/src/personality/PersonalityLoader.ts'
      )
    );
    expect(vi.mocked(console.error)).not.toHaveBeenCalledWith(
      expect.stringContaining('old-name.ts ->')
    );
  });

  it('warns and continues (exit unaffected) when the dirty check itself fails', () => {
    stubExec(DIFF_SAMPLE);
    stubFs({
      ...FS_STUB,
      [IDENTITY_REPORT_PATH]: ALL_KILLED_REPORT,
    });
    mockExec.mockImplementation((file: unknown, argv?: unknown) => {
      if (file === 'git') {
        if (((argv as string[]) ?? [])[0] === 'status') {
          throw new Error('git status exploded');
        }
        return DIFF_SAMPLE;
      }
      return '';
    });

    expect(runMutationScoped({ base: 'origin/develop' })).toBe(true);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      expect.stringContaining('could not check the working tree for uncommitted edits')
    );
  });

  it('stays silent about the working tree when git status is clean', () => {
    stubExec(DIFF_SAMPLE);
    stubFs({
      ...FS_STUB,
      [IDENTITY_REPORT_PATH]: ALL_KILLED_REPORT,
    });

    expect(runMutationScoped({ base: 'origin/develop' })).toBe(true);
    expect(vi.mocked(console.error)).not.toHaveBeenCalledWith(
      expect.stringContaining('uncommitted edits')
    );
  });

  it('skips the package top-level barrel at plan time but keeps nested index files mutable', () => {
    const barrelDiff = [
      'diff --git a/packages/identity/src/index.ts b/packages/identity/src/index.ts',
      '+++ b/packages/identity/src/index.ts',
      '@@ -1 +2 @@',
      "+export * from './a.js';",
      'diff --git a/packages/identity/src/commands/index.ts b/packages/identity/src/commands/index.ts',
      '+++ b/packages/identity/src/commands/index.ts',
      '@@ -1 +2 @@',
      "+export * from './register.js';",
    ].join('\n');
    stubExec(barrelDiff);
    stubFs(FS_STUB);

    expect(runMutationScoped({ base: 'origin/develop', dryRun: true })).toBe(true);

    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('skipped (not mutable source): packages/identity/src/index.ts')
    );
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining("-m 'src/commands/index.ts:2-2'")
    );
  });

  it('treats n/a table cells as 0 (parseTextSummary fallback)', () => {
    stubExec(DIFF_SAMPLE, 'All files | 100.00 | 100.00 | 3 | n/a | 0 | n/a |  |');
    stubFs(FS_STUB);

    expect(runMutationScoped({ base: 'origin/develop' })).toBe(true);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('3 mutants — 3 killed, 0 survived')
    );
  });

  it('treats empty table cells as 0 (parseTextSummary fallback)', () => {
    stubExec(DIFF_SAMPLE, 'All files | 50.00 | 50.00 | 2 |  | 0 |  |  |');
    stubFs(FS_STUB);

    expect(runMutationScoped({ base: 'origin/develop' })).toBe(true);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('2 mutants — 2 killed, 0 survived')
    );
  });

  it('fails with a package error when the clear-text output has no All files row and no report exists', () => {
    stubExec(DIFF_SAMPLE, 'a log line\nanother line, no table anywhere');
    stubFs(FS_STUB);

    const passed = runMutationScoped({ base: 'origin/develop' });

    expect(passed).toBe(false);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('❌ @tzurot/identity: Stryker failed')
    );
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('no All files summary row in Stryker output')
    );
  });

  it('prints a bare path for a report survivor with no location (no fake :0)', () => {
    const unlocatedReport = JSON.stringify({
      files: {
        [IDENTITY_REPORT_KEY]: {
          mutants: [{ status: 'Survived' }],
        },
      },
    });
    stubExec(DIFF_SAMPLE);
    stubFs({
      ...FS_STUB,
      [IDENTITY_REPORT_PATH]: unlocatedReport,
    });

    const passed = runMutationScoped({ base: 'origin/develop' });

    expect(passed).toBe(false);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining(
        '⚠ survivor: packages/identity/src/personality/PersonalityLoader.ts — add the killing assertion'
      )
    );
  });

  it('exits 0 (true) with the all-killed line only when every scoped mutant is killed', () => {
    stubExec(DIFF_SAMPLE);
    stubFs({
      ...FS_STUB,
      [IDENTITY_REPORT_PATH]: ALL_KILLED_REPORT,
    });

    expect(runMutationScoped({ base: 'origin/develop' })).toBe(true);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('all 3 diff-scoped mutant(s) killed')
    );
  });

  it('passes a types-only diff: the scoped JSON report exists with 0 mutants (live-probed Stryker 10 shape)', () => {
    // Live probe on a real comment-only diff (config-resolver):
    // Stryker with --allowEmpty still wrote mutation.json (empty files map)
    // and exited 0, so the gate took the JSON path — never the rowless
    // error path — and printed the 0-mutant pass.
    stubExec(DIFF_SAMPLE);
    stubFs({
      ...FS_STUB,
      [IDENTITY_REPORT_PATH]: JSON.stringify({ files: {} }),
    });

    expect(runMutationScoped({ base: 'origin/develop' })).toBe(true);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('0 mutants — 0 killed, 0 survived')
    );
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('all 0 diff-scoped mutant(s) killed')
    );
  });

  it('fails and prints not-covered locations when the report mixes Killed and NoCoverage', () => {
    stubExec(DIFF_SAMPLE);
    stubFs({
      ...FS_STUB,
      [IDENTITY_REPORT_PATH]: KILLED_PLUS_NOCOVERAGE_REPORT,
    });

    const passed = runMutationScoped({ base: 'origin/develop' });

    expect(passed).toBe(false);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(expect.stringContaining('1 not covered'));
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining(
        '⚠ not covered: packages/identity/src/personality/PersonalityLoader.ts:2 — no test executes this line'
      )
    );
    expect(vi.mocked(console.log)).not.toHaveBeenCalledWith(
      expect.stringContaining('all 3 diff-scoped mutant(s) killed')
    );
  });

  it('passes with other counted and no all-killed claim on a Killed+Timeout mix', () => {
    stubExec(DIFF_SAMPLE);
    stubFs({
      ...FS_STUB,
      [IDENTITY_REPORT_PATH]: KILLED_PLUS_TIMEOUT_REPORT,
    });

    const passed = runMutationScoped({ base: 'origin/develop' });

    expect(passed).toBe(true);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('2 killed, 1 other (no gate)')
    );
    expect(vi.mocked(console.log)).not.toHaveBeenCalledWith(
      expect.stringContaining('all 3 diff-scoped mutant(s) killed')
    );
  });

  it('falls back to the clear-text table when the JSON report is missing', () => {
    stubExec(DIFF_SAMPLE, TABLE_STDOUT);
    stubFs(FS_STUB);

    const passed = runMutationScoped({ base: 'origin/develop' });

    expect(passed).toBe(false);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('6 mutants — 5 killed, 1 survived')
    );
  });

  it('deletes the previous scoped report before the run so its survivors cannot leak into this result', () => {
    stubExec(DIFF_SAMPLE, TABLE_STDOUT);
    const files: Record<string, string> = {
      ...FS_STUB,
      [IDENTITY_REPORT_PATH]: IDENTITY_REPORT, // stale: a previous scoped run's JSON
    };
    stubFs(files);
    // Stateful stand-in for the real rmSync: the pre-run deletion must be
    // visible to the post-run existsSync, or this test proves nothing.
    mockRm.mockImplementation((path: PathLike) => {
      delete files[String(path)];
    });

    const passed = runMutationScoped({ base: 'origin/develop' });

    // The stale JSON (3 mutants: 2 killed, 1 survived, located) must not be
    // read: the counts come from the text fallback's table (6 mutants), the
    // stale located-survivor line never prints, and the exit follows the
    // table's own 1 survivor.
    expect(passed).toBe(false);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('6 mutants — 5 killed, 1 survived')
    );
    expect(vi.mocked(console.log)).not.toHaveBeenCalledWith(expect.stringContaining('⚠ survivor:'));
    expect(mockRm).toHaveBeenCalledWith(IDENTITY_REPORT_PATH, { force: true });
  });

  it('skips packages without Stryker deps and never invokes Stryker for them', () => {
    stubExec(DIFF_SAMPLE);
    stubFs({
      ...FS_STUB,
      [IDENTITY_REPORT_PATH]: ALL_KILLED_REPORT,
    });

    expect(runMutationScoped({ base: 'origin/develop' })).toBe(true);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('skipped package (no Stryker deps): @tzurot/common-types')
    );
    const pnpmCalls = mockExec.mock.calls.filter(call => call[0] === 'pnpm');
    expect(pnpmCalls).toHaveLength(1);
    expect(pnpmCalls[0]?.[1]).toContain('@tzurot/identity');
  });

  it('skips test files and other non-targets with a note', () => {
    stubExec(DIFF_SAMPLE);
    stubFs({
      ...FS_STUB,
      [IDENTITY_REPORT_PATH]: ALL_KILLED_REPORT,
    });

    runMutationScoped({ base: 'origin/develop' });

    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining(
        'skipped (not mutable source): packages/identity/src/personality/PersonalityLoader.test.ts'
      )
    );
  });

  it('exits 1 (false) and notes the failure when the Stryker invocation throws, and still removes the temp config', () => {
    stubExec(DIFF_SAMPLE);
    stubFs(FS_STUB);
    mockExec.mockImplementation((file: unknown, argv?: unknown) => {
      if (file === 'git') {
        if (((argv as string[]) ?? [])[0] === 'status') {
          return '';
        }
        return DIFF_SAMPLE;
      }
      throw new Error('stryker exploded');
    });

    expect(runMutationScoped({ base: 'origin/develop' })).toBe(false);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('❌ @tzurot/identity: Stryker failed')
    );
    // The finally deletes the temp config on the throw path too.
    expect(mockRm).toHaveBeenCalledWith(
      `${REPO_ROOT}/packages/identity/.stryker-scoped.config.mjs`,
      { force: true }
    );
  });

  it('passes with nothing to run on an empty diff', () => {
    stubExec('');
    stubFs(FS_STUB);

    expect(runMutationScoped({ base: 'origin/develop' })).toBe(true);
    const pnpmCalls = mockExec.mock.calls.filter(call => call[0] === 'pnpm');
    expect(pnpmCalls).toHaveLength(0);
  });

  it('passes with nothing to run when the diff only deletes lines', () => {
    stubExec('+++ b/packages/identity/src/a.ts\n@@ -1,3 +1,0 @@\n-gone');
    stubFs(FS_STUB);

    expect(runMutationScoped({ base: 'origin/develop' })).toBe(true);
    const pnpmCalls = mockExec.mock.calls.filter(call => call[0] === 'pnpm');
    expect(pnpmCalls).toHaveLength(0);
  });

  it('fails through the diff error path when headers exist but nothing parses (noprefix-style body)', () => {
    const noprefixDiff = [
      `diff --git ${IDENTITY_FILE} ${IDENTITY_FILE}`,
      'index 1111111..2222222 100644',
      `--- ${IDENTITY_FILE}`,
      `+++ ${IDENTITY_FILE}`,
      '@@ -0,0 +1,3 @@',
      '+export const fresh = true;',
      '+export const eager = false;',
      '+export const third = 3;',
    ].join('\n');
    stubExec(noprefixDiff);
    stubFs(FS_STUB);

    expect(runMutationScoped({ base: 'origin/develop' })).toBe(false);
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      expect.stringContaining('could not diff against origin/develop')
    );
    const pnpmCalls = mockExec.mock.calls.filter(call => call[0] === 'pnpm');
    expect(pnpmCalls).toHaveLength(0);
  });

  it('still passes when only lines are deleted and headers are present (no added-line hunks)', () => {
    const deleteOnlyDiff = [
      'diff --git a/packages/identity/src/a.ts b/packages/identity/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/packages/identity/src/a.ts',
      '+++ b/packages/identity/src/a.ts',
      '@@ -1,3 +1,0 @@',
      '-gone line one',
      '-gone line two',
    ].join('\n');
    stubExec(deleteOnlyDiff);
    stubFs(FS_STUB);

    expect(runMutationScoped({ base: 'origin/develop' })).toBe(true);
    const pnpmCalls = mockExec.mock.calls.filter(call => call[0] === 'pnpm');
    expect(pnpmCalls).toHaveLength(0);
  });

  it('exits 1 (false) when the git diff itself fails', () => {
    mockExec.mockImplementation(() => {
      throw new Error('no merge base');
    });
    stubFs(FS_STUB);

    expect(runMutationScoped({ base: 'origin/develop' })).toBe(false);
  });
});
