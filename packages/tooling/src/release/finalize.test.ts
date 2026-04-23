import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockedExec = vi.mocked(execFileSync);

// Import AFTER the mock so the module binding captures the vi.mock version.
import { finalizeRelease } from './finalize.js';

/**
 * Lookup table helper: match on the first git subcommand argument and
 * return canned stdout. `git status --porcelain` → clean working tree,
 * `git rev-list --count ...` → number of commits, everything else → ''.
 *
 * Individual tests override specific subcommands via a nested map.
 */
function mockGit(overrides: Record<string, string | (() => string)> = {}): void {
  mockedExec.mockImplementation(((_cmd: string, args: readonly string[]) => {
    // The first arg after 'git' identifies the subcommand (e.g. 'status',
    // 'rev-list', 'rebase'); the second arg disambiguates for subcommands
    // that share a name across cases.
    const key = args.slice(0, 2).join(' ');
    const subKey = args[0];
    if (key in overrides) {
      const v = overrides[key];
      return typeof v === 'function' ? v() : v;
    }
    if (subKey in overrides) {
      const v = overrides[subKey];
      return typeof v === 'function' ? v() : v;
    }
    // Defaults: clean working tree, zero-commit rev-list output.
    if (key === 'status --porcelain') return '';
    if (key === 'rev-list --count') return '0\n';
    return '';
  }) as unknown as typeof execFileSync);
}

describe('finalizeRelease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Silence console output unless a test explicitly checks it.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('no-op path', () => {
    it('exits early when develop already contains every main commit', async () => {
      mockGit({ 'rev-list --count': '0\n' });

      await finalizeRelease({ yes: true });

      // Should fetch and check ahead-count, but NOT checkout, pull, rebase, push.
      const invocations = mockedExec.mock.calls.map(c => (c[1] as string[]).join(' '));
      expect(invocations).toContain('fetch --all');
      expect(invocations).toContain('rev-list --count origin/develop..origin/main');
      expect(invocations.some(cmd => cmd.startsWith('checkout'))).toBe(false);
      expect(invocations.some(cmd => cmd.startsWith('rebase'))).toBe(false);
      expect(invocations.some(cmd => cmd.startsWith('push'))).toBe(false);
    });
  });

  describe('happy path', () => {
    it('runs the full finalize sequence when main is ahead of develop', async () => {
      mockGit({ 'rev-list --count': '3\n' });

      await finalizeRelease({ yes: true });

      const invocations = mockedExec.mock.calls.map(c => (c[1] as string[]).join(' '));
      // Sequence is load-bearing — the rebase MUST come after both
      // checkouts and MUST precede the push.
      const fetchIdx = invocations.indexOf('fetch --all');
      const checkoutMainIdx = invocations.indexOf('checkout main');
      const pullMainIdx = invocations.indexOf('pull --ff-only');
      const checkoutDevIdx = invocations.indexOf('checkout develop');
      const rebaseIdx = invocations.indexOf('rebase origin/main');
      const pushIdx = invocations.indexOf('push --force-with-lease');

      expect(fetchIdx).toBeGreaterThanOrEqual(0);
      expect(checkoutMainIdx).toBeGreaterThan(fetchIdx);
      expect(pullMainIdx).toBeGreaterThan(checkoutMainIdx);
      expect(checkoutDevIdx).toBeGreaterThan(pullMainIdx);
      expect(rebaseIdx).toBeGreaterThan(checkoutDevIdx);
      expect(pushIdx).toBeGreaterThan(rebaseIdx);
    });
  });

  describe('dirty working tree', () => {
    it('refuses to run if git status shows uncommitted changes', async () => {
      mockGit({ 'status --porcelain': 'M some-file.ts\n' });

      await expect(finalizeRelease({ yes: true })).rejects.toThrow(/Working tree is not clean/);

      // Should have bailed before fetch.
      const invocations = mockedExec.mock.calls.map(c => (c[1] as string[]).join(' '));
      expect(invocations).not.toContain('fetch --all');
    });

    it('skips the clean-tree check in dry-run mode', async () => {
      // Dry-run is preview-only — inspecting state while mid-work should
      // be allowed. Zero commits to rebase so we exit on the no-op path.
      mockGit({ 'status --porcelain': 'M some-file.ts\n', 'rev-list --count': '0\n' });

      await expect(finalizeRelease({ dryRun: true, yes: true })).resolves.toBeUndefined();
    });
  });

  describe('rebase conflict handling', () => {
    it('aborts the rebase and re-throws when rebase fails', async () => {
      let rebaseAttempted = false;
      let abortCalled = false;
      mockGit({
        'rev-list --count': '3\n',
        rebase: () => {
          // First call is the rebase attempt; second (via --abort) would
          // be the cleanup. Only the first is a conflict.
          if (!rebaseAttempted) {
            rebaseAttempted = true;
            throw new Error('CONFLICT: merge conflict in foo.ts');
          }
          abortCalled = true;
          return '';
        },
      });

      await expect(finalizeRelease({ yes: true })).rejects.toThrow(/CONFLICT/);
      expect(rebaseAttempted).toBe(true);
      // Verify --abort was attempted — leaving the user in a rebase-in-progress
      // state would be worse than the original conflict.
      expect(abortCalled).toBe(true);
    });

    it('swallows a secondary --abort failure to surface the original error', async () => {
      // If `rebase --abort` itself fails (e.g., no rebase in progress),
      // the primary conflict error is still what the user needs to see.
      mockGit({
        'rev-list --count': '3\n',
        rebase: () => {
          throw new Error('CONFLICT: original error');
        },
      });

      // Override: the abort path also throws. The test asserts we see
      // the ORIGINAL error, not the secondary one.
      await expect(finalizeRelease({ yes: true })).rejects.toThrow(/CONFLICT: original error/);
    });
  });

  describe('dry-run mode', () => {
    it('never executes checkout/rebase/push in dry-run', async () => {
      mockGit({ 'rev-list --count': '3\n' });

      await finalizeRelease({ dryRun: true, yes: true });

      // Dry-run still needs to read state (status, rev-list via fetch
      // wouldn't run in dry-run, rev-list itself is a read). Writes must
      // never fire.
      const invocations = mockedExec.mock.calls.map(c => (c[1] as string[]).join(' '));
      // rev-list is the only read allowed post-fetch; fetch itself is
      // printed, not executed, in dry-run.
      expect(invocations).not.toContain('fetch --all');
      expect(invocations).not.toContain('checkout main');
      expect(invocations).not.toContain('checkout develop');
      expect(invocations).not.toContain('rebase origin/main');
      expect(invocations).not.toContain('push --force-with-lease');
    });
  });

  describe('non-TTY safety', () => {
    it('requires --yes when stdin is non-TTY to run the force-push path', async () => {
      // Simulate non-TTY by stubbing isTTY. In practice vitest's stdin
      // is already non-TTY, but asserting explicitly keeps the test
      // robust against future vitest changes.
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', {
        value: false,
        configurable: true,
      });

      try {
        mockGit({ 'rev-list --count': '3\n' });

        // No --yes — should bail before force-push.
        await finalizeRelease({});

        const invocations = mockedExec.mock.calls.map(c => (c[1] as string[]).join(' '));
        expect(invocations).not.toContain('push --force-with-lease');
      } finally {
        Object.defineProperty(process.stdin, 'isTTY', {
          value: originalIsTTY,
          configurable: true,
        });
      }
    });
  });
});
