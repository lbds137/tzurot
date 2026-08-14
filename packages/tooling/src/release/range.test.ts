import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./github-prs.js', () => ({
  discoverPrevTag: vi.fn(),
  tagTimestamp: vi.fn(),
  listMergedPrsSince: vi.fn(),
  countRangeChangedFiles: vi.fn(),
  DEFAULT_BASE_BRANCH: 'develop',
}));

import { releaseRange, formatRangeReport, classifyPr, isNonRuntimeFile } from './range.js';
import {
  discoverPrevTag,
  tagTimestamp,
  listMergedPrsSince,
  countRangeChangedFiles,
} from './github-prs.js';
import type { MergedPr } from './notes-format.js';

const mockedDiscoverPrevTag = vi.mocked(discoverPrevTag);
const mockedTagTimestamp = vi.mocked(tagTimestamp);
const mockedListMergedPrsSince = vi.mocked(listMergedPrsSince);
const mockedCountRangeChangedFiles = vi.mocked(countRangeChangedFiles);

describe('isNonRuntimeFile', () => {
  it('excludes files under the tooling/test-support packages', () => {
    expect(isNonRuntimeFile('packages/tooling/src/release/range.ts')).toBe(true);
    expect(isNonRuntimeFile('packages/test-utils/src/pglite.ts')).toBe(true);
    expect(isNonRuntimeFile('packages/test-factories/src/user.ts')).toBe(true);
  });

  it('excludes .claude/, docs/, backlog/, tracker/, .github/, and .husky/', () => {
    expect(isNonRuntimeFile('.claude/rules/05-tooling.md')).toBe(true);
    expect(isNonRuntimeFile('docs/reference/tooling/OPS_CLI_REFERENCE.md')).toBe(true);
    expect(isNonRuntimeFile('backlog/now.md')).toBe(true);
    expect(isNonRuntimeFile('tracker/tasks/task-1.md')).toBe(true);
    expect(isNonRuntimeFile('.github/workflows/ci.yml')).toBe(true);
    expect(isNonRuntimeFile('.husky/pre-push')).toBe(true);
  });

  it('excludes root-level markdown files', () => {
    expect(isNonRuntimeFile('BACKLOG.md')).toBe(true);
    expect(isNonRuntimeFile('CURRENT.md')).toBe(true);
    expect(isNonRuntimeFile('README.md')).toBe(true);
  });

  it('does NOT exclude root package.json or pnpm-lock.yaml — they affect deployed builds', () => {
    expect(isNonRuntimeFile('package.json')).toBe(false);
    expect(isNonRuntimeFile('pnpm-lock.yaml')).toBe(false);
  });

  it('does NOT exclude a runtime service or shared-package file', () => {
    expect(isNonRuntimeFile('services/bot-client/src/index.ts')).toBe(false);
    expect(isNonRuntimeFile('packages/common-types/src/constants/foo.ts')).toBe(false);
  });
});

describe('classifyPr', () => {
  it('classifies non-runtime when every changed file is excluded', () => {
    expect(classifyPr(['docs/README.md', 'backlog/now.md'])).toBe('non-runtime');
  });

  it('classifies runtime when at least one changed file is not excluded', () => {
    expect(classifyPr(['docs/README.md', 'services/bot-client/src/index.ts'])).toBe('runtime');
  });

  it('classifies runtime for a root package.json-only change', () => {
    expect(classifyPr(['package.json'])).toBe('runtime');
  });

  it('classifies non-runtime for a .github-only change', () => {
    expect(classifyPr(['.github/workflows/ci.yml'])).toBe('non-runtime');
  });

  it('classifies non-runtime for a tracker/docs-only change', () => {
    expect(classifyPr(['tracker/tasks/task-1.md', 'docs/reference/guides/TESTING.md'])).toBe(
      'non-runtime'
    );
  });

  it('fails toward runtime when the PR reports no files (anomalous for a merged PR)', () => {
    expect(classifyPr(undefined)).toBe('runtime');
    expect(classifyPr([])).toBe('runtime');
  });

  it('fails toward runtime at the gh files-list cap (100 entries), even all-excluded', () => {
    // gh truncates the per-PR files list; unseen files past the cap could be
    // runtime, so a capped list must never classify non-runtime.
    const capped = Array.from({ length: 100 }, (_, i) => `docs/file-${i}.md`);
    expect(classifyPr(capped)).toBe('runtime');
    // One below the cap with the same shape stays honestly non-runtime.
    expect(classifyPr(capped.slice(0, 99))).toBe('non-runtime');
  });
});

