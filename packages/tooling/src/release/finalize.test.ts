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
    // Defaults: clean working tree (tracked-only check), zero-commit rev-list.
    if (subKey === 'status') return '';
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
      const pullMainIdx = invocations.indexOf('pull --ff-only origin main');
      const checkoutDevIdx = invocations.indexOf('checkout develop');
      const rebaseIdx = invocations.indexOf('rebase origin/main');
      const pushIdx = invocations.indexOf('push --force-with-lease origin develop');

      expect(fetchIdx).toBeGreaterThanOrEqual(0);
      expect(checkoutMainIdx).toBeGreaterThan(fetchIdx);
      expect(pullMainIdx).toBeGreaterThan(checkoutMainIdx);
      expect(checkoutDevIdx).toBeGreaterThan(pullMainIdx);
      expect(rebaseIdx).toBeGreaterThan(checkoutDevIdx);
      expect(pushIdx).toBeGreaterThan(rebaseIdx);
    });
  });

  describe('dirty working tree', () => {
    it('refuses to run if git status shows uncommitted tracked changes', async () => {
      mockGit({ status: 'M some-file.ts\n' });

      await expect(finalizeRelease({ yes: true })).rejects.toThrow(
        /tracked changes.*Commit or stash/
      );

      // Should have bailed before fetch.
      const invocations = mockedExec.mock.calls.map(c => (c[1] as string[]).join(' '));
      expect(invocations).not.toContain('fetch --all');
    });

    it('uses --untracked-files=no so stray untracked files do not block', async () => {
      // The default mock returns '' from `status`, so this test locks
      // in the flag shape rather than the behavior. `git status
      // --porcelain --untracked-files=no` excludes ??-prefixed lines,
      // meaning a stray notes.txt or .env.local is ignored — matches
      // the actual risk surface (git checkout tolerates untracked files
      // in the 99% case).
      mockGit({ status: '' });

      await finalizeRelease({ yes: true });

      const statusCall = mockedExec.mock.calls.find(c => (c[1] as string[])[0] === 'status');
      expect(statusCall).toBeDefined();
      expect(statusCall![1]).toEqual(['status', '--porcelain', '--untracked-files=no']);
    });

    it('skips the clean-tree check in dry-run mode even when rebase is needed', async () => {
      // Dry-run is preview-only — inspecting state while mid-work should
      // be allowed. Use count = 3 so dry-run actually traverses the
      // full preview path (not just the no-op exit); this proves the
      // clean-tree check is truly bypassed, not just sidestepped by
      // the no-op early-return.
      mockGit({ status: 'M some-file.ts\n', 'rev-list --count': '3\n' });

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
      expect(invocations).not.toContain('push --force-with-lease origin develop');
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
        expect(invocations).not.toContain('push --force-with-lease origin develop');
      } finally {
        Object.defineProperty(process.stdin, 'isTTY', {
          value: originalIsTTY,
          configurable: true,
        });
      }
    });
  });

  describe('edge cases', () => {
    it('throws a descriptive error on malformed rev-list output', async () => {
      // If git's rev-list returns something un-parseable as an integer
      // (shouldn't happen in practice, but a helpful error beats a silent
      // NaN propagating through the rest of the flow).
      mockGit({ 'rev-list --count': 'not-a-number\n' });

      await expect(finalizeRelease({ yes: true })).rejects.toThrow(/Unexpected rev-list output/);
    });

    it('propagates pull errors without attempting recovery (intentional)', async () => {
      // If `pull --ff-only origin main` fails (e.g., local main has
      // diverged from origin/main), the error surfaces as-is. The user
      // may be left on `main` rather than their starting branch. This
      // is intentional: attempting rollback for every pre-rebase step
      // adds complexity for an edge case where git's own error message
      // is already clear. This test pins the behavior so any future
      // refactor that adds rollback logic breaks it on purpose.
      mockGit({
        'rev-list --count': '3\n',
        pull: () => {
          throw new Error('fatal: Not possible to fast-forward, aborting.');
        },
      });

      await expect(finalizeRelease({ yes: true })).rejects.toThrow(/Not possible to fast-forward/);

      // Document what DID run: fetch, status, rev-list, checkout main,
      // pull main (threw). Did NOT reach: checkout develop, rebase, push.
      const invocations = mockedExec.mock.calls.map(c => (c[1] as string[]).join(' '));
      expect(invocations).toContain('checkout main');
      expect(invocations).not.toContain('checkout develop');
      expect(invocations).not.toContain('rebase origin/main');
      expect(invocations).not.toContain('push --force-with-lease origin develop');
    });
  });
});
