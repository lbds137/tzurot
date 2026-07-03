/**
 * Tests for the health report-only extras. The gh seam is mocked and the
 * arguments crossing it are asserted (the exact gh invocations ARE the
 * contract); the margin collectors run against real temp-dir baselines.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import {
  collectSecuritySurface,
  collectLinesMarginBullets,
  collectCpdMarginBullets,
  collectMutationMarginBullets,
  collectHealthExtras,
  formatHealthExtras,
  type HealthExtras,
} from './health-extras.js';

async function withTmpRepo(
  files: Record<string, string>,
  run: (rootDir: string) => Promise<void>
): Promise<void> {
  const rootDir = await mkdtemp(join(tmpdir(), 'health-extras-test-'));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const full = join(rootDir, relPath);
      await mkdir(join(full, '..'), { recursive: true });
      await writeFile(full, content);
    }
    await run(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

describe('collectSecuritySurface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts Dependabot PRs and alerts via the exact gh invocations', () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      return (args as string[])[0] === 'pr' ? '3\n' : '1\n';
    });

    const surface = collectSecuritySurface();

    expect(surface).toEqual({ available: true, dependabotPrs: 3, dependabotAlerts: 1 });
    // The args crossing the subprocess seam are the contract — a silently
    // reworded --jq filter would count the wrong thing while still "passing".
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'gh',
      [
        'pr',
        'list',
        '--author',
        'app/dependabot',
        '--state',
        'open',
        '--json',
        'number',
        '--jq',
        'length',
      ],
      expect.objectContaining({ encoding: 'utf-8' })
    );
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'gh',
      [
        'api',
        'repos/{owner}/{repo}/dependabot/alerts',
        '--jq',
        '[.[] | select(.state=="open")] | length',
      ],
      expect.objectContaining({ encoding: 'utf-8' })
    );
  });

  it('degrades to unavailable with the gh stderr diagnostic when gh fails', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      const error = new Error('Command failed: gh pr list') as Error & { stderr: string };
      error.stderr = 'To get started with GitHub CLI, please run: gh auth login\n';
      throw error;
    });

    const surface = collectSecuritySurface();

    expect(surface).toEqual({
      available: false,
      reason: 'To get started with GitHub CLI, please run: gh auth login',
    });
  });

  it('degrades to unavailable when gh emits something non-numeric', () => {
    vi.mocked(execFileSync).mockReturnValue('not a count');

    const surface = collectSecuritySurface();

    expect(surface.available).toBe(false);
    if (!surface.available) {
      expect(surface.reason).toContain('unexpected gh output');
    }
  });
});

describe('collectLinesMarginBullets', () => {
  it('reports live measured lines against the baseline ceiling per surface', async () => {
    await withTmpRepo(
      {
        '.github/baselines/lines-baseline.json': JSON.stringify({
          surfaces: {
            rules: { lines: 4, graceMargin: 6 },
            current: { lines: 2, graceMargin: 3 },
          },
        }),
        '.claude/rules/00-a.md': 'one\ntwo\nthree\n',
        'CURRENT.md': 'status\n',
      },
      async rootDir => {
        expect(collectLinesMarginBullets(rootDir)).toEqual([
          'lines rules: 3/10 (7 headroom, live measure)',
          'lines current: 1/5 (4 headroom, live measure)',
        ]);
      }
    );
  });

  it('degrades when the baseline file is missing', async () => {
    await withTmpRepo({}, async rootDir => {
      const bullets = collectLinesMarginBullets(rootDir);
      expect(bullets).toHaveLength(1);
      expect(bullets[0]).toContain('lines: unavailable');
    });
  });

  it('flags an unmeasurable surface instead of pretending 0 lines of usage', async () => {
    await withTmpRepo(
      {
        '.github/baselines/lines-baseline.json': JSON.stringify({
          surfaces: { rules: { lines: 4, graceMargin: 6 } },
        }),
      },
      async rootDir => {
        expect(collectLinesMarginBullets(rootDir)).toEqual([
          'lines rules: unmeasurable (surface matched zero files)',
        ]);
      }
    );
  });
});

describe('collectCpdMarginBullets', () => {
  const emptyJscpdReport = JSON.stringify({
    duplicates: [],
    statistics: { total: { clones: 0, duplicatedLines: 0 } },
  });

  it('recomputes the filtered count from the on-disk report, labeled stale-ok', async () => {
    await withTmpRepo(
      {
        '.github/baselines/cpd-baseline.json': JSON.stringify({
          filteredLines: 10,
          graceMargin: 5,
          threshold: 0.8,
        }),
        'reports/jscpd/jscpd-report.json': emptyJscpdReport,
      },
      async rootDir => {
        expect(collectCpdMarginBullets(rootDir)).toEqual([
          'cpd filteredLines: 0/15 (15 headroom, as of last `pnpm cpd` run — stale-ok)',
        ]);
      }
    );
  });

  it('degrades when no jscpd report exists (no silent fabrication of a measurement)', async () => {
    await withTmpRepo(
      {
        '.github/baselines/cpd-baseline.json': JSON.stringify({
          filteredLines: 10,
          graceMargin: 5,
        }),
      },
      async rootDir => {
        const bullets = collectCpdMarginBullets(rootDir);
        expect(bullets).toHaveLength(1);
        expect(bullets[0]).toContain('no jscpd report on disk');
      }
    );
  });
});

describe('collectMutationMarginBullets', () => {
  it('reports baseline score + floor only, labeled as no live run', async () => {
    await withTmpRepo(
      {
        '.github/baselines/mutation-baseline.json': JSON.stringify({
          packages: { 'config-resolver': { score: 87.81, graceMargin: 1 } },
        }),
      },
      async rootDir => {
        expect(collectMutationMarginBullets(rootDir)).toEqual([
          'mutation config-resolver: baseline score 87.81, floor 86.81 (baseline only — no live run)',
        ]);
      }
    );
  });

  it('degrades when the mutation baseline is missing', async () => {
    await withTmpRepo({}, async rootDir => {
      expect(collectMutationMarginBullets(rootDir)).toEqual([
        'mutation: unavailable (no mutation-baseline.json)',
      ]);
    });
  });
});

describe('collectHealthExtras', () => {
  it('never throws — every section degrades in place on a bare directory', async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('gh: command not found');
    });

    await withTmpRepo({}, async rootDir => {
      const extras = collectHealthExtras(rootDir);

      expect(extras.security.available).toBe(false);
      // One degraded bullet per ratchet (lines, cpd, mutation).
      expect(extras.marginBullets).toHaveLength(3);
      expect(extras.docsOrphans).toEqual({ totalDocs: 0, orphans: [] });
    });
  });
});

describe('formatHealthExtras', () => {
  it('renders the three H3 sections with orphan paths listed', () => {
    const extras: HealthExtras = {
      security: { available: true, dependabotPrs: 2, dependabotAlerts: 0 },
      marginBullets: ['lines rules: 1900/2150 (250 headroom, live measure)'],
      docsOrphans: { totalDocs: 40, orphans: ['docs/reference/lost-runbook.md'] },
    };

    const text = formatHealthExtras(extras);

    expect(text).toContain('### Security surface (report-only)');
    expect(text).toContain('- Dependabot PRs open: 2');
    expect(text).toContain('- Dependabot alerts open: 0');
    expect(text).toContain('### Ratchet margins (report-only)');
    expect(text).toContain('- lines rules: 1900/2150 (250 headroom, live measure)');
    expect(text).toContain('### Docs orphans (report-only)');
    expect(text).toContain('- 1 of 40 docs/reference files have no inbound markdown links:');
    expect(text).toContain('  - docs/reference/lost-runbook.md');
  });

  it('renders degraded sections honestly', () => {
    const extras: HealthExtras = {
      security: { available: false, reason: 'gh auth missing' },
      marginBullets: ['cpd: unavailable (no jscpd report on disk — run `pnpm cpd` first)'],
      docsOrphans: { unavailable: 'permission denied' },
    };

    const text = formatHealthExtras(extras);

    expect(text).toContain('- security: unavailable (gh auth missing)');
    expect(text).toContain('- cpd: unavailable');
    expect(text).toContain('- docs-orphan scan: unavailable (permission denied)');
  });

  it('reports a clean docs tree as zero orphans', () => {
    const extras: HealthExtras = {
      security: { available: false, reason: 'x' },
      marginBullets: [],
      docsOrphans: { totalDocs: 40, orphans: [] },
    };

    expect(formatHealthExtras(extras)).toContain(
      '- 0 of 40 docs/reference files lack inbound markdown links'
    );
  });
});
