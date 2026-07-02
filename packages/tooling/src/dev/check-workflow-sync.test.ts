import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkWorkflowSync,
  diffWorkflowsAgainstMain,
  isMainCutBranch,
  resolveExplicitBase,
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
      diff: () => '.github/workflows/ci.yml\n.github/workflows/claude.yml\n',
    });
    expect(diffWorkflowsAgainstMain(runGit)).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/claude.yml',
    ]);
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

  it('fails when a workflow file differs from origin/main', () => {
    checkWorkflowSync({ env: {}, runGit: developBranchGit('.github/workflows/ci.yml\n') });
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
      diff: () => '.github/workflows/ci.yml\n',
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
