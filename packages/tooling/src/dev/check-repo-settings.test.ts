/**
 * Tests for the repo deletion-safety guard.
 *
 * The pure pieces (parsing, derivation, evaluation, rendering) are tested
 * directly; the `gh`/`git` seam is mocked and the args crossing it are asserted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { GH_TIMEOUT_MS } from '../audits/health-extras.js';
import { GIT_SHOW_TIMEOUT_MS, MAIN_CI_WORKFLOW_REF } from './main-required-checks.js';
import {
  LONG_LIVED_BRANCHES,
  isDeletionReachable,
  parseRulesetIds,
  parseRulesetDetail,
  deriveBranchStates,
  evaluateRepoSettings,
  fetchDeleteBranchOnMerge,
  collectRepoSettings,
  formatRepoSettingsReport,
  checkRepoSettings,
  REPO_SETTINGS_BUDGET_MS,
  type ActiveBranchRuleset,
  type BranchDeletionState,
} from './check-repo-settings.js';

/** The `required_status_checks` rule shape (`.github/rulesets/branch-protection.json`). */
function buildRequiredChecksRule(contexts: string[]): unknown {
  return {
    type: 'required_status_checks',
    parameters: {
      strict_required_status_checks_policy: false,
      do_not_enforce_on_create: false,
      required_status_checks: contexts.map(context => ({ context })),
    },
  };
}

/** A ruleset detail payload as GitHub returns it, with overridable pieces. */
function rulesetDetail(overrides: {
  refs?: string[];
  excludeRefs?: string[];
  rules?: string[];
  bypassActors?: unknown[];
  enforcement?: string;
  target?: string;
  requiredChecks?: string[];
}): string {
  const rules: unknown[] = (overrides.rules ?? ['deletion']).map(type => ({ type }));
  if (overrides.requiredChecks !== undefined) {
    rules.push(buildRequiredChecksRule(overrides.requiredChecks));
  }
  return JSON.stringify({
    id: 1,
    enforcement: overrides.enforcement ?? 'active',
    target: overrides.target ?? 'branch',
    conditions: {
      ref_name: {
        include: overrides.refs ?? ['refs/heads/main'],
        exclude: overrides.excludeRefs ?? [],
      },
    },
    rules,
    bypass_actors: overrides.bypassActors ?? [],
  });
}

/**
 * The 8 job shapes behind the 12 live main required-check contexts, matrix legs included:
 * `unit-tests` expands to its 6-cell matrix (mirroring the live ci.yml shape), the rest are
 * bare job ids.
 */
const DEFAULT_MAIN_WORKFLOW =
  'jobs:\n' +
  '  lint: {}\n' +
  '  build: {}\n' +
  '  unit-tests:\n' +
  '    name: "unit-tests (${{ matrix.cell }})"\n' +
  '    strategy:\n' +
  '      matrix:\n' +
  '        include:\n' +
  '          - cell: bot-client\n' +
  '          - cell: ai-worker\n' +
  '          - cell: api-gateway\n' +
  '          - cell: website\n' +
  '          - cell: tooling\n' +
  '          - cell: packages\n' +
  '  component-integration-tests: {}\n' +
  '  docker-build-smoke: {}\n' +
  '  docker-build-smoke-ok: {}\n' +
  '  voice-engine-tests: {}\n' +
  '  mutation-tests: {}\n';

function state(overrides: Partial<BranchDeletionState> & { branch: string }): BranchDeletionState {
  return {
    hasDeletionRule: true,
    deletionRuleFullyBypassable: false,
    hasBypassActors: false,
    ...overrides,
  };
}

function ruleset(overrides: Partial<ActiveBranchRuleset> = {}): ActiveBranchRuleset {
  return {
    branches: ['main'],
    hasDeletionRule: true,
    bypassActorCount: 0,
    requiredChecks: [],
    ...overrides,
  };
}

describe('parseRulesetIds', () => {
  it('collects ids from the newline-delimited projection', () => {
    expect(parseRulesetIds('11\n22\n')).toEqual([11, 22]);
  });

  it('drops non-numeric lines (jq emits null for an entry with no id)', () => {
    expect(parseRulesetIds('11\nnull\n\n  \n22\n')).toEqual([11, 22]);
  });

  it('spans pages — --paginate concatenates them into one stream', () => {
    // The truncation shape this guards: 30-per-page defaults silently dropping
    // a deletion rule that lives on a later page.
    const thirtyOne = Array.from({ length: 31 }, (_, i) => String(i + 1)).join('\n');
    expect(parseRulesetIds(thirtyOne)).toHaveLength(31);
  });
});