describe('formatRangeReport', () => {
  const baseOptions = {
    fromTag: 'v3.0.0-beta.103',
    fromTimestamp: '2026-04-22T10:00:00Z',
    base: 'develop',
  };

  it('renders the header, one line per PR ordered by mergedAt, and the trailer', () => {
    const prs: MergedPr[] = [
      {
        number: 870,
        title: 'feat(api): X',
        mergedAt: '2026-04-22T12:00:00Z',
        files: ['services/api-gateway/src/x.ts'],
      },
      {
        number: 869,
        title: 'docs: Y',
        mergedAt: '2026-04-22T11:00:00Z',
        files: ['docs/README.md'],
      },
    ];

    const report = formatRangeReport(prs, baseOptions);
    const lines = report.split('\n');

    expect(lines[0]).toBe('Range: v3.0.0-beta.103 (2026-04-22T10:00:00Z) → develop');
    // #869 (earlier mergedAt) comes before #870 despite appearing second in input.
    const prLines = lines.filter(l => l.startsWith('#'));
    expect(prLines).toEqual([
      '#869  2026-04-22  [non-runtime]  docs: Y',
      '#870  2026-04-22  [runtime]  feat(api): X',
    ]);
    expect(report).toContain('Total: 2 PRs — 1 runtime, 1 non-runtime');
  });

  it('renders an empty-range report with zero counts and no PR lines', () => {
    const report = formatRangeReport([], baseOptions);
    const lines = report.split('\n');
    expect(lines[0]).toBe('Range: v3.0.0-beta.103 (2026-04-22T10:00:00Z) → develop');
    expect(lines.some(l => l.startsWith('#'))).toBe(false);
    expect(report).toContain('Total: 0 PRs — 0 runtime, 0 non-runtime');
  });

  it('uses the singular noun for a one-PR range', () => {
    const report = formatRangeReport(
      [{ number: 1, title: 'feat: x', mergedAt: '2026-04-22T11:00:00Z', files: ['services/a.ts'] }],
      baseOptions
    );
    expect(report).toContain('Total: 1 PR — 1 runtime, 0 non-runtime');
  });

  it('adds the release-cadence threshold note at exactly 10 runtime PRs', () => {
    const prs: MergedPr[] = Array.from({ length: 10 }, (_, i) => ({
      number: i,
      title: `feat: pr ${i}`,
      mergedAt: `2026-04-22T${String(i).padStart(2, '0')}:00:00Z`,
      files: ['services/bot-client/src/index.ts'],
    }));

    const report = formatRangeReport(prs, baseOptions);
    expect(report).toContain('Total: 10 PRs — 10 runtime, 0 non-runtime');
    expect(report).toContain('Runtime count at release-cadence threshold (~10)');
    expect(report).toContain('10-working-posture.md § Ship in bounded units');
  });

  it('omits the threshold note below 10 runtime PRs', () => {
    const prs: MergedPr[] = Array.from({ length: 9 }, (_, i) => ({
      number: i,
      title: `feat: pr ${i}`,
      mergedAt: `2026-04-22T${String(i).padStart(2, '0')}:00:00Z`,
      files: ['services/bot-client/src/index.ts'],
    }));

    const report = formatRangeReport(prs, baseOptions);
    expect(report).not.toContain('release-cadence threshold');
  });
  it('reports diff size, the axis the runtime count does not measure', () => {
    // A range can be almost entirely non-runtime and still hand the release
    // reviewer every one of those files. Runtime count answers "how much prod
    // risk"; this answers "how much is there to read".
    const prs: MergedPr[] = [
      { number: 1, title: 'docs: a', mergedAt: '2026-04-22T11:00:00Z', files: ['docs/a.md'] },
    ];

    const report = formatRangeReport(prs, { ...baseOptions, changedFiles: 175 });

    expect(report).toContain(
      'Diff size: 175 files changed (GitHub stops rendering a diff at 300).'
    );
    expect(report).not.toContain('review-capacity threshold');
  });

  it('advises a cut on diff size even when the runtime count is nowhere near its own threshold', () => {
    // The whole point of the second trigger: one non-runtime PR, so the
    // runtime trailer stays silent, yet the diff is past what a reviewer can
    // hold. Both trailers must be independently reachable.
    const prs: MergedPr[] = [
      { number: 1, title: 'docs: a', mergedAt: '2026-04-22T11:00:00Z', files: ['docs/a.md'] },
    ];

    const report = formatRangeReport(prs, { ...baseOptions, changedFiles: 250 });

    expect(report).toContain('review-capacity threshold');
    expect(report).not.toContain('Runtime count at release-cadence threshold');
  });

  it('does NOT advise at one file below the threshold — pins the >= boundary from below', () => {
    const prs: MergedPr[] = [
      { number: 1, title: 'docs: a', mergedAt: '2026-04-22T11:00:00Z', files: ['docs/a.md'] },
    ];
    const report = formatRangeReport(prs, { ...baseOptions, changedFiles: 249 });
    expect(report).toContain('Diff size: 249 files changed');
    expect(report).not.toContain('review-capacity threshold');
  });

  it('omits the diff-size line entirely when the count is unavailable', () => {
    // countRangeChangedFiles returns undefined rather than throwing when git
    // cannot answer; the report must degrade to silence, not to "0 files".
    const prs: MergedPr[] = [
      { number: 1, title: 'docs: a', mergedAt: '2026-04-22T11:00:00Z', files: ['docs/a.md'] },
    ];

    const report = formatRangeReport(prs, baseOptions);

    expect(report).not.toContain('Diff size:');
    expect(report).not.toContain('review-capacity threshold');
  });

  it('prints a zero diff size rather than omitting it — 0 is an answer, undefined is not', () => {
    const report = formatRangeReport([], { ...baseOptions, changedFiles: 0 });
    expect(report).toContain('Diff size: 0 files changed');
  });
});

