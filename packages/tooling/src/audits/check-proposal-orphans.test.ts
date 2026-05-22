/**
 * Tests for the proposal orphan-check tool.
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { findProposalOrphans, checkProposalOrphans } from './check-proposal-orphans.js';
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

describe('findProposalOrphans', () => {
  it('returns zero orphans when every proposal is linked', async () => {
    await withTempRepo(root => {
      scaffold(root, {
        'docs/proposals/backlog/foo.md': '# Foo proposal',
        'docs/proposals/backlog/bar.md': '# Bar proposal',
        'backlog/future-themes.md': 'See [foo](../docs/proposals/backlog/foo.md) and bar.',
      });
      const result = findProposalOrphans(root);
      expect(result.totalProposals).toBe(2);
      expect(result.orphans).toEqual([]);
    });
  });

  it('detects an orphan proposal', async () => {
    await withTempRepo(root => {
      scaffold(root, {
        'docs/proposals/backlog/linked.md': '# Linked',
        'docs/proposals/backlog/orphan.md': '# Orphan',
        'backlog/future-themes.md': 'Mentions linked but not the other.',
      });
      const result = findProposalOrphans(root);
      expect(result.totalProposals).toBe(2);
      expect(result.orphans).toHaveLength(1);
      expect(result.orphans[0]).toContain('orphan.md');
    });
  });

  it('accepts inbound link from CURRENT.md at repo root', async () => {
    await withTempRepo(root => {
      scaffold(root, {
        'docs/proposals/backlog/foo.md': '# Foo',
        'CURRENT.md': 'See foo for details.',
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
        'docs/proposals/backlog/foo.md': '# Foo',
        'BACKLOG.md': 'See [foo](docs/proposals/backlog/foo.md) in the queue.',
      });
      const result = findProposalOrphans(root);
      expect(result.orphans).toEqual([]);
    });
  });

  it('accepts inbound link from docs/reference/', async () => {
    await withTempRepo(root => {
      scaffold(root, {
        'docs/proposals/backlog/foo.md': '# Foo',
        'docs/reference/architecture/some-doc.md': 'Related: foo.',
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
        'docs/proposals/backlog/foo.md': '# Foo',
        'docs/research/some-note.md': 'See foo for context.',
        'docs/proposals/backlog/bar.md': '# Bar',
        'docs/incidents/postmortem.md': 'See bar.',
        'docs/proposals/backlog/baz.md': '# Baz',
        'docs/README.md': 'Index includes baz.',
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
        'docs/proposals/backlog/foo.md': '# Foo — see bar.',
        'docs/proposals/backlog/bar.md': '# Bar — see foo.',
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
    });
  });

  it('finds orphans across nested backlog subdirectories', async () => {
    await withTempRepo(root => {
      scaffold(root, {
        'docs/proposals/backlog/foo.md': '# Foo',
        'backlog/sections/nested.md': 'Mentions foo.',
      });
      const result = findProposalOrphans(root);
      expect(result.orphans).toEqual([]);
    });
  });
});

describe('checkProposalOrphans (CLI entry point with --summary)', () => {
  it('emits an ok JSONL summary line when there are no orphans', async () => {
    await withTempRepo(async root => {
      scaffold(root, {
        'docs/proposals/backlog/foo.md': '# Foo',
        'backlog/future-themes.md': 'See foo.',
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
        'docs/proposals/backlog/foo.md': '# Foo',
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
  });
});