describe('parseRulesetDetail', () => {
  it('reduces an active branch ruleset to the fields the guard reasons about', () => {
    const parsed = parseRulesetDetail(
      rulesetDetail({
        refs: ['refs/heads/develop'],
        rules: ['deletion', 'non_fast_forward'],
        bypassActors: [{ actor_type: 'RepositoryRole', bypass_mode: 'always' }],
      })
    );

    expect(parsed).toEqual({
      branches: ['develop'],
      hasDeletionRule: true,
      bypassActorCount: 1,
      requiredChecks: [],
    });
  });

  it('resolves ~DEFAULT_BRANCH to main', () => {
    expect(parseRulesetDetail(rulesetDetail({ refs: ['~DEFAULT_BRANCH'] }))?.branches).toEqual([
      'main',
    ]);
  });

  it('expands ~ALL to every long-lived branch', () => {
    expect(parseRulesetDetail(rulesetDetail({ refs: ['~ALL'] }))?.branches).toEqual([
      ...LONG_LIVED_BRANCHES,
    ]);
  });

  it('subtracts excluded refs from the included set', () => {
    // The under-reporting shape: without reading `exclude`, a ~ALL ruleset
    // would read as protecting develop when it explicitly does not.
    expect(
      parseRulesetDetail(rulesetDetail({ refs: ['~ALL'], excludeRefs: ['refs/heads/develop'] }))
        ?.branches
    ).toEqual(['main']);
  });

  it('subtracts an excluded wildcard token too', () => {
    expect(
      parseRulesetDetail(rulesetDetail({ refs: ['~ALL'], excludeRefs: ['~DEFAULT_BRANCH'] }))
        ?.branches
    ).toEqual(['develop']);
  });

  it('skips rulesets that are not active or not branch-targeted', () => {
    expect(parseRulesetDetail(rulesetDetail({ enforcement: 'evaluate' }))).toBeUndefined();
    expect(parseRulesetDetail(rulesetDetail({ target: 'tag' }))).toBeUndefined();
  });

  it('treats a missing rules/bypass_actors/conditions block as empty rather than throwing', () => {
    const parsed = parseRulesetDetail(JSON.stringify({ enforcement: 'active', target: 'branch' }));
    expect(parsed).toEqual({
      branches: [],
      hasDeletionRule: false,
      bypassActorCount: 0,
      requiredChecks: [],
    });
  });

  it('parses required_status_checks contexts', () => {
    expect(
      parseRulesetDetail(rulesetDetail({ requiredChecks: ['lint', 'unit-tests (tooling)'] }))
        ?.requiredChecks
    ).toEqual(['lint', 'unit-tests (tooling)']);
  });
});

describe('isDeletionReachable', () => {
  it('is reachable with no deletion rule', () => {
    expect(isDeletionReachable(state({ branch: 'develop', hasDeletionRule: false }))).toBe(true);
  });

  it('is reachable when every deletion-carrying ruleset is bypassable', () => {
    expect(
      isDeletionReachable(state({ branch: 'develop', deletionRuleFullyBypassable: true }))
    ).toBe(true);
  });

  it('is unreachable with an un-bypassable deletion rule', () => {
    expect(isDeletionReachable(state({ branch: 'main' }))).toBe(false);
  });
});

describe('deriveBranchStates', () => {
  it('produces one state per long-lived branch', () => {
    expect(deriveBranchStates([]).map(s => s.branch)).toEqual([...LONG_LIVED_BRANCHES]);
  });

  it('marks a branch un-bypassable when ONE covering deletion ruleset has no bypass actors', () => {
    const states = deriveBranchStates([
      ruleset({ branches: ['main'], bypassActorCount: 3 }),
      ruleset({ branches: ['main'], bypassActorCount: 0 }),
    ]);
    const main = states.find(s => s.branch === 'main');

    expect(main?.hasDeletionRule).toBe(true);
    expect(main?.deletionRuleFullyBypassable).toBe(false);
    expect(main?.hasBypassActors).toBe(true);
  });

  it('ignores rulesets without a deletion rule when judging bypassability', () => {
    const states = deriveBranchStates([
      ruleset({ branches: ['develop'], hasDeletionRule: false, bypassActorCount: 2 }),
    ]);
    const develop = states.find(s => s.branch === 'develop');

    expect(develop?.hasDeletionRule).toBe(false);
    expect(develop?.hasBypassActors).toBe(true);
  });
});

