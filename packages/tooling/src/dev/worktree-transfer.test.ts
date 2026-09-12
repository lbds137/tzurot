import { describe, it, expect, vi } from 'vitest';

// Every other test injects `runGit`, so this mock is reached only by the
// default-path test below — the one case that exercises the real `execFileSync`.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '') }));

import { execFileSync } from 'node:child_process';
import {
  transferWorktree,
  performRemoval,
  findWorktreeBlock,
  findFirstWorktreePath,
  WORKTREE_TRANSFER_TIMEOUT_MS,
  WORKTREE_TRANSFER_MAX_BUFFER,
  type TransferContext,
} from './worktree-transfer.js';

const MAIN_TREE = '/repo/main';
const WORKTREE = '/repo/.claude/worktrees/agent-abc';
const BRANCH = 'worktree-agent-abc';
const PATCH = 'diff --git a/x b/x\n+hi\n';

/** Build a runGit stub from a handler map keyed on `${cwd ?? ''}::${args.join(' ')}`. */
function gitStub(handlers: Record<string, (args: string[], cwd?: string) => string>) {
  return vi.fn((args: string[], cwd?: string) => {
    const key = `${cwd ?? ''}::${args.join(' ')}`;
    const handler = handlers[key];
    if (handler === undefined) throw new Error(`unexpected git call: ${key}`);
    return handler(args, cwd);
  });
}

function happyHandlers(overrides: Partial<Record<string, string>> = {}) {
  const listing = [
    `worktree ${MAIN_TREE}`,
    'HEAD aaa111',
    'branch refs/heads/feat/thing',
    '',
    `worktree ${WORKTREE}`,
    'HEAD bbb222',
    `branch refs/heads/${BRANCH}`,
  ].join('\n');
  const base: Record<string, string> = {
    [`::rev-parse --show-toplevel`]: `${MAIN_TREE}\n`,
    [`${MAIN_TREE}::rev-parse HEAD`]: 'aaa111\n',
    [`${MAIN_TREE}::rev-parse --verify aaa111^{commit}`]: 'aaa111\n',
    [`${MAIN_TREE}::status --porcelain`]: '',
    [`${MAIN_TREE}::worktree list --porcelain`]: listing,
    [`${WORKTREE}::add -A`]: '',
    [`${WORKTREE}::diff --cached --binary`]: PATCH,
    [`${MAIN_TREE}::diff --cached --binary`]: PATCH,
    [`${WORKTREE}::status --porcelain`]: 'M  file.ts\n',
    [`${WORKTREE}::log --oneline --not --remotes`]: '',
    [`${WORKTREE}::log --oneline aaa111..HEAD`]: '',
    [`${MAIN_TREE}::worktree unlock ${WORKTREE}`]: '',
    [`${MAIN_TREE}::worktree remove --force ${WORKTREE}`]: '',
    [`${MAIN_TREE}::branch -D ${BRANCH}`]: '',
    [`${MAIN_TREE}::diff --cached --stat`]: ' file.ts | 1 +\n',
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) base[key] = value;
  }
  return base;
}

/** git apply is special-cased: its args include a temp file path we can't predict. */
function gitStubWithApply(handlers: Record<string, string>, applyOk = true) {
  return vi.fn((args: string[], cwd?: string) => {
    if (args[0] === 'apply') {
      if (!applyOk) throw new Error('patch does not apply');
      return '';
    }
    const key = `${cwd ?? ''}::${args.join(' ')}`;
    const handler = handlers[key];
    if (handler === undefined) throw new Error(`unexpected git call: ${key}`);
    return handler;
  });
}

