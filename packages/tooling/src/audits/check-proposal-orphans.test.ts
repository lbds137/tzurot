/**
 * Tests for the proposal orphan-check tool.
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  findProposalOrphans,
  checkProposalOrphans,
  isSingleSegmentSlug,
} from './check-proposal-orphans.js';
import { parseSummary } from './summary.js';

async function withTempRepo<T>(fn: (root: string) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'orphan-check-'));
  try {
    return await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function scaffold(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

describe('isSingleSegmentSlug', () => {
  it('returns true for hyphen-less slugs', () => {
    expect(isSingleSegmentSlug('memory')).toBe(true);
    expect(isSingleSegmentSlug('api')).toBe(true);
    expect(isSingleSegmentSlug('shapes')).toBe(true);
  });

  it('returns false for kebab-case slugs', () => {
    expect(isSingleSegmentSlug('memory-and-context-redesign')).toBe(false);
    expect(isSingleSegmentSlug('shapes-inc-fetcher-hardening')).toBe(false);
    expect(isSingleSegmentSlug('two-segments')).toBe(false);
  });

  it('returns false for SCREAMING_SNAKE_CASE slugs (legacy proposals)', () => {
    // Underscores function as segment separators for the orphan-check
    // regex just like hyphens do, so legacy proposal names like
    // GIT_HOOK_IMPROVEMENTS.md aren't flagged as imprecise.
    expect(isSingleSegmentSlug('GIT_HOOK_IMPROVEMENTS')).toBe(false);
    expect(isSingleSegmentSlug('MEMORY_INGESTION_IMPROVEMENTS')).toBe(false);
  });
});

describe('findProposalOrphans', () => {
  it('returns zero orphans when every proposal is linked', async () => {
    await withTempRepo(root => {
      scaffold(root, {
        'docs/proposals/backlog/foo-proposal.md': '# Foo proposal',
        'docs/proposals/backlog/bar-proposal.md': '# Bar proposal',
        'backlog/future-themes.md':
          'See [foo](../docs/proposals/backlog/foo-proposal.md) and bar-proposal.',
      });
      const result = findProposalOrphans(root);
      expect(result.totalProposals).toBe(2);
      expect(result.orphans).toEqual([]);
      expect(result.singleSegmentSlugs).toEqual([]);
    });
  });

  it('detects an orphan proposal', async () => {
    await withTempRepo(root => {
      scaffold(root, {
        'docs/proposals/backlog/linked-proposal.md': '# Linked',
        'docs/proposals/backlog/orphan-proposal.md': '# Orphan',
        'backlog/future-themes.md': 'Mentions linked-proposal but not the other.',
      });
      const result = findProposalOrphans(root);
      expect(result.totalProposals).toBe(2);
      expect(result.orphans).toHaveLength(1);
      expect(result.orphans[0]).toContain('orphan-proposal.md');
    });
  });

  it('accepts inbound link from CURRENT.md at repo root', async () => {
    await withTempRepo(root => {
      scaffold(root, {
        'docs/proposals/backlog/foo-proposal.md': '# Foo',
        'CURRENT.md': 'See foo-proposal for details.',
      });
      const result = findProposalOrphans(root);
      expect(result.orphans).toEqual([]);
    });
  });

  it('accepts inbound link from BACKLOG.md at repo root', async () => {
    // BACKLOG.md is the index pointing into backlog/*.md per CLAUDE.md's
    // "Work tracking" entry; a proposal link there should rescue the proposal
    // just like CURRENT.md does.
    await withTempRepo(root => {
      scaffold(root, {
        'docs/proposals/backlog/foo-proposal.md': '# Foo',
        'BACKLOG.md': 'See [foo-proposal](docs/proposals/backlog/foo-proposal.md) in the queue.',
      });
      const result = findProposalOrphans(root);
      expect(result.orphans).toEqual([]);
    });
  });

  it('accepts inbound link from docs/reference/', async () => {
    await withTempRepo(root => {
      scaffold(root, {
        'docs/proposals/backlog/foo-proposal.md': '# Foo',
        'docs/reference/architecture/some-doc.md': 'Related: foo-proposal.',
      });
      const result = findProposalOrphans(root);
      expect(result.orphans).toEqual([]);
    });
  });

  it('accepts inbound link from any non-proposal docs subdir', async () => {
    // docs/research/, docs/incidents/, docs/README.md, etc. all count.
    // The real failure mode is "no human-visible reference anywhere."
    await withTempRepo(root => {
      scaffold(root, {
        'docs/proposals/backlog/foo-proposal.md': '# Foo',
        'docs/research/some-note.md': 'See foo-proposal for context.',
        'docs/proposals/backlog/bar-proposal.md': '# Bar',
        'docs/incidents/postmortem.md': 'See bar-proposal.',
        'docs/proposals/backlog/baz-proposal.md': '# Baz',
        'docs/README.md': 'Index includes baz-proposal.',
      });
      const result = findProposalOrphans(root);
      expect(result.orphans).toEqual([]);
    });
  });

  it('does NOT count a link from another proposal as inbound', async () => {
    // Proposals linking to other proposals doesn't satisfy the "is this
    // tracked from the backlog?" question. Self-referential links inside
    // the proposals dir shouldn't rescue an orphan.
    await withTempRepo(root => {
      scaffold(root, {
        'docs/proposals/backlog/foo-proposal.md': '# Foo — see bar-proposal.',
        'docs/proposals/backlog/bar-proposal.md': '# Bar — see foo-proposal.',
      });
      const result = findProposalOrphans(root);
      expect(result.orphans).toHaveLength(2);
    });
  });

  it('handles missing proposals directory gracefully', async () => {
    await withTempRepo(root => {
      const result = findProposalOrphans(root);
      expect(result.totalProposals).toBe(0);
      expect(result.orphans).toEqual([]);
      expect(result.singleSegmentSlugs).toEqual([]);
    });
  });

  it('finds orphans across nested backlog subdirectories', async () => {
    await withTempRepo(root => {
      scaffold(root, {
        'docs/proposals/backlog/foo-proposal.md': '# Foo',
        'backlog/sections/nested.md': 'Mentions foo-proposal.',
      });
      const result = findProposalOrphans(root);
      expect(result.orphans).toEqual([]);
    });
  });

  it('flags single-segment proposal slugs separately from orphans', async () => {
    // `memory.md` is a single-segment basename — the word-boundary regex
    // can't distinguish a genuine link from any prose mention of "memory",
    // so it gets reported as a slug-shape violation, NOT subjected to the
    // orphan-match (which would be unreliable). The CLI hard-fails on either.
    await withTempRepo(root => {
      scaffold(root, {
        'docs/proposals/backlog/memory.md': '# Memory',
        'docs/proposals/backlog/api.md': '# API',
        'docs/proposals/backlog/valid-name.md': '# Valid',
        'backlog/future-themes.md': 'See valid-name.',
      });
      const result = findProposalOrphans(root);
      expect(result.totalProposals).toBe(3);
      expect(result.singleSegmentSlugs).toHaveLength(2);
      expect(result.singleSegmentSlugs.some(s => s.includes('memory.md'))).toBe(true);
      expect(result.singleSegmentSlugs.some(s => s.includes('api.md'))).toBe(true);
      // valid-name had an inbound link → no orphan, and not a single-segment slug
      expect(result.orphans).toEqual([]);
    });
  });

  it('reports a single-segment slug even when it would be linked', async () => {
    // The constraint is on the NAME, not on linkage — a single-word slug
    // is unreliable regardless of whether something happens to mention it.
    await withTempRepo(root => {
      scaffold(root, {
        'docs/proposals/backlog/memory.md': '# Memory',
        'backlog/future-themes.md':
          'See [memory](../docs/proposals/backlog/memory.md) in the queue.',
      });
      const result = findProposalOrphans(root);
      expect(result.singleSegmentSlugs).toHaveLength(1);
      expect(result.orphans).toEqual([]);
    });
  });
});

describe('checkProposalOrphans (CLI entry point with --summary)', () => {
  it('emits an ok JSONL summary line when there are no orphans', async () => {
    await withTempRepo(async root => {
      scaffold(root, {
        'docs/proposals/backlog/foo-proposal.md': '# Foo',
        'backlog/future-themes.md': 'See foo-proposal.',
      });
      const captured: string[] = [];
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        captured.push(args.map(a => String(a)).join(' '));
      });
      try {
        await checkProposalOrphans({ repoRoot: root, summary: true });
      } finally {
        consoleSpy.mockRestore();
      }
      const summary = parseSummary(captured[captured.length - 1]);
      expect(summary.tool).toBe('guard:proposal-links');
      expect(summary.status).toBe('ok');
      expect(summary.findings).toBe(0);
    });
  });

  it('emits a fail JSONL summary line + exits 1 when orphans exist', async () => {
    await withTempRepo(async root => {
      scaffold(root, {
        'docs/proposals/backlog/foo-proposal.md': '# Foo',
        // No inbound link anywhere → orphan
      });
      // Reset the module cache so the dynamic import below returns a fresh
      // instance, avoiding cross-test state from any prior import during
      // watch-mode runs. (The spies don't need to intercept module-load-time
      // `process.exit` lookups — the implementation calls `process.exit`
      // directly at call time — but the fresh-import pattern keeps this
      // test's behavior identical between cold and watch runs.)
      vi.resetModules();
      const captured: string[] = [];
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        captured.push(args.map(a => String(a)).join(' '));
      });
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      try {
        const { checkProposalOrphans: checkFresh } = await import('./check-proposal-orphans.js');
        await checkFresh({ repoRoot: root, summary: true });
        // Assertions inside try so they run BEFORE mockRestore() clears the
        // spy's call history. (Vitest's mockRestore both restores the
        // original and resets recorded calls — assertions after restore
        // would see zero calls regardless of what happened.)
        const summary = parseSummary(captured[captured.length - 1]);
        expect(summary.tool).toBe('guard:proposal-links');
        expect(summary.status).toBe('fail');
        expect(summary.findings).toBe(1);
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        consoleSpy.mockRestore();
        exitSpy.mockRestore();
      }
    });
  });

  it('summary findings count includes single-segment slugs', async () => {
    // findings = orphans.length + singleSegmentSlugs.length, so a repo
    // with one orphan AND one bad slug reports findings=2.
    await withTempRepo(async root => {
      scaffold(root, {
        'docs/proposals/backlog/memory.md': '# Memory (single-segment slug)',
        'docs/proposals/backlog/unlinked-proposal.md': '# Unlinked orphan',
        // No inbound links anywhere
      });
      vi.resetModules();
      const captured: string[] = [];
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        captured.push(args.map(a => String(a)).join(' '));
      });
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      try {
        const { checkProposalOrphans: checkFresh } = await import('./check-proposal-orphans.js');
        await checkFresh({ repoRoot: root, summary: true });
        const summary = parseSummary(captured[captured.length - 1]);
        expect(summary.status).toBe('fail');
        expect(summary.findings).toBe(2);
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        consoleSpy.mockRestore();
        exitSpy.mockRestore();
      }
    });
  });
});

describe('checkProposalOrphans (CLI entry point, non-summary path)', () => {
  it('prints orphan listing + fix-hint paragraph + exits 1', async () => {
    await withTempRepo(async root => {
      scaffold(root, {
        'docs/proposals/backlog/unlinked-proposal.md': '# Orphan',
        // No inbound link anywhere → orphan
      });
      vi.resetModules();
      const captured: string[] = [];
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        captured.push(args.map(a => String(a)).join(' '));
      });
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      try {
        const { checkProposalOrphans: checkFresh } = await import('./check-proposal-orphans.js');
        await checkFresh({ repoRoot: root, summary: false });
        // Assertions inside try (mockRestore would clear call history).
        const allOutput = captured.join('\n');
        expect(allOutput).toContain('unlinked-proposal.md');
        expect(allOutput).toContain('orphan proposal');
        // Help paragraph naming the search roots
        expect(allOutput).toMatch(/backlog\/\*\*\/\*\.md/);
        expect(allOutput).toContain('CURRENT.md');
        expect(allOutput).toContain('BACKLOG.md');
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        consoleSpy.mockRestore();
        exitSpy.mockRestore();
      }
    });
  });

  it('prints single-segment slug help message when slugs are present', async () => {
    await withTempRepo(async root => {
      scaffold(root, {
        'docs/proposals/backlog/memory.md': '# Memory',
      });
      vi.resetModules();
      const captured: string[] = [];
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        captured.push(args.map(a => String(a)).join(' '));
      });
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      try {
        const { checkProposalOrphans: checkFresh } = await import('./check-proposal-orphans.js');
        await checkFresh({ repoRoot: root, summary: false });
        const allOutput = captured.join('\n');
        expect(allOutput).toContain('memory.md');
        expect(allOutput).toContain('single-segment');
        expect(allOutput).toContain('kebab-case');
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        consoleSpy.mockRestore();
        exitSpy.mockRestore();
      }
    });
  });
});

describe('findProposalOrphans (against real repo)', () => {
  it('reports zero orphans on the actual project state', async () => {
    // Sanity check against the current repo — this test fails if a future
    // PR adds an unlinked proposal. The fix is to link it, not to lower
    // the threshold here.
    const repoRoot = join(__dirname, '../../../..');
    const result = findProposalOrphans(repoRoot);
    expect(
      result.orphans,
      `Found unlinked proposals: ${result.orphans.join(', ')}. ` +
        `Link them from backlog/, any non-proposal subdir of docs/, ` +
        `or CURRENT.md — or delete them if the work shipped.`
    ).toEqual([]);
    expect(
      result.singleSegmentSlugs,
      `Found single-segment proposal slugs: ${result.singleSegmentSlugs.join(', ')}. ` +
        `Rename to multi-segment kebab-case (e.g., memory.md → memory-and-context-redesign.md).`
    ).toEqual([]);
  });
});
