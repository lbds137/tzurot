import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./github-prs.js', () => ({
  discoverPrevTag: vi.fn(),
  tagTimestamp: vi.fn(),
  listMergedPrsSince: vi.fn(),
  DEFAULT_BASE_BRANCH: 'develop',
}));

import { releaseRange, formatRangeReport, classifyPr, isNonRuntimeFile } from './range.js';
import { discoverPrevTag, tagTimestamp, listMergedPrsSince } from './github-prs.js';
import type { MergedPr } from './notes-format.js';

const mockedDiscoverPrevTag = vi.mocked(discoverPrevTag);
const mockedTagTimestamp = vi.mocked(tagTimestamp);
const mockedListMergedPrsSince = vi.mocked(listMergedPrsSince);

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

  it('writes a stderr note and still prints the zero-count report when no PRs are in range', () => {
    mockedDiscoverPrevTag.mockReturnValueOnce('v3.0.0-beta.103');
    mockedTagTimestamp.mockReturnValueOnce('2026-04-22T10:00:00Z');
    mockedListMergedPrsSince.mockReturnValueOnce([]);

    releaseRange({});

    expect(stderr).toContain('No PRs merged');
    expect(stdout).toContain('Total: 0 PRs — 0 runtime, 0 non-runtime');
  });
});