describe('transferWorktree happy path', () => {
  it('runs the exact check sequence and reports the verdict', () => {
    const runGit = gitStubWithApply(happyHandlers());
    const log = vi.fn();

    const result = transferWorktree({ worktreePath: WORKTREE, runGit, log });

    expect(result).toEqual({ ok: true, stat: ' file.ts | 1 +\n' });
    const calls = runGit.mock.calls.map(([args, cwd]) => `${cwd ?? ''}::${args.join(' ')}`);
    expect(calls.slice(0, 9)).toEqual([
      '::rev-parse --show-toplevel',
      `${MAIN_TREE}::worktree list --porcelain`,
      `${MAIN_TREE}::rev-parse HEAD`,
      `${MAIN_TREE}::status --porcelain`,
      `${WORKTREE}::add -A`,
      `${WORKTREE}::diff --cached --binary`,
      `${WORKTREE}::status --porcelain`,
      `${WORKTREE}::log --oneline --not --remotes`,
      `${WORKTREE}::log --oneline aaa111..HEAD`,
    ]);
    // Call index 9 is `git apply --index <tmpfile>` — the temp path varies per run.
    expect(runGit.mock.calls[9]?.[0][0]).toBe('apply');
    expect(runGit.mock.calls[9]?.[0][1]).toBe('--index');
    expect(runGit.mock.calls[9]?.[1]).toBe(MAIN_TREE);
    expect(calls.slice(10)).toEqual([
      `${MAIN_TREE}::diff --cached --binary`,
      `${MAIN_TREE}::worktree unlock ${WORKTREE}`,
      `${MAIN_TREE}::worktree remove --force ${WORKTREE}`,
      `${MAIN_TREE}::branch -D ${BRANCH}`,
      `${MAIN_TREE}::diff --cached --stat`,
    ]);
    expect(log).toHaveBeenCalledWith(' file.ts | 1 +\n');
    expect(log).toHaveBeenCalledWith(
      'checks passed: main-tree-clean, worktree-registered, base-unchanged (skipped: no --base), ' +
        'empty-patch, nothing-outside-patch, no-unpushed-remotes, no-unpushed-base, ' +
        'apply, byte-identical'
    );
    const verdictLine = log.mock.calls
      .map(([line]) => line as string)
      .find(line => line.startsWith('checks passed:'));
    expect(verdictLine).toBeDefined();
    expect(verdictLine).not.toContain('base-unchanged,');
    expect(log).toHaveBeenCalledWith('worktree removed');
    expect(log).toHaveBeenCalledWith(`branch ${BRANCH} deleted`);
    expect(log).toHaveBeenCalledWith('next step: run the gates, then commit');
  });

  it('honors --base when it matches the main tree HEAD', () => {
    const runGit = gitStubWithApply(happyHandlers());
    const log = vi.fn();
    const result = transferWorktree({
      worktreePath: WORKTREE,
      base: 'aaa111',
      runGit,
      log,
    });
    expect(result.ok).toBe(true);
    const verdictLine = log.mock.calls
      .map(([line]) => line as string)
      .find(line => line.startsWith('checks passed:'));
    expect(verdictLine).toContain('base-unchanged,');
    expect(verdictLine).not.toContain('skipped: no --base');
  });

  it('honors --base with surrounding whitespace', () => {
    const runGit = gitStubWithApply(happyHandlers());
    const result = transferWorktree({
      worktreePath: WORKTREE,
      base: '  aaa111  \n',
      runGit,
      log: vi.fn(),
    });
    expect(result.ok).toBe(true);
  });

  it('accepts an abbreviated --base that resolves to HEAD', () => {
    const runGit = gitStubWithApply(
      happyHandlers({ [`${MAIN_TREE}::rev-parse --verify aaa^{commit}`]: 'aaa111\n' })
    );
    const result = transferWorktree({
      worktreePath: WORKTREE,
      base: 'aaa',
      runGit,
      log: vi.fn(),
    });
    expect(result.ok).toBe(true);
  });

  it('accepts an uppercase --base', () => {
    const runGit = gitStubWithApply(
      happyHandlers({ [`${MAIN_TREE}::rev-parse --verify AAA111^{commit}`]: 'aaa111\n' })
    );
    const result = transferWorktree({
      worktreePath: WORKTREE,
      base: 'AAA111',
      runGit,
      log: vi.fn(),
    });
    expect(result.ok).toBe(true);
  });
});