describe('releaseRange', () => {
  let stdout: string;
  let stderr: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdout = '';
    stderr = '';
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
      stdout += String(chunk);
      return true;
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
      stderr += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('auto-discovers the previous tag and default base when options are empty', () => {
    mockedDiscoverPrevTag.mockReturnValueOnce('v3.0.0-beta.103');
    mockedTagTimestamp.mockReturnValueOnce('2026-04-22T10:00:00Z');
    mockedListMergedPrsSince.mockReturnValueOnce([
      {
        number: 869,
        title: 'feat(ai): X',
        mergedAt: '2026-04-22T11:00:00Z',
        files: ['services/ai-worker/x.ts'],
      },
    ]);

    releaseRange({});

    expect(mockedDiscoverPrevTag).toHaveBeenCalledOnce();
    expect(mockedTagTimestamp).toHaveBeenCalledWith('v3.0.0-beta.103');
    expect(mockedListMergedPrsSince).toHaveBeenCalledWith('2026-04-22T10:00:00Z', 'develop');
    expect(stdout).toContain('Range: v3.0.0-beta.103');
    expect(stdout).toContain('#869');
  });

  it('uses --from and --base verbatim, without calling discoverPrevTag', () => {
    mockedTagTimestamp.mockReturnValueOnce('2026-04-20T00:00:00Z');
    mockedListMergedPrsSince.mockReturnValueOnce([]);

    releaseRange({ from: 'v3.0.0-beta.101', base: 'main' });

    expect(mockedDiscoverPrevTag).not.toHaveBeenCalled();
    expect(mockedTagTimestamp).toHaveBeenCalledWith('v3.0.0-beta.101');
    expect(mockedListMergedPrsSince).toHaveBeenCalledWith('2026-04-20T00:00:00Z', 'main');
  });

  it('threads the range file count into the printed report', () => {
    // The seam: formatRangeReport is unit-tested with changedFiles passed in
    // directly, so only this asserts releaseRange actually calls the counter
    // and forwards its result. Without it the wiring could be dropped and
    // every formatRangeReport test would still pass.
    mockedDiscoverPrevTag.mockReturnValueOnce('v3.0.0-beta.103');
    mockedTagTimestamp.mockReturnValueOnce('2026-04-22T10:00:00Z');
    mockedListMergedPrsSince.mockReturnValueOnce([]);
    mockedCountRangeChangedFiles.mockReturnValueOnce(175);

    releaseRange({});

    expect(mockedCountRangeChangedFiles).toHaveBeenCalledWith('v3.0.0-beta.103', 'develop');
    expect(stdout).toContain('Diff size: 175 files changed');
  });

  it('still prints a report when the file count is unavailable', () => {
    mockedDiscoverPrevTag.mockReturnValueOnce('v3.0.0-beta.103');
    mockedTagTimestamp.mockReturnValueOnce('2026-04-22T10:00:00Z');
    mockedListMergedPrsSince.mockReturnValueOnce([]);
    mockedCountRangeChangedFiles.mockReturnValueOnce(undefined);

    releaseRange({});

    expect(stdout).toContain('Total: 0 PRs');
    expect(stdout).not.toContain('Diff size:');
  });

  it('warns on stderr when the diff size is unmeasurable, so a skip cannot read as a pass', () => {
    mockedDiscoverPrevTag.mockReturnValueOnce('v3.0.0-beta.103');
    mockedTagTimestamp.mockReturnValueOnce('2026-04-22T10:00:00Z');
    mockedListMergedPrsSince.mockReturnValueOnce([]);
    mockedCountRangeChangedFiles.mockReturnValueOnce(undefined);

    releaseRange({});

    expect(stderr).toContain('SKIPPED, not passed');
    expect(stdout).not.toContain('Diff size:');
  });

  it('stays quiet on stderr when the diff size IS measurable', () => {
    mockedDiscoverPrevTag.mockReturnValueOnce('v3.0.0-beta.103');
    mockedTagTimestamp.mockReturnValueOnce('2026-04-22T10:00:00Z');
    mockedListMergedPrsSince.mockReturnValueOnce([
      { number: 1, title: 'feat: x', mergedAt: '2026-04-22T11:00:00Z', files: ['services/a.ts'] },
    ]);
    mockedCountRangeChangedFiles.mockReturnValueOnce(12);

    releaseRange({});

    expect(stderr).not.toContain('SKIPPED');
  });

  it('writes a stderr note and still prints the zero-count report when no PRs are in range', () => {
    mockedDiscoverPrevTag.mockReturnValueOnce('v3.0.0-beta.103');
    mockedTagTimestamp.mockReturnValueOnce('2026-04-22T10:00:00Z');
    mockedListMergedPrsSince.mockReturnValueOnce([]);

    releaseRange({});

    expect(stderr).toContain('No PRs merged');
    expect(stdout).toContain('Total: 0 PRs — 0 runtime, 0 non-runtime');
  });
});