describe('evaluateRepoSettings', () => {
  const protectedMain = state({ branch: 'main' });
  const bypassableDevelop = state({
    branch: 'develop',
    deletionRuleFullyBypassable: true,
    hasBypassActors: true,
  });

  it('reports NOTHING for develop bypass actors alone — they are deliberate', () => {
    // develop's bypass actors are required for release:finalize's force-push and
    // the sanctioned direct doc-commit path. They must never be a finding on
    // their own; only as a contributing condition of the CRITICAL combination.
    const findings = evaluateRepoSettings(false, [protectedMain, bypassableDevelop]);

    expect(findings).toEqual([]);
  });

  it('is CRITICAL when auto-delete is on AND a long-lived branch is reachable', () => {
    const findings = evaluateRepoSettings(true, [protectedMain, bypassableDevelop]);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('CRITICAL');
    expect(findings[0].message).toContain('develop');
    expect(findings[0].message).not.toContain('main,');
    expect(findings[0].message).toContain('ADMIN privileges');
  });

  it('does not fire CRITICAL when auto-delete is on but nothing is reachable', () => {
    const findings = evaluateRepoSettings(true, [protectedMain, state({ branch: 'develop' })]);

    expect(findings).toEqual([]);
  });

  it('is HIGH when a long-lived branch has no deletion rule at all', () => {
    const findings = evaluateRepoSettings(false, [
      protectedMain,
      state({ branch: 'develop', hasDeletionRule: false }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('HIGH');
    expect(findings[0].message).toContain('develop has no active branch ruleset');
  });

  it('is MEDIUM when main carries bypass actors', () => {
    const findings = evaluateRepoSettings(false, [
      state({ branch: 'main', hasBypassActors: true }),
      state({ branch: 'develop' }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('MEDIUM');
    expect(findings[0].message).toContain('main');
  });

  it("does NOT claim the deletion mechanism when main's deletion rule is un-bypassable", () => {
    // hasBypassActors spans every covering ruleset, so a bypass actor on some
    // OTHER rule (non_fast_forward, say) must not be reported as making the
    // deletion rule passable — that would assert a causal link the data does
    // not show.
    const findings = evaluateRepoSettings(false, [
      state({ branch: 'main', hasBypassActors: true, deletionRuleFullyBypassable: false }),
      state({ branch: 'develop' }),
    ]);

    expect(findings[0].message).toContain('At least one deletion rule');
    expect(findings[0].message).not.toContain('passes straight through');
  });

  it('never claims deletion is blocked when main has NO deletion rule at all', () => {
    // deletionRuleFullyBypassable is VACUOUSLY false here (zero deletion rules
    // to evaluate), so a two-way ternary on it emits "deletion is still
    // blocked" — a false reassurance printed beside the HIGH saying nothing
    // prevents deletion. The two findings must never contradict each other.
    const findings = evaluateRepoSettings(false, [
      state({ branch: 'main', hasDeletionRule: false, hasBypassActors: true }),
      state({ branch: 'develop' }),
    ]);
    const medium = findings.find(f => f.severity === 'MEDIUM');

    expect(medium?.message).not.toContain('still blocked');
    expect(medium?.message).not.toContain('At least one deletion rule');
    expect(medium?.message).toContain('NO deletion rule');
    // And the HIGH it must agree with is genuinely present.
    expect(findings.some(f => f.severity === 'HIGH')).toBe(true);
  });

  it('describes mixed-bypassability main accurately — one un-bypassable rule is enough', () => {
    // main covered by TWO deletion-carrying rulesets, one bypassable and one
    // not. Deletion is still blocked (every() requires all of them), so the
    // message must not say the bypassable one isn't there — it must say at
    // least one un-bypassable rule covers the branch.
    const states = deriveBranchStates([
      ruleset({ branches: ['main'], bypassActorCount: 1 }),
      ruleset({ branches: ['main'], bypassActorCount: 0 }),
      // develop needs its own cover, or its missing deletion rule adds a HIGH
      // and this case stops isolating the main wording.
      ruleset({ branches: ['develop'], bypassActorCount: 0 }),
    ]);
    const findings = evaluateRepoSettings(false, states);
    const medium = findings.find(f => f.severity === 'MEDIUM');

    expect(medium?.message).toContain('At least one deletion rule');
    expect(medium?.message).not.toContain('NOT among');
    // The verdict itself: deletion stays unreachable, so MEDIUM is all there is.
    expect(findings.filter(f => f.severity !== 'MEDIUM')).toEqual([]);
  });

  it("DOES claim the deletion mechanism when main's deletion rule is itself bypassable", () => {
    const findings = evaluateRepoSettings(false, [
      state({ branch: 'main', hasBypassActors: true, deletionRuleFullyBypassable: true }),
      state({ branch: 'develop' }),
    ]);

    const medium = findings.find(f => f.severity === 'MEDIUM');
    expect(medium?.message).toContain('passes straight through');
  });

  it('orders findings most-severe first when several fire together', () => {
    const findings = evaluateRepoSettings(true, [
      state({ branch: 'main', hasDeletionRule: false, hasBypassActors: true }),
      state({ branch: 'develop', hasDeletionRule: false }),
    ]);

    expect(findings.map(f => f.severity)).toEqual(['CRITICAL', 'HIGH', 'HIGH', 'MEDIUM']);
  });
});

describe('collectRepoSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Wire the gh + git seam: repo settings, ruleset list, per-id details, and origin/main's ci.yml. */
  function mockGh(options: {
    deleteBranchOnMerge?: boolean;
    list?: number[];
    details?: Record<string, string>;
    mainWorkflow?: string;
  }): void {
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'git') {
        const gitArgs = args as string[];
        if (gitArgs[0] === 'rev-parse') return 'abc123\n';
        if (gitArgs[0] === 'fetch') return '';
        return options.mainWorkflow ?? DEFAULT_MAIN_WORKFLOW;
      }
      const path = (args as string[])[1];
      if (path === 'graphql') {
        return JSON.stringify({
          data: { repository: { deleteBranchOnMerge: options.deleteBranchOnMerge ?? false } },
        });
      }
      if (path === 'repos/{owner}/{repo}/rulesets') {
        // The projected NDJSON shape, matching `--paginate --jq '.[].id'`.
        return (options.list ?? []).join('\n');
      }
      const detail = options.details?.[path];
      if (detail === undefined) {
        throw new Error(`unexpected gh path: ${path}`);
      }
      return detail;
    });
  }

  it('spends one aggregate budget across the whole sweep, not one per call', () => {
    // Ruleset 1 needs a real detail fixture: it is the third fetch, which the
    // budget still permits. Ruleset 2 deliberately has none — the budget must
    // stop the sweep BEFORE that fetch, so a shim error there would mean the
    // deadline failed to fire. The ruleset loop's own budget exhaustion (below)
    // fires before the git read is ever reached, so this test is unaffected by
    // the required-checks sub-surface.
    mockGh({
      list: [1, 2],
      details: { 'repos/{owner}/{repo}/rulesets/1': rulesetDetail({ refs: ['~ALL'] }) },
    });
    // Half a per-call timeout per read. budget() is consulted four times —
    // repo settings, the ruleset list, then one per id — and the elapsed time
    // at each is 0.5T / 1.0T / 1.5T / 2.0T against a 2T budget. So the first
    // three fetches run and the FOURTH finds nothing left.
    //
    // The tick size is load-bearing: a full-T tick exhausts the budget on the
    // second consultation, so only one gh call would ever run and the sweep
    // would never demonstrate accumulation across calls at all.
    let ticks = 0;
    const now = (): number => GH_TIMEOUT_MS * 0.5 * ticks++;

    const surface = collectRepoSettings({ now });

    expect(surface.available).toBe(false);
    // Exactly the calls that fit: budget exhaustion happened DURING the sweep,
    // not before it. Without this the test would also pass if the very first
    // call threw, which is a different bug.
    expect(vi.mocked(execFileSync).mock.calls).toHaveLength(3);
    // The reason must name the BUDGET, not the last gh error — otherwise the
    // reader chases a network problem that is not there.
    expect(surface.available === false && surface.reason).toContain('budget');
  });

  it('shrinks each call timeout to the REMAINING budget', () => {
    mockGh({ list: [1] });
    let ticks = 0;
    // 0.6 of a per-call timeout per read, against a 2T budget. Elapsed at each
    // consultation is 0.6T / 1.2T / 1.8T, so remaining is 1.4T / 0.8T / 0.2T —
    // only the FIRST call is clamped by the ceiling; the other two are already
    // below it. Ruleset id 1 has no detail fixture, so the sweep never reaches
    // the required-checks read.
    const now = (): number => GH_TIMEOUT_MS * 0.6 * ticks++;

    collectRepoSettings({ now });

    const timeouts = vi
      .mocked(execFileSync)
      .mock.calls.map(call => (call[2] as { timeout: number }).timeout);
    // Asserted as a literal sequence rather than as properties: a property
    // check ("non-increasing, never above the ceiling") is satisfied by more
    // than one implementation, and the prose explaining WHY drifted from the
    // arithmetic once already. The sequence cannot drift from itself.
    expect(timeouts).toEqual([
      GH_TIMEOUT_MS, // 1.4T remaining, clamped to the ceiling
      GH_TIMEOUT_MS * 0.8,
      GH_TIMEOUT_MS * 0.2,
    ]);
  });

  it('never hands execFileSync a fractional timeout', () => {
    mockGh({ list: [] });
    // The tick has to be chosen so the REMAINING budget is fractional AND below
    // the per-call ceiling — the clamp returns an integer whenever remaining
    // exceeds the ceiling, so a naive fractional clock never reaches the branch
    // at all. (Learned by canary: a half-millisecond tick left this test green
    // with Math.floor removed.) At 20000.25 per tick the two gh consultations
    // see 39999.75 (clamped to 30000) and 19999.5 (fractional, unclamped); the
    // required-checks read's own budget() calls run out and degrade THAT
    // sub-surface independently, without ever handing execFileSync a call.
    //
    // Node rejects a non-integer `timeout` with ERR_OUT_OF_RANGE — verified by
    // running it — which the catch would swallow into a misleading
    // "unavailable" naming a gh problem rather than a clock one.
    let ticks = 0;
    const now = (): number => ticks++ * 20000.25;

    const surface = collectRepoSettings({ now });

    expect(surface.available).toBe(true);
    for (const call of vi.mocked(execFileSync).mock.calls) {
      expect(Number.isInteger((call[2] as { timeout: number }).timeout)).toBe(true);
    }
  });

  it('never hands execFileSync a zero timeout', () => {
    mockGh({ list: [] });
    // A tick that leaves the remaining budget fractional and strictly between
    // 0 and 1 on the second consultation: 2T - 59999.5 = 0.5. The `left <= 0`
    // throw does not catch that, and Math.floor alone would turn it into 0 —
    // which Node reads as NO TIMEOUT rather than expire-now, handing that call
    // an unbounded wait. The third consultation (rulesets list) exhausts the
    // budget outright, so the required-checks read is never reached.
    let ticks = 0;
    const now = (): number => ticks++ * 59999.5;

    collectRepoSettings({ now });

    for (const call of vi.mocked(execFileSync).mock.calls) {
      expect((call[2] as { timeout: number }).timeout).toBeGreaterThan(0);
    }
  });

  it('completes normally when the sweep fits inside the budget', () => {
    mockGh({ list: [] });
    const surface = collectRepoSettings({ now: () => 0 });
    expect(surface.available).toBe(true);
  });

  it('Fix 3: the git show timeout is capped by the sweep budget', () => {
    mockGh({ list: [] });
    collectRepoSettings({ now: () => 0 });
    const zeroClockShow = vi
      .mocked(execFileSync)
      .mock.calls.find(c => c[0] === 'git' && (c[1] as string[])[0] === 'show');
    expect(zeroClockShow?.[2]).toMatchObject({ timeout: GIT_SHOW_TIMEOUT_MS });

    vi.clearAllMocks();
    mockGh({ list: [] });
    // The FIRST now() call captures startedAt; every later consultation returns a
    // constant REPO_SETTINGS_BUDGET_MS - 5_000 elapsed, so every subsequent git/gh
    // call — including the `show` — sees exactly 5_000ms remaining.
    let calls = 0;
    const now = (): number => (calls++ === 0 ? 0 : REPO_SETTINGS_BUDGET_MS - 5_000);

    collectRepoSettings({ now });
    const clampedShow = vi
      .mocked(execFileSync)
      .mock.calls.find(c => c[0] === 'git' && (c[1] as string[])[0] === 'show');
    expect(clampedShow?.[2]).toMatchObject({ timeout: 5_000 });
  });

  it('fetches origin/main when the ref is missing locally, then still reads it', () => {
    let revParseCalls = 0;
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'git') {
        const gitArgs = args as string[];
        if (gitArgs[0] === 'rev-parse') {
          revParseCalls++;
          throw new Error('unknown revision');
        }
        if (gitArgs[0] === 'fetch') return '';
        return DEFAULT_MAIN_WORKFLOW; // show
      }
      const path = (args as string[])[1];
      if (path === 'graphql') {
        return JSON.stringify({ data: { repository: { deleteBranchOnMerge: false } } });
      }
      if (path === 'repos/{owner}/{repo}/rulesets') return '';
      throw new Error(`unexpected gh path: ${path}`);
    });

    const surface = collectRepoSettings();

    expect(revParseCalls).toBe(1);
    const gitCalls = vi.mocked(execFileSync).mock.calls.filter(c => c[0] === 'git');
    expect(gitCalls.map(c => c[1])).toContainEqual(['fetch', 'origin', 'main', '--depth=1']);
    expect(gitCalls.map(c => c[1])).toContainEqual(['show', MAIN_CI_WORKFLOW_REF]);
    expect(surface.available).toBe(true);
  });

  it('passes gh arguments as an array (never an interpolated shell string)', () => {
    mockGh({ list: [] });

    collectRepoSettings();

    const calls = vi.mocked(execFileSync).mock.calls;
    for (const call of calls.filter(c => c[0] === 'gh')) {
      expect(Array.isArray(call[1])).toBe(true);
      expect((call[1] as string[])[0]).toBe('api');
    }
    const gitCalls = calls.filter(c => c[0] === 'git');
    expect(gitCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of gitCalls) {
      expect(Array.isArray(call[1])).toBe(true);
    }
    expect(gitCalls.map(c => c[1])).toContainEqual([
      'show',
      'origin/main:.github/workflows/ci.yml',
    ]);
  });

  it('fetches the ruleset list with --paginate and a streaming projection', () => {
    // Without both flags the list silently truncates at GitHub's 30-per-page
    // default; --paginate alone emits one JSON document per page, which no
    // whole-body parse survives. Asserted at the seam because the mock returns
    // the same fixture either way — the args are the only observable.
    mockGh({ list: [] });

    collectRepoSettings();

    const listCall = vi
      .mocked(execFileSync)
      .mock.calls.find(c => (c[1] as string[])[1] === 'repos/{owner}/{repo}/rulesets');
    expect(listCall?.[1]).toEqual([
      'api',
      'repos/{owner}/{repo}/rulesets',
      '--paginate',
      '--jq',
      '.[].id',
    ]);
  });

  it('reads the live shape end to end and reports the deliberate develop bypass as clean', () => {
    mockGh({
      deleteBranchOnMerge: false,
      list: [7, 8],
      details: {
        'repos/{owner}/{repo}/rulesets/7': rulesetDetail({
          refs: ['~DEFAULT_BRANCH'],
          rules: ['deletion'],
          bypassActors: [],
        }),
        'repos/{owner}/{repo}/rulesets/8': rulesetDetail({
          refs: ['refs/heads/develop'],
          rules: ['deletion'],
          bypassActors: [{ actor_type: 'RepositoryRole', bypass_mode: 'always' }],
        }),
      },
    });

    const surface = collectRepoSettings();

    expect(surface.available).toBe(true);
    if (!surface.available) return;
    expect(surface.deleteBranchOnMerge).toBe(false);
    expect(surface.findings).toEqual([]);
  });

  it('is CRITICAL for that same ruleset shape once auto-delete is re-armed', () => {
    mockGh({
      deleteBranchOnMerge: true,
      list: [8],
      details: {
        'repos/{owner}/{repo}/rulesets/8': rulesetDetail({
          refs: ['refs/heads/develop'],
          rules: ['deletion'],
          bypassActors: [{ actor_type: 'RepositoryRole', bypass_mode: 'always' }],
        }),
      },
    });

    const surface = collectRepoSettings();

    expect(surface.available).toBe(true);
    if (!surface.available) return;
    expect(surface.findings.map(f => f.severity)).toContain('CRITICAL');
  });

  it('degrades the WHOLE surface when one ruleset payload is unparseable', () => {
    // Deliberate: a single unreadable ruleset blinds the guard entirely rather
    // than being skipped, because a verdict computed from a knowingly-partial
    // ruleset set would be a confident answer built on missing data.
    mockGh({
      list: [7, 8],
      details: {
        'repos/{owner}/{repo}/rulesets/7': rulesetDetail({ refs: ['~ALL'] }),
        'repos/{owner}/{repo}/rulesets/8': '<html>502 Bad Gateway</html>',
      },
    });

    const surface = collectRepoSettings();

    expect(surface.available).toBe(false);
    if (surface.available) return;
    expect(surface.reason).toContain('unparseable');
  });

  it('degrades with a reason instead of throwing when gh fails', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      const error = new Error('Command failed') as Error & { stderr: string };
      error.stderr = 'gh: To get started with GitHub CLI, please run: gh auth login\n';
      throw error;
    });

    const surface = collectRepoSettings();

    expect(surface.available).toBe(false);
    if (surface.available) return;
    expect(surface.reason).toContain('gh auth login');
  });

  it('degrades when the graphql response has no boolean repository.deleteBranchOnMerge', () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify({ message: 'Not Found' }));

    const surface = collectRepoSettings();

    expect(surface.available).toBe(false);
    if (surface.available) return;
    expect(surface.reason).toContain('deleteBranchOnMerge');
  });

  it('degrades on a REST-shaped body, proving the read moved off the REST object', () => {
    // The canary for the whole change. REST withholds delete_branch_on_merge
    // from a fine-grained token (it answers null), which is why this read is a
    // GraphQL one — so a REST-shaped body must NOT satisfy it. Were the old
    // REST parse still in place, this fixture would produce a clean surface.
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify({ delete_branch_on_merge: true }));

    const surface = collectRepoSettings();

    expect(surface.available).toBe(false);
    if (surface.available) return;
    expect(surface.reason).toContain('deleteBranchOnMerge');
  });

  it('G1 seam: a main-required context missing from origin/main ci.yml surfaces as a HIGH finding', () => {
    mockGh({
      list: [7],
      details: {
        'repos/{owner}/{repo}/rulesets/7': rulesetDetail({
          refs: ['~DEFAULT_BRANCH'],
          rules: ['deletion'],
          requiredChecks: ['lint', 'hook-posix-parse'],
        }),
      },
      mainWorkflow: 'jobs:\n  lint: {}\n',
    });
    const surface = collectRepoSettings();

    expect(surface.available).toBe(true);
    if (!surface.available) return;
    expect(surface.requiredChecks.available).toBe(true);
    if (!surface.requiredChecks.available) return;
    const target = surface.requiredChecks.findings.find(
      f => f.severity === 'HIGH' && f.message.includes('`hook-posix-parse`')
    );
    expect(target).toBeDefined();
    expect(target?.message).toContain('wait until the release');
    expect(surface.requiredChecks.warnings).toEqual([]);
  });

  it('live shape: the 12 main + 14 develop contexts pass cleanly', () => {
    const mainChecks = [
      'lint',
      'build',
      'unit-tests (ai-worker)',
      'unit-tests (api-gateway)',
      'unit-tests (bot-client)',
      'unit-tests (packages)',
      'unit-tests (tooling)',
      'unit-tests (website)',
      'component-integration-tests',
      'docker-build-smoke-ok',
      'voice-engine-tests',
      'mutation-tests',
    ];
    const developChecks = [...mainChecks, 'fixup-check', 'hook-posix-parse'];
    mockGh({
      list: [7, 8],
      details: {
        'repos/{owner}/{repo}/rulesets/7': rulesetDetail({
          refs: ['~DEFAULT_BRANCH'],
          rules: ['deletion'],
          requiredChecks: mainChecks,
        }),
        'repos/{owner}/{repo}/rulesets/8': rulesetDetail({
          refs: ['refs/heads/develop'],
          rules: ['deletion'],
          bypassActors: [{ actor_type: 'RepositoryRole', bypass_mode: 'always' }],
          requiredChecks: developChecks,
        }),
      },
    });

    const clean = collectRepoSettings();

    expect(clean.available).toBe(true);
    if (clean.available) {
      expect(clean.findings).toEqual([]);
      expect(clean.requiredChecks.available).toBe(true);
      if (clean.requiredChecks.available) {
        expect(clean.requiredChecks.findings).toEqual([]);
        expect(clean.requiredChecks.warnings).toEqual([]);
      }
    }

    mockGh({
      list: [7, 8],
      details: {
        'repos/{owner}/{repo}/rulesets/7': rulesetDetail({
          refs: ['~DEFAULT_BRANCH'],
          rules: ['deletion'],
          requiredChecks: mainChecks,
        }),
        'repos/{owner}/{repo}/rulesets/8': rulesetDetail({
          refs: ['refs/heads/develop'],
          rules: ['deletion'],
          bypassActors: [{ actor_type: 'RepositoryRole', bypass_mode: 'always' }],
          requiredChecks: developChecks,
        }),
      },
      mainWorkflow: DEFAULT_MAIN_WORKFLOW + '  hook-posix-parse: {}\n',
    });
    const withJob = collectRepoSettings();

    expect(withJob.available).toBe(true);
    if (!withJob.available) return;
    expect(withJob.findings).toEqual([]);
    expect(withJob.requiredChecks.available).toBe(true);
    if (!withJob.requiredChecks.available) return;
    expect(withJob.requiredChecks.findings).toEqual([]);
    expect(withJob.requiredChecks.warnings).toHaveLength(1);
    expect(withJob.requiredChecks.warnings[0]).toContain('`hook-posix-parse`');
    expect(withJob.requiredChecks.warnings.some(w => w.includes('fixup-check'))).toBe(false);
  });

  it('decouples: an unreadable origin/main degrades only the required-checks sub-surface', () => {
    // NO ruleset at all, so both branches lack a deletion rule — the deletion-safety findings
    // this fixture produces are the ones asserted below, isolating the decoupling from an
    // incidentally-empty findings array.
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'git') {
        const error = new Error('Command failed') as Error & { stderr: string };
        error.stderr = "fatal: invalid object name 'origin/main'\n";
        throw error;
      }
      const path = (args as string[])[1];
      if (path === 'graphql') {
        return JSON.stringify({ data: { repository: { deleteBranchOnMerge: false } } });
      }
      if (path === 'repos/{owner}/{repo}/rulesets') {
        return '';
      }
      throw new Error(`unexpected gh path: ${path}`);
    });

    const surface = collectRepoSettings();

    expect(surface.available).toBe(true);
    if (!surface.available) return;
    expect(surface.findings.some(f => f.severity === 'HIGH')).toBe(true);
    expect(surface.requiredChecks.available).toBe(false);
    if (surface.requiredChecks.available) return;
    expect(surface.requiredChecks.reason).toContain('invalid object name');
  });

  it('via checkRepoSettings, a clean deletion fixture with git failing prints only the required-checks degradation', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'git') {
        const error = new Error('Command failed') as Error & { stderr: string };
        error.stderr = "fatal: invalid object name 'origin/main'\n";
        throw error;
      }
      const path = (args as string[])[1];
      if (path === 'graphql') {
        return JSON.stringify({ data: { repository: { deleteBranchOnMerge: false } } });
      }
      if (path === 'repos/{owner}/{repo}/rulesets') return '7\n8';
      if (path === 'repos/{owner}/{repo}/rulesets/7') {
        return rulesetDetail({ refs: ['~DEFAULT_BRANCH'], rules: ['deletion'] });
      }
      if (path === 'repos/{owner}/{repo}/rulesets/8') {
        return rulesetDetail({
          refs: ['refs/heads/develop'],
          rules: ['deletion'],
          bypassActors: [{ actor_type: 'RepositoryRole', bypass_mode: 'always' }],
        });
      }
      throw new Error(`unexpected gh path: ${path}`);
    });

    checkRepoSettings();

    expect(process.exitCode).toBeUndefined();
    const printed = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(printed).toContain('main-required-checks: unavailable');
  });
});