describe('transferWorktree refusals', () => {
  function noRemovalCalled(runGit: { mock: { calls: [string[], string?][] } }): void {
    const calls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(calls.some(c => c.startsWith('worktree remove'))).toBe(false);
    expect(calls.some(c => c.startsWith('branch -D'))).toBe(false);
  }

  it('check 0: refuses main-tree-identity when invoked from inside a worktree', () => {
    const listing = [
      `worktree ${MAIN_TREE}`,
      'HEAD aaa111',
      'branch refs/heads/feat/thing',
      '',
      `worktree ${WORKTREE}`,
      'HEAD bbb222',
      `branch refs/heads/${BRANCH}`,
    ].join('\n');
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${WORKTREE}\n`,
      [`${WORKTREE}::worktree list --porcelain`]: () => listing,
    });
    const result = transferWorktree({ worktreePath: WORKTREE, runGit });
    expect(result).toEqual({
      ok: false,
      check: 'main-tree-identity',
      reason: `the invoking checkout ${WORKTREE} is not the main working tree ${MAIN_TREE}; run worktree:transfer from the main checkout`,
    });
    const calls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(calls.some(c => c.startsWith('rev-parse HEAD'))).toBe(false);
    expect(calls.some(c => c.startsWith('status'))).toBe(false);
    expect(calls.some(c => c.startsWith('add'))).toBe(false);
    expect(calls.some(c => c.startsWith('apply'))).toBe(false);
    noRemovalCalled(runGit);
  });

  it('refuses main-tree-identity when rev-parse --show-toplevel throws', () => {
    const runGit = vi.fn((args: string[]) => {
      if (args.join(' ') === 'rev-parse --show-toplevel') {
        throw new Error('fatal: not a git repository');
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    });
    const result = transferWorktree({ worktreePath: WORKTREE, runGit });
    expect(result).toMatchObject({ ok: false, check: 'main-tree-identity' });
    expect(result.ok === false && result.reason).toContain('fatal: not a git repository');
    noRemovalCalled(runGit);
  });

  it('refuses main-tree-identity when worktree list --porcelain throws', () => {
    const runGit = vi.fn((args: string[], cwd?: string) => {
      const key = `${cwd ?? ''}::${args.join(' ')}`;
      if (key === '::rev-parse --show-toplevel') return `${MAIN_TREE}\n`;
      if (key === `${MAIN_TREE}::worktree list --porcelain`) {
        throw new Error('fatal: not a git repository');
      }
      throw new Error(`unexpected git call: ${key}`);
    });
    const result = transferWorktree({ worktreePath: WORKTREE, runGit });
    expect(result).toMatchObject({ ok: false, check: 'main-tree-identity' });
    expect(result.ok === false && result.reason).toContain('fatal: not a git repository');
    noRemovalCalled(runGit);
  });

  it('check 1: refuses on a dirty main tree before touching the worktree', () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::worktree list --porcelain`]: () =>
        [`worktree ${MAIN_TREE}`, 'HEAD aaa111', 'branch refs/heads/feat/thing'].join('\n'),
      [`${MAIN_TREE}::rev-parse HEAD`]: () => 'aaa111\n',
      [`${MAIN_TREE}::status --porcelain`]: () => ' M dirty.ts\n',
    });
    const result = transferWorktree({ worktreePath: WORKTREE, runGit });
    expect(result).toEqual({
      ok: false,
      check: 'main-tree-clean',
      reason: 'the main tree has uncommitted changes; applying into a dirty index mixes work',
    });
    noRemovalCalled(runGit);
  });

  it('turns a thrown git error inside a check into that check refusal', () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::worktree list --porcelain`]: () =>
        [`worktree ${MAIN_TREE}`, 'HEAD aaa111', 'branch refs/heads/feat/thing'].join('\n'),
      [`${MAIN_TREE}::rev-parse HEAD`]: () => 'aaa111\n',
      [`${MAIN_TREE}::status --porcelain`]: () => {
        throw new Error('fatal: not a git repository');
      },
    });
    const result = transferWorktree({ worktreePath: WORKTREE, runGit });
    expect(result).toMatchObject({ ok: false, check: 'main-tree-clean' });
    expect(result.ok === false && result.reason).toContain('fatal: not a git repository');
    noRemovalCalled(runGit);
  });

  it('check 2: refuses when the worktree is not registered', () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::rev-parse HEAD`]: () => 'aaa111\n',
      [`${MAIN_TREE}::status --porcelain`]: () => '',
      [`${MAIN_TREE}::worktree list --porcelain`]: () =>
        `worktree ${MAIN_TREE}\nHEAD aaa111\nbranch refs/heads/feat/thing`,
    });
    const result = transferWorktree({ worktreePath: WORKTREE, runGit });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ check: 'worktree-registered' });
    noRemovalCalled(runGit);
  });

  it('check 2: refuses on a non-throwaway branch and never runs branch -D', () => {
    const listing = [
      `worktree ${MAIN_TREE}`,
      'HEAD aaa111',
      'branch refs/heads/feat/thing',
      '',
      `worktree ${WORKTREE}`,
      'HEAD bbb222',
      'branch refs/heads/feat/not-throwaway',
    ].join('\n');
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::rev-parse HEAD`]: () => 'aaa111\n',
      [`${MAIN_TREE}::status --porcelain`]: () => '',
      [`${MAIN_TREE}::worktree list --porcelain`]: () => listing,
    });
    const result = transferWorktree({ worktreePath: WORKTREE, runGit });
    expect(result).toMatchObject({ check: 'worktree-registered' });
    expect(result.ok === false && result.reason).toContain('worktree-agent-');
    noRemovalCalled(runGit);
  });

  it('check 3: refuses when --base mismatches the main tree HEAD', () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::rev-parse HEAD`]: () => 'ccc333\n',
      [`${MAIN_TREE}::rev-parse --verify aaa111^{commit}`]: () => 'aaa111\n',
      [`${MAIN_TREE}::status --porcelain`]: () => '',
      [`${MAIN_TREE}::worktree list --porcelain`]: () =>
        [
          `worktree ${MAIN_TREE}`,
          'HEAD ccc333',
          'branch refs/heads/feat/thing',
          '',
          `worktree ${WORKTREE}`,
          'HEAD bbb222',
          `branch refs/heads/${BRANCH}`,
        ].join('\n'),
    });
    const result = transferWorktree({ worktreePath: WORKTREE, base: 'aaa111', runGit });
    expect(result).toEqual({
      ok: false,
      check: 'base-unchanged',
      reason:
        'main tree HEAD is ccc333, not the dispatch base aaa111; the application target moved',
    });
    noRemovalCalled(runGit);
  });

  it('refuses base-unchanged when --base does not resolve, before any other check runs', () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::worktree list --porcelain`]: () =>
        [`worktree ${MAIN_TREE}`, 'HEAD aaa111', 'branch refs/heads/feat/thing'].join('\n'),
      [`${MAIN_TREE}::rev-parse HEAD`]: () => 'aaa111\n',
      [`${MAIN_TREE}::rev-parse --verify zzz999^{commit}`]: () => {
        throw new Error('fatal: Needed a single revision');
      },
    });
    const result = transferWorktree({ worktreePath: WORKTREE, base: 'zzz999', runGit });
    expect(result).toEqual({
      ok: false,
      check: 'base-unchanged',
      reason: '--base zzz999 does not resolve to a commit in the main tree',
    });
    const calls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(calls.some(c => c.startsWith('status'))).toBe(false);
    noRemovalCalled(runGit);
  });

  it('check 4: refuses on an empty patch', () => {
    const runGit = gitStub({
      '::rev-parse --show-toplevel': () => `${MAIN_TREE}\n`,
      [`${MAIN_TREE}::rev-parse HEAD`]: () => 'aaa111\n',
      [`${MAIN_TREE}::status --porcelain`]: () => '',
      [`${MAIN_TREE}::worktree list --porcelain`]: () =>
        [
          `worktree ${MAIN_TREE}`,
          'HEAD aaa111',
          'branch refs/heads/feat/thing',
          '',
          `worktree ${WORKTREE}`,
          'HEAD bbb222',
          `branch refs/heads/${BRANCH}`,
        ].join('\n'),
      [`${WORKTREE}::add -A`]: () => '',
      [`${WORKTREE}::diff --cached --binary`]: () => '',
    });
    const result = transferWorktree({ worktreePath: WORKTREE, runGit });
    expect(result).toEqual({
      ok: false,
      check: 'empty-patch',
      reason: 'nothing to transfer: the worktree has no staged changes',
    });
    noRemovalCalled(runGit);
  });

  it('check 5: refuses on an untracked line outside the patch, before the main tree is touched', () => {
    const runGit = gitStubWithApply(
      happyHandlers({ [`${WORKTREE}::status --porcelain`]: 'M  file.ts\n?? stray.txt\n' })
    );
    const result = transferWorktree({ worktreePath: WORKTREE, runGit });
    expect(result).toEqual({
      ok: false,
      check: 'nothing-outside-patch',
      reason: 'worktree status has a line outside the staged patch: "?? stray.txt"',
    });
    const calls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(calls.some(c => c.startsWith('apply'))).toBe(false);
    noRemovalCalled(runGit);
  });

  it('accepts a typechange (T) status line as part of the staged patch', () => {
    const runGit = gitStubWithApply(
      happyHandlers({ [`${WORKTREE}::status --porcelain`]: 'M  file.ts\nT  symlinked.ts\n' })
    );
    const result = transferWorktree({ worktreePath: WORKTREE, runGit });
    expect(result.ok).toBe(true);
  });

  it('check 6: refuses on commits not reachable from any remote, before the main tree is touched', () => {
    const runGit = gitStubWithApply(
      happyHandlers({ [`${WORKTREE}::log --oneline --not --remotes`]: 'abc1234 wip\n' })
    );
    const result = transferWorktree({ worktreePath: WORKTREE, runGit });
    expect(result).toMatchObject({ check: 'no-unpushed-remotes' });
    const calls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(calls.some(c => c.startsWith('apply'))).toBe(false);
    noRemovalCalled(runGit);
  });

  it('check 7: refuses on commits ahead of the main tree HEAD, before the main tree is touched', () => {
    const runGit = gitStubWithApply(
      happyHandlers({ [`${WORKTREE}::log --oneline aaa111..HEAD`]: 'def5678 extra commit\n' })
    );
    const result = transferWorktree({ worktreePath: WORKTREE, runGit });
    expect(result).toMatchObject({ check: 'no-unpushed-base' });
    const calls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(calls.some(c => c.startsWith('apply'))).toBe(false);
    noRemovalCalled(runGit);
  });

  it('check 8: refuses when git apply fails', () => {
    const runGit = gitStubWithApply(happyHandlers(), false);
    const result = transferWorktree({ worktreePath: WORKTREE, runGit });
    expect(result).toMatchObject({ check: 'apply' });
    expect(result.ok === false && result.reason).toContain('patch does not apply');
    noRemovalCalled(runGit);
  });

  it('check 9: refuses on a same-length byte mismatch and leaves the main tree staged', () => {
    // Same length, different bytes: a length-only comparison would pass this.
    const mismatched = PATCH.slice(0, -3) + 'bye';
    expect(mismatched.length).toBe(PATCH.length);
    expect(mismatched).not.toBe(PATCH);

    const runGit = gitStubWithApply(
      happyHandlers({ [`${MAIN_TREE}::diff --cached --binary`]: mismatched })
    );
    const result = transferWorktree({ worktreePath: WORKTREE, runGit });
    expect(result).toMatchObject({ check: 'byte-identical' });
    // No unstage/reset call was made — the main tree is left staged.
    const calls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(calls.some(c => c.startsWith('reset'))).toBe(false);
    expect(calls.some(c => c.startsWith('worktree remove'))).toBe(false);
    expect(calls.some(c => c.startsWith('branch -D'))).toBe(false);
  });

  it('refuses with removal when worktree remove fails, leaving the main tree staged', () => {
    const base = gitStubWithApply(happyHandlers());
    const runGit = vi.fn((args: string[], cwd?: string) => {
      if (args.join(' ') === `worktree remove --force ${WORKTREE}` && cwd === MAIN_TREE) {
        throw new Error('worktree is dirty');
      }
      return (base as unknown as (args: string[], cwd?: string) => string)(args, cwd);
    });
    const result = transferWorktree({ worktreePath: WORKTREE, runGit });
    expect(result).toMatchObject({ ok: false, check: 'removal' });
    expect(result.ok === false && result.reason).toContain('worktree is dirty');
    const calls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(calls.some(c => c.startsWith('reset'))).toBe(false);
    expect(calls.some(c => c.startsWith('branch -D'))).toBe(false);
  });

  it('requests the staged patch with --binary in both the worktree and the main tree', () => {
    const runGit = gitStubWithApply(happyHandlers());
    transferWorktree({ worktreePath: WORKTREE, runGit });
    const calls = runGit.mock.calls.map(([args, cwd]) => `${cwd ?? ''}::${args.join(' ')}`);
    expect(calls).toContain(`${WORKTREE}::diff --cached --binary`);
    expect(calls).toContain(`${MAIN_TREE}::diff --cached --binary`);
  });
});

describe('findWorktreeBlock', () => {
  it('matches the block whose first line names the exact path', () => {
    const listing = [
      `worktree ${MAIN_TREE}`,
      'HEAD aaa111',
      'branch refs/heads/feat/thing',
      '',
      `worktree ${WORKTREE}`,
      'HEAD bbb222',
      `branch refs/heads/${BRANCH}`,
    ].join('\n');
    expect(findWorktreeBlock(listing, WORKTREE)).toEqual([
      `worktree ${WORKTREE}`,
      'HEAD bbb222',
      `branch refs/heads/${BRANCH}`,
    ]);
    expect(findWorktreeBlock(listing, '/nope')).toBeNull();
  });
});

describe('findFirstWorktreePath', () => {
  it('returns the path of the first worktree block', () => {
    const listing = [
      `worktree ${MAIN_TREE}`,
      'HEAD aaa111',
      'branch refs/heads/feat/thing',
      '',
      `worktree ${WORKTREE}`,
      'HEAD bbb222',
      `branch refs/heads/${BRANCH}`,
    ].join('\n');
    expect(findFirstWorktreePath(listing)).toBe(MAIN_TREE);
  });

  it('returns undefined when the listing has no worktree block', () => {
    expect(findFirstWorktreePath('')).toBeUndefined();
  });
});

describe('performRemoval', () => {
  it('removes the worktree and deletes the branch when it carries the throwaway prefix', () => {
    const runGit = vi.fn((_args: string[], _cwd?: string) => '');
    const ctx: TransferContext = {
      runGit,
      mainTreeRoot: MAIN_TREE,
      worktreePath: WORKTREE,
      mainHead: 'aaa111',
      branch: BRANCH,
      patch: PATCH,
      worktreeListing: '',
    };
    expect(performRemoval(ctx)).toBeNull();
    const calls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(calls).toContain(`worktree remove --force ${WORKTREE}`);
    expect(calls).toContain(`branch -D ${BRANCH}`);
  });

  it('never calls branch -D for a branch lacking the worktree-agent- prefix', () => {
    const runGit = vi.fn((_args: string[], _cwd?: string) => '');
    const ctx: TransferContext = {
      runGit,
      mainTreeRoot: MAIN_TREE,
      worktreePath: WORKTREE,
      mainHead: 'aaa111',
      branch: 'feat/not-throwaway',
      patch: PATCH,
      worktreeListing: '',
    };
    expect(performRemoval(ctx)).toBeNull();
    const calls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(calls).toContain(`worktree remove --force ${WORKTREE}`);
    expect(calls.some(c => c.startsWith('branch -D'))).toBe(false);
  });

  it('tolerates worktree unlock failing (the normal "not locked" case)', () => {
    const runGit = vi.fn((args: string[]) => {
      if (args[0] === 'unlock' || args.join(' ').startsWith('worktree unlock')) {
        throw new Error('not locked');
      }
      return '';
    });
    const ctx: TransferContext = {
      runGit,
      mainTreeRoot: MAIN_TREE,
      worktreePath: WORKTREE,
      mainHead: 'aaa111',
      branch: BRANCH,
      patch: PATCH,
      worktreeListing: '',
    };
    expect(() => performRemoval(ctx)).not.toThrow();
  });

  it('returns a removal refusal when worktree remove fails, never calling branch -D', () => {
    const runGit = vi.fn((args: string[]) => {
      if (args.join(' ').startsWith('worktree remove')) {
        throw new Error('worktree is dirty');
      }
      return '';
    });
    const ctx: TransferContext = {
      runGit,
      mainTreeRoot: MAIN_TREE,
      worktreePath: WORKTREE,
      mainHead: 'aaa111',
      branch: BRANCH,
      patch: PATCH,
      worktreeListing: '',
    };
    const result = performRemoval(ctx);
    expect(result).toMatchObject({ ok: false, check: 'removal' });
    expect(result !== null && !result.ok && result.reason).toContain('worktree is dirty');
    const calls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(calls.some(c => c.startsWith('branch -D'))).toBe(false);
  });

  it('returns a removal refusal naming the by-hand branch delete when branch -D fails after the worktree is already removed', () => {
    const runGit = vi.fn((args: string[]) => {
      if (args.join(' ').startsWith('branch -D')) {
        throw new Error('branch is checked out elsewhere');
      }
      return '';
    });
    const ctx: TransferContext = {
      runGit,
      mainTreeRoot: MAIN_TREE,
      worktreePath: WORKTREE,
      mainHead: 'aaa111',
      branch: BRANCH,
      patch: PATCH,
      worktreeListing: '',
    };
    const result = performRemoval(ctx);
    expect(result).toMatchObject({ ok: false, check: 'removal' });
    expect(result !== null && !result.ok && result.reason).toContain('the worktree is removed');
    expect(result !== null && !result.ok && result.reason).toContain(`git branch -D ${BRANCH}`);
    expect(result !== null && !result.ok && result.reason).toContain(
      'branch is checked out elsewhere'
    );
    const calls = runGit.mock.calls.map(([args]) => args.join(' '));
    expect(calls).toContain(`worktree remove --force ${WORKTREE}`);
  });
});

describe('default runner (no injected runGit)', () => {
  it('uses execFileSync with array args and the module timeout', () => {
    vi.mocked(execFileSync).mockClear();
    vi.mocked(execFileSync).mockReturnValue('/repo\n');
    try {
      transferWorktree({ worktreePath: '/repo/.claude/worktrees/agent-x' });
    } catch {
      // Fake output won't satisfy every downstream check — only the shape matters here.
    }
    const calls = vi.mocked(execFileSync).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call[0]).toBe('git');
      expect(Array.isArray(call[1])).toBe(true);
      expect(call[2]).toMatchObject({
        timeout: WORKTREE_TRANSFER_TIMEOUT_MS,
        encoding: 'utf-8',
        maxBuffer: WORKTREE_TRANSFER_MAX_BUFFER,
      });
    }
  });
});
