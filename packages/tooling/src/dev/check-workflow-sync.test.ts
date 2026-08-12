import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Every other test here injects `runGit`, so this mock is reached only by the
// default-path test below — the one case that exercises the real `execFileSync`.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '') }));

import { execFileSync } from 'node:child_process';
import {
  checkWorkflowSync,
  diffWorkflowsAgainstMain,
  isMainCutBranch,
  resolveExplicitBase,
  WORKFLOW_SYNC_TIMEOUT_MS,
  WORKFLOW_FETCH_TIMEOUT_MS,
} from './check-workflow-sync.js';

/** Build a runGit stub from a handler map keyed on the git subcommand. */
function gitStub(handlers: Record<string, (args: string[]) => string>): (args: string[]) => string {
  return vi.fn((args: string[]) => {
    const handler = handlers[args[0]];
    if (handler === undefined) throw new Error(`unexpected git ${args.join(' ')}`);
    return handler(args);
  });
}

describe('resolveExplicitBase', () => {
  it('prefers the explicit --base flag', () => {
    expect(resolveExplicitBase({ base: 'main', env: { GITHUB_BASE_REF: 'develop' } })).toBe('main');
  });

  it('uses GITHUB_BASE_REF on PR builds', () => {
    expect(resolveExplicitBase({ env: { GITHUB_BASE_REF: 'main' } })).toBe('main');
  });

  it('returns null when nothing is declared (push builds, local runs)', () => {
    // Push-only CI never sets GITHUB_BASE_REF, and GITHUB_REF is the branch\'s
    // own name — deliberately NOT used as a target signal.
    expect(resolveExplicitBase({ env: { GITHUB_REF: 'refs/heads/fix/ci-typo' } })).toBeNull();
  });
});

describe('defaultRunGit (no injected runGit)', () => {
  it('bounds the LOCAL git shell-outs with WORKFLOW_SYNC_TIMEOUT_MS', () => {
    vi.mocked(execFileSync).mockClear();
    vi.mocked(execFileSync).mockReturnValue('');

    // No `runGit` in the options, so the guard falls through to defaultRunGit.
    // Every ref resolves here, so no fetch is reached — all calls are local.
    checkWorkflowSync({ env: {} });

    const calls = vi.mocked(execFileSync).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call[1]).not.toContain('fetch');
      expect(call[2]).toMatchObject({ timeout: WORKFLOW_SYNC_TIMEOUT_MS });
    }
  });

  it('gives the NETWORK fetch its own larger bound', () => {
    // A local-probe value is the wrong scale for a round trip to GitHub, and
    // this guard fails open — so a spurious timeout would silently skip the
    // check that catches workflow drift.
    vi.mocked(execFileSync).mockClear();
    vi.mocked(execFileSync).mockImplementation(((_cmd: string, args: string[]) => {
      // Missing ref (the shallow-checkout case) is what drives ensureRef to fetch.
      if (args[0] === 'rev-parse') throw new Error('unknown revision');
      return '';
    }) as unknown as typeof execFileSync);

    checkWorkflowSync({ env: {} });

    const fetches = vi.mocked(execFileSync).mock.calls.filter(c => c[1]?.[0] === 'fetch');
    expect(fetches.length).toBeGreaterThan(0);
    for (const call of fetches) {
      expect(call[2]).toMatchObject({ timeout: WORKFLOW_FETCH_TIMEOUT_MS });
    }

    vi.mocked(execFileSync).mockReturnValue('');
  });
});

describe('isMainCutBranch', () => {
  it('is true when the merge-base with develop is an ancestor of main (main-cut shape)', () => {
    const runGit = gitStub({
      'rev-parse': () => 'ok\n',
      'merge-base': args => {
        if (args[1] === '--is-ancestor') return ''; // exit 0 = ancestor
        return 'mainTipSha\n';
      },
    });
    expect(isMainCutBranch(runGit)).toBe(true);
  });

  it('is false when the branch carries develop-exclusive history', () => {
    const runGit = gitStub({
      'rev-parse': () => 'ok\n',
      'merge-base': args => {
        if (args[1] === '--is-ancestor') throw new Error('exit 1: not an ancestor');
        return 'developOnlySha\n';
      },
    });
    expect(isMainCutBranch(runGit)).toBe(false);
  });

  it('fetches missing refs on shallow checkouts', () => {
    let fetched = 0;
    const runGit = gitStub({
      'rev-parse': () => {
        throw new Error('unknown revision');
      },
      fetch: () => {
        fetched += 1;
        return '';
      },
      'merge-base': args => (args[1] === '--is-ancestor' ? '' : 'sha\n'),
    });
    expect(isMainCutBranch(runGit)).toBe(true);
    expect(fetched).toBe(2); // origin/develop + origin/main
  });
});