describe('fetchDeleteBranchOnMerge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the setting over graphql, with owner/name passed as gh placeholders', () => {
    // Asserted at the seam because the mock returns the same body whatever the
    // args are: the argv IS the only observable that the call went to GraphQL
    // with its variables bound. `true` (not the default `false`) so a silently
    // defaulted return cannot masquerade as a parsed one.
    vi.mocked(execFileSync).mockReturnValue(
      JSON.stringify({ data: { repository: { deleteBranchOnMerge: true } } })
    );

    expect(fetchDeleteBranchOnMerge()).toBe(true);

    expect(vi.mocked(execFileSync)).toHaveBeenCalledTimes(1);
    const [cmd, argv] = vi.mocked(execFileSync).mock.calls[0];
    expect(cmd).toBe('gh');
    const args = argv as string[];
    expect(args.slice(0, 2)).toEqual(['api', 'graphql']);
    // Index-paired rather than a bare `toContain` on each token, so a stray
    // flag beside the wrong value cannot satisfy the assertion.
    expect(args[args.indexOf('owner={owner}') - 1]).toBe('-F');
    expect(args[args.indexOf('name={repo}') - 1]).toBe('-F');
    const query = args.find(a => a.startsWith('query='));
    expect(query).toBeDefined();
    expect(args[args.indexOf(query as string) - 1]).toBe('-f');
    expect(query).toContain('deleteBranchOnMerge');
  });
});

