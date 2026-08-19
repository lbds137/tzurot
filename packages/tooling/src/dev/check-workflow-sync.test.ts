import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Every other test here injects `runGit`, so this mock is reached only by the
// default-path test below — the one case that exercises the real `execFileSync`.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '') }));

import { execFileSync } from 'node:child_process';
import {
  checkWorkflowSync,
  diffWorkflowsAgainstMain,
  resolvePrBase,
  resolveExplicitBase,
  WORKFLOW_SYNC_TIMEOUT_MS,
  WORKFLOW_FETCH_TIMEOUT_MS,
  WORKFLOW_GH_TIMEOUT_MS,
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

describe('default runners (no injected runGit/runGh)', () => {
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

  it('bounds the gh lookup and PIPES its stderr rather than inheriting it', () => {
    // The whole "stderr becomes the reason" design in resolvePrBase depends on
    // this stdio triple: inherited, gh's own error prints raw above the verdict
    // and reads as a crash; discarded, the reason is unrecoverable.
    vi.mocked(execFileSync).mockClear();
    vi.mocked(execFileSync).mockImplementation(((cmd: string, args: string[]) => {
      // Drift is required to reach the gh lookup at all (drift-first ordering).
      if (cmd === 'git' && args[0] === 'diff') return '.github/workflows/claude.yml\n';
      // A real branch name is required too: an undeterminable branch refuses
      // before the lookup, so gh would never be invoked to inspect.
      if (cmd === 'git' && args[1] === '--abbrev-ref') return 'feat/thing\n';
      return '';
    }) as unknown as typeof execFileSync);

    checkWorkflowSync({ env: {} });

    const ghCalls = vi.mocked(execFileSync).mock.calls.filter(c => c[0] === 'gh');
    expect(ghCalls.length).toBeGreaterThan(0);
    for (const call of ghCalls) {
      expect(call[2]).toMatchObject({
        timeout: WORKFLOW_GH_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    vi.mocked(execFileSync).mockReturnValue('');
    process.exitCode = undefined;
  });
});

describe('resolvePrBase', () => {
  it('returns the open PR base branch', () => {
    const runGh = vi.fn(() => 'OPEN main\n');
    expect(resolvePrBase(runGh, 'chore/release-v3.0.0-beta.205').base).toBe('main');
    expect(runGh).toHaveBeenCalledWith([
      'pr',
      'view',
      '--json',
      'baseRefName,state',
      '--jq',
      '.state + " " + .baseRefName',
    ]);
  });

  it.each(['MERGED', 'CLOSED'])("refuses a %s PR, whose base is not this branch's target", st => {
    // gh names no tie-break for a branch with several associated PRs, so a
    // closed PR→main beside an open PR→develop could hand back "main" and skip
    // the guard. Refusing on state closes that WITHOUT knowing how gh chooses.
    // Probed: the field is exactly one of OPEN / CLOSED / MERGED.
    const runGh = vi.fn(() => `${st} main\n`);
    const { base, reason } = resolvePrBase(runGh, 'feat/thing');
    expect(base).toBeNull();
    expect(reason).toBe(`the branch's PR is ${st}, not OPEN`);
  });

  it('refuses to ask on develop, where an open release PR would answer "main"', () => {
    // A release PR (develop -> main) is routinely open. Answering "main" here
    // would skip the guard on develop for the whole release window — retiring
    // the post-merge backstop exactly when drift is most likely in flight.
    const runGh = vi.fn(() => 'OPEN main\n');
    expect(resolvePrBase(runGh, 'develop').base).toBeNull();
    expect(runGh).not.toHaveBeenCalled();
  });

  it('refuses to ask on main for the same reason', () => {
    const runGh = vi.fn(() => 'OPEN main\n');
    expect(resolvePrBase(runGh, 'main').base).toBeNull();
    expect(runGh).not.toHaveBeenCalled();
  });

  it('refuses to ask when the branch is undeterminable (detached checkout)', () => {
    const runGh = vi.fn(() => 'OPEN main\n');
    const { base, reason } = resolvePrBase(runGh, '');
    expect(base).toBeNull();
    expect(reason).toBe('current branch could not be determined');
    expect(runGh).not.toHaveBeenCalled();
  });

  it('returns null when gh fails (no PR yet, no token, no gh on PATH)', () => {
    const runGh = vi.fn(() => {
      throw new Error('no pull requests found for branch');
    });
    expect(resolvePrBase(runGh, 'feat/thing').base).toBeNull();
  });

  it('carries gh stderr through as the reason, so a failure says WHY', () => {
    // stderr is piped rather than inherited or discarded: inherited it prints
    // raw above the verdict and reads as a crash; discarded, "no PR yet" and
    // "no token in CI" become indistinguishable.
    const runGh = vi.fn(() => {
      const error = new Error('Command failed') as Error & { stderr: string };
      error.stderr = 'no pull requests found for branch "feat/thing"\n';
      throw error;
    });
    const { base, reason } = resolvePrBase(runGh, 'feat/thing');
    expect(base).toBeNull();
    expect(reason).toBe('no pull requests found for branch "feat/thing"');
  });

  it('never yields an empty reason, which would print a bare ()', () => {
    const runGh = vi.fn(() => {
      // A non-Error throw whose String() is empty — the shape under test.
      throw '';
    });
    expect(resolvePrBase(runGh, 'feat/thing').reason).toBe('gh failed without a message');
  });

  it('returns null on empty output rather than an empty-string base', () => {
    expect(
      resolvePrBase(
        vi.fn(() => '\n'),
        'feat/thing'
      ).base
    ).toBeNull();
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

  /** A feature branch with the given guarded-workflow diff output. */
  function featureBranchGit(diffOut: string): (args: string[]) => string {
    return gitStub({
      'rev-parse': args => (args[1] === '--abbrev-ref' ? 'feat/thing\n' : 'ok\n'),
      diff: () => diffOut,
    });
  }

  /** A `gh` stub reporting the given base, or throwing when none is given. */
  function ghStub(base?: string): (args: string[]) => string {
    return vi.fn(() => {
      if (base === undefined) throw new Error('no pull requests found');
      return `OPEN ${base}\n`;
    });
  }

  it('passes when workflows are in sync', () => {
    checkWorkflowSync({ env: {}, runGit: featureBranchGit(''), runGh: ghStub('develop') });
    expect(process.exitCode).toBeUndefined();
  });

  it('makes NO network call on the clean path', () => {
    // Drift-first ordering is what makes asking GitHub affordable inside
    // `pnpm quality`. If this ever regresses, every quality run pays a round
    // trip for a question that only matters when a guarded file changed.
    const runGh = ghStub('develop');
    checkWorkflowSync({ env: {}, runGit: featureBranchGit(''), runGh });
    expect(runGh).not.toHaveBeenCalled();
  });

  it('fails when a claude workflow file differs from origin/main', () => {
    checkWorkflowSync({
      env: {},
      runGit: featureBranchGit('.github/workflows/claude-code-review.yml\n'),
      runGh: ghStub('develop'),
    });
    expect(process.exitCode).toBe(1);
  });

  it('skips when the open PR targets main, even with workflow drift', () => {
    // The whole point of a main-cut branch is that its workflows differ from
    // main — the guard must not block the sanctioned path.
    checkWorkflowSync({
      env: {},
      runGit: featureBranchGit('.github/workflows/claude.yml\n'),
      runGh: ghStub('main'),
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('FAILS on a develop-cut branch whose merge-base sits on main (the #2125 shape)', () => {
    // The regression this change exists for. The old topology test read this
    // branch as main-cut and printed success; the base is now asked of GitHub,
    // which says develop.
    checkWorkflowSync({
      env: {},
      runGit: featureBranchGit('.github/workflows/claude.yml\n'),
      runGh: ghStub('develop'),
    });
    expect(process.exitCode).toBe(1);
  });

  it('fails CLOSED when the base is unknowable (no PR, no gh, no token)', () => {
    // Opposite direction from the git-comparison failure below, deliberately:
    // there the guard cannot SEE the drift, here it has already seen it and
    // only the intent is missing. A drift that is real gets reported.
    checkWorkflowSync({
      env: {},
      runGit: featureBranchGit('.github/workflows/claude.yml\n'),
      runGh: ghStub(),
    });
    expect(process.exitCode).toBe(1);
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

  it('applies the develop refusal through the FULL pipeline, not just resolvePrBase', () => {
    // resolvePrBase is unit-tested with a hand-picked 'develop' string; this
    // runs the real checkWorkflowSync -> currentBranchName -> resolvePrBase
    // path, which is where a branch-name bug would actually bite.
    const runGh = ghStub('main');
    const runGit = gitStub({
      'rev-parse': args => (args[1] === '--abbrev-ref' ? 'develop\n' : 'ok\n'),
      diff: () => '.github/workflows/claude.yml\n',
    });
    checkWorkflowSync({ env: {}, runGit, runGh });
    expect(process.exitCode).toBe(1);
    expect(runGh).not.toHaveBeenCalled();
  });

  it('does not mistake a detached HEAD for a branch literally named HEAD', () => {
    // `git rev-parse --abbrev-ref HEAD` PRINTS the string "HEAD" on a detached
    // checkout rather than throwing. Untranslated it reads as a branch name,
    // which is neither develop nor main — so the refusal would silently not
    // apply. Same translation release/finalize.ts already makes.
    const runGh = ghStub('main');
    const runGit = gitStub({
      'rev-parse': args => (args[1] === '--abbrev-ref' ? 'HEAD\n' : 'ok\n'),
      diff: () => '.github/workflows/claude.yml\n',
    });
    checkWorkflowSync({ env: {}, runGit, runGh });
    // An undeterminable branch refuses like a long-lived one: gh is never
    // asked, and the drift is reported. Untranslated, "HEAD" would read as an
    // ordinary branch name, sail past both refusals, and let gh's answer
    // ("main", from the release PR) skip the guard.
    expect(runGh).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('prefers GITHUB_REF_NAME over whatever the working tree says', () => {
    // The two sources must actually DISAGREE for this to test anything: with a
    // detached tree both paths refuse anyway (via the empty-branch guard), so
    // that fixture cannot tell the preference from its absence. Here git
    // reports an ordinary feature branch — which would sail past both refusals
    // and let gh's "main" skip the guard — while Actions reports develop.
    const runGh = ghStub('main');
    const runGit = gitStub({
      'rev-parse': args => (args[1] === '--abbrev-ref' ? 'feat/thing\n' : 'ok\n'),
      diff: () => '.github/workflows/claude.yml\n',
    });
    checkWorkflowSync({ env: { GITHUB_REF_NAME: 'develop' }, runGit, runGh });
    expect(process.exitCode).toBe(1);
    expect(runGh).not.toHaveBeenCalled();
  });

  it('enforces on an explicit develop base without asking GitHub', () => {
    // An explicit target has already declared the answer; re-asking would let
    // a stale or unrelated PR override it.
    const runGh = ghStub('main');
    checkWorkflowSync({
      env: { GITHUB_BASE_REF: 'develop' },
      runGit: featureBranchGit('.github/workflows/claude.yml\n'),
      runGh,
    });
    expect(process.exitCode).toBe(1);
    expect(runGh).not.toHaveBeenCalled();
  });

  it('fails open with a warning when git comparison is impossible', () => {
    const runGit = vi.fn(() => {
      throw new Error('could not read from remote repository');
    });
    checkWorkflowSync({ env: {}, runGit });
    expect(process.exitCode).toBeUndefined();
  });
});