describe('diffWorkflowsAgainstMain', () => {
  it('parses changed workflow paths from git diff output', () => {
    const runGit = gitStub({
      'rev-parse': () => 'abc123\n',
      diff: () => '.github/workflows/claude-code-review.yml\n.github/workflows/claude.yml\n',
    });
    expect(diffWorkflowsAgainstMain(runGit)).toEqual([
      '.github/workflows/claude-code-review.yml',
      '.github/workflows/claude.yml',
    ]);
  });

  it('diffs ONLY the self-validating claude workflows, not the whole directory', () => {
    // The review-skip validation is scoped to the action's own workflow file —
    // a ci.yml-only drift still gets a real review, so the guard must not
    // force main-cut ceremony on routine ci.yml edits.
    let diffArgs: string[] = [];
    const runGit = gitStub({
      'rev-parse': () => 'abc123\n',
      diff: args => {
        diffArgs = args;
        return '';
      },
    });
    diffWorkflowsAgainstMain(runGit);
    const pathspecs = diffArgs.slice(diffArgs.indexOf('--') + 1);
    expect(pathspecs).toEqual([
      '.github/workflows/claude-code-review.yml',
      '.github/workflows/claude.yml',
    ]);
    expect(pathspecs).not.toContain('.github/workflows/');
  });

  it('fetches origin/main when the ref is missing (shallow checkout)', () => {
    const runGit = gitStub({
      'rev-parse': () => {
        throw new Error('unknown revision');
      },
      fetch: () => '',
      diff: () => '',
    });
    expect(diffWorkflowsAgainstMain(runGit)).toEqual([]);
    expect(runGit).toHaveBeenCalledWith(['fetch', 'origin', 'main', '--depth=1']);
  });
});

describe('checkWorkflowSync', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  /** develop-based branch (topology says NOT main-cut) with the given diff. */
  function developBranchGit(diffOut: string): (args: string[]) => string {
    return gitStub({
      'rev-parse': () => 'ok\n',
      'merge-base': args => {
        if (args[1] === '--is-ancestor') throw new Error('not an ancestor');
        return 'developOnlySha\n';
      },
      diff: () => diffOut,
    });
  }

  it('passes when workflows are in sync', () => {
    checkWorkflowSync({ env: {}, runGit: developBranchGit('') });
    expect(process.exitCode).toBeUndefined();
  });

  it('fails when a claude workflow file differs from origin/main', () => {
    checkWorkflowSync({
      env: {},
      runGit: developBranchGit('.github/workflows/claude-code-review.yml\n'),
    });
    expect(process.exitCode).toBe(1);
  });

  it('skips via topology on a main-cut branch, even with workflow drift', () => {
    // The whole point of a main-cut branch is that its workflows differ from
    // main — the guard must not block the sanctioned path. No CI env needed.
    const runGit = gitStub({
      'rev-parse': () => 'ok\n',
      'merge-base': args => (args[1] === '--is-ancestor' ? '' : 'mainTipSha\n'),
      diff: () => {
        throw new Error('diff must not run on the skip path');
      },
    });
    checkWorkflowSync({ env: {}, runGit });
    expect(process.exitCode).toBeUndefined();
  });

  it('skips via explicit --base main without touching git', () => {
    const runGit = vi.fn(() => {
      throw new Error('git must not run on the explicit-skip path');
    });
    checkWorkflowSync({ base: 'main', env: {}, runGit });
    expect(process.exitCode).toBeUndefined();
    expect(runGit).not.toHaveBeenCalled();
  });

  it('skips via GITHUB_BASE_REF=main (PR-build override)', () => {
    const runGit = vi.fn(() => {
      throw new Error('git must not run on the explicit-skip path');
    });
    checkWorkflowSync({ env: { GITHUB_BASE_REF: 'main' }, runGit });
    expect(process.exitCode).toBeUndefined();
  });

  it('enforces when an explicit base targets develop, skipping the topology test', () => {
    // An explicit develop target must not be overridden by topology (e.g. the
    // develop==main window where every branch looks main-cut).
    const runGit = gitStub({
      'rev-parse': () => 'ok\n',
      diff: () => '.github/workflows/claude.yml\n',
    });
    checkWorkflowSync({ env: { GITHUB_BASE_REF: 'develop' }, runGit });
    expect(process.exitCode).toBe(1);
  });

  it('fails open with a warning when git comparison is impossible', () => {
    const runGit = vi.fn(() => {
      throw new Error('could not read from remote repository');
    });
    checkWorkflowSync({ env: {}, runGit });
    expect(process.exitCode).toBeUndefined();
  });
});