describe('formatRepoSettingsReport', () => {
  it('renders the degradation line', () => {
    expect(formatRepoSettingsReport({ available: false, reason: 'gh not found' })).toContain(
      'unavailable (gh not found)'
    );
  });

  it('renders the clean case with the observed per-branch state', () => {
    const text = formatRepoSettingsReport({
      available: true,
      deleteBranchOnMerge: false,
      branches: [
        state({ branch: 'main' }),
        state({ branch: 'develop', deletionRuleFullyBypassable: true, hasBypassActors: true }),
      ],
      findings: [],
      requiredChecks: { available: true, findings: [], warnings: [] },
    });
    expect(text).toContain('✓ No deletion-safety findings');
    // The clean report must describe observed CONFIGURATION and never promise
    // an outcome. The premise underneath it — that a bypass-actor-free deletion
    // rule stops GitHub's admin-privileged auto-delete — is now probe-verified,
    // so the wording may say so; what it still must NOT do is claim the ruleset
    // is SUFFICIENT. One branch on one repo is not a guarantee, and
    // `delete_branch_on_merge: false` remains the protection that assumes
    // nothing. These two assertions pin both halves of that: the verified claim
    // is present, the sufficiency claim is absent.
    expect(text).toContain('not a proof of sufficiency');
    expect(text).not.toContain('deletion is unreachable');
    expect(text).not.toContain('deletion is impossible');
    // This fixture IS the clean-but-bypassable state (delete_branch_on_merge
    // off, develop's deletion rule fully bypassable — the repo's live shape), so
    // a headline generalising over branches would contradict the state line two
    // rows below it. Zero findings is all the headline gets to claim.
    expect(text).not.toContain('every long-lived branch');
    expect(text).toContain('✓ No deletion-safety findings. What each branch actually carries');
    expect(text).toContain('probe-verified');
    // One paragraph: Discord renders every '\n' as a hard break, so wrapped
    // prose lands in the owner channel as jagged half-lines. State lines only.
    expect(text.split('\n')[0]).toContain('assumes nothing.');
    expect(text).toContain('delete_branch_on_merge: false');
    expect(text).toContain('main: deletion rule present, not bypassable');
    expect(text).toContain('develop: deletion rule present but fully bypassable');
  });

  it('renders each finding with its severity', () => {
    const text = formatRepoSettingsReport({
      available: true,
      deleteBranchOnMerge: true,
      branches: [state({ branch: 'main' }), state({ branch: 'develop', hasDeletionRule: false })],
      findings: [
        { severity: 'CRITICAL', message: 'boom' },
        { severity: 'HIGH', message: 'no deletion rule' },
      ],
      requiredChecks: { available: true, findings: [], warnings: [] },
    });

    expect(text).toContain('2 repo deletion-safety findings:');
    expect(text).toContain('CRITICAL: boom');
    expect(text).toContain('HIGH: no deletion rule');
  });

  it('renders warnings after the clean state, keeping the clean headline', () => {
    const text = formatRepoSettingsReport({
      available: true,
      deleteBranchOnMerge: false,
      branches: [state({ branch: 'main' }), state({ branch: 'develop' })],
      findings: [],
      requiredChecks: { available: true, findings: [], warnings: ['re-add X'] },
    });

    expect(text.startsWith('✓ No deletion-safety findings')).toBe(true);
    expect(text).toContain('WARNING (not a failure): re-add X');
  });

  it('renders warnings alongside findings', () => {
    const text = formatRepoSettingsReport({
      available: true,
      deleteBranchOnMerge: true,
      branches: [state({ branch: 'main' })],
      findings: [{ severity: 'HIGH', message: 'no deletion rule' }],
      requiredChecks: { available: true, findings: [], warnings: ['re-add X'] },
    });
    expect(text).toContain('HIGH: no deletion rule');
    expect(text).toContain('WARNING (not a failure): re-add X');
  });

  it('Fix 4 (i): renders both headlines when a deletion finding and a required-check finding are both present', () => {
    const text = formatRepoSettingsReport({
      available: true,
      deleteBranchOnMerge: true,
      branches: [state({ branch: 'main' }), state({ branch: 'develop', hasDeletionRule: false })],
      findings: [{ severity: 'HIGH', message: 'no deletion rule' }],
      requiredChecks: {
        available: true,
        findings: [{ severity: 'HIGH', message: 'main requires `bogus`' }],
        warnings: [],
      },
    });

    expect(text).toContain('1 repo deletion-safety finding:');
    expect(text).toContain('HIGH: no deletion rule');
    expect(text).toContain('1 main-required-check finding:');
    expect(text).toContain('HIGH: main requires `bogus`');
  });

  it('Fix 4 (ii): renders a checks-only finding under the clean deletion headline', () => {
    const text = formatRepoSettingsReport({
      available: true,
      deleteBranchOnMerge: false,
      branches: [state({ branch: 'main' }), state({ branch: 'develop' })],
      findings: [],
      requiredChecks: {
        available: true,
        findings: [{ severity: 'HIGH', message: 'main requires `bogus`' }],
        warnings: [],
      },
    });

    expect(text.startsWith('✓ No deletion-safety findings')).toBe(true);
    expect(text).toContain('❌ 1 main-required-check finding:');
  });

  it('Fix 4 (iii): renders the unavailable required-checks line while leaving the deletion block intact', () => {
    const text = formatRepoSettingsReport({
      available: true,
      deleteBranchOnMerge: false,
      branches: [state({ branch: 'main' }), state({ branch: 'develop' })],
      findings: [],
      requiredChecks: { available: false, reason: "fatal: invalid object name 'origin/main'" },
    });

    expect(text.startsWith('✓ No deletion-safety findings')).toBe(true);
    expect(text).toContain(
      "main-required-checks: unavailable — fatal: invalid object name 'origin/main'"
    );
  });
});

describe('checkRepoSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  it('exits nonzero on findings', () => {
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'git') return 'jobs:\n  lint: {}\n';
      const path = (args as string[])[1];
      if (path === 'graphql') {
        return JSON.stringify({ data: { repository: { deleteBranchOnMerge: true } } });
      }
      return JSON.stringify([]);
    });

    checkRepoSettings();

    expect(process.exitCode).toBe(1);
  });

  it('fails OPEN when the API is unreadable', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('gh: command not found');
    });

    checkRepoSettings();

    expect(process.exitCode).toBeUndefined();
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('unavailable');
  });

  it('emits the raw surface under --json', () => {
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'git') return 'jobs:\n  lint: {}\n';
      const path = (args as string[])[1];
      if (path === 'graphql') {
        return JSON.stringify({ data: { repository: { deleteBranchOnMerge: false } } });
      }
      return JSON.stringify([]);
    });

    checkRepoSettings({ json: true });

    const printed = JSON.parse(String(vi.mocked(console.log).mock.calls[0][0])) as {
      available: boolean;
      deleteBranchOnMerge: boolean;
    };
    expect(printed.available).toBe(true);
    expect(printed.deleteBranchOnMerge).toBe(false);
  });

  it('sets exitCode from a main-required-checks finding too', () => {
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'git') return 'jobs:\n  lint: {}\n';
      const path = (args as string[])[1];
      if (path === 'graphql')
        return JSON.stringify({ data: { repository: { deleteBranchOnMerge: false } } });
      if (path === 'repos/{owner}/{repo}/rulesets') return '7\n8';
      if (path === 'repos/{owner}/{repo}/rulesets/7') {
        return rulesetDetail({
          refs: ['~DEFAULT_BRANCH'],
          rules: ['deletion'],
          requiredChecks: ['bogus-context'],
        });
      }
      if (path === 'repos/{owner}/{repo}/rulesets/8') {
        return rulesetDetail({
          refs: ['refs/heads/develop'],
          rules: ['deletion'],
          bypassActors: [{ actor_type: 'RepositoryRole', bypass_mode: 'always' }],
        });
      }
      throw new Error(`unexpected gh path: ${path}`);
    });
    checkRepoSettings();

    expect(process.exitCode).toBe(1);
    const printed = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(printed).toContain('1 main-required-check finding:');
    expect(printed).toContain('`bogus-context`');
  });

  it('a warning-only surface leaves exitCode untouched and prints WARNING', () => {
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'git') return 'jobs:\n  lint: {}\n  hook-posix-parse: {}\n';
      const path = (args as string[])[1];
      if (path === 'graphql')
        return JSON.stringify({ data: { repository: { deleteBranchOnMerge: false } } });
      if (path === 'repos/{owner}/{repo}/rulesets') return '7\n8';
      if (path === 'repos/{owner}/{repo}/rulesets/7') {
        return rulesetDetail({
          refs: ['~DEFAULT_BRANCH'],
          rules: ['deletion'],
          requiredChecks: ['lint'],
        });
      }
      if (path === 'repos/{owner}/{repo}/rulesets/8') {
        return rulesetDetail({
          refs: ['refs/heads/develop'],
          rules: ['deletion'],
          bypassActors: [{ actor_type: 'RepositoryRole', bypass_mode: 'always' }],
          requiredChecks: ['lint', 'hook-posix-parse'],
        });
      }
      throw new Error(`unexpected gh path: ${path}`);
    });
    checkRepoSettings();

    expect(process.exitCode).toBeUndefined();
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('WARNING');
  });
});
