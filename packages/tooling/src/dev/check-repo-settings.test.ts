/**
 * Tests for the repo deletion-safety guard.
 *
 * The pure pieces (parsing, derivation, evaluation, rendering) are tested
 * directly; the `gh` seam is mocked and the args crossing it are asserted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { GH_TIMEOUT_MS } from '../audits/health-extras.js';
import {
  LONG_LIVED_BRANCHES,
  isDeletionReachable,
  parseRulesetIds,
  parseRulesetDetail,
  deriveBranchStates,
  evaluateRepoSettings,
  collectRepoSettings,
  formatRepoSettingsReport,
  checkRepoSettings,
  type ActiveBranchRuleset,
  type BranchDeletionState,
} from './check-repo-settings.js';

/** A ruleset detail payload as GitHub returns it, with overridable pieces. */
function rulesetDetail(overrides: {
  refs?: string[];
  excludeRefs?: string[];
  rules?: string[];
  bypassActors?: unknown[];
  enforcement?: string;
  target?: string;
}): string {
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
    rules: (overrides.rules ?? ['deletion']).map(type => ({ type })),
    bypass_actors: overrides.bypassActors ?? [],
  });
}

function state(overrides: Partial<BranchDeletionState> & { branch: string }): BranchDeletionState {
  return {
    hasDeletionRule: true,
    deletionRuleFullyBypassable: false,
    hasBypassActors: false,
    ...overrides,
  };
}

function ruleset(overrides: Partial<ActiveBranchRuleset> = {}): ActiveBranchRuleset {
  return { branches: ['main'], hasDeletionRule: true, bypassActorCount: 0, ...overrides };
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
    expect(parsed).toEqual({ branches: [], hasDeletionRule: false, bypassActorCount: 0 });
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

  /** Wire the gh seam: repo settings, ruleset list, then per-id details. */
  function mockGh(options: {
    deleteBranchOnMerge?: boolean;
    list?: number[];
    details?: Record<string, string>;
  }): void {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const path = (args as string[])[1];
      if (path === 'repos/{owner}/{repo}') {
        return JSON.stringify({ delete_branch_on_merge: options.deleteBranchOnMerge ?? false });
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
    // deadline failed to fire.
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
    // below it.
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
    // with Math.floor removed.) At 20000.25 per tick the two consultations see
    // 39999.75 (clamped to 30000) and 19999.5 (fractional, unclamped).
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
    // an unbounded wait.
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

  it('passes gh arguments as an array (never an interpolated shell string)', () => {
    mockGh({ list: [] });

    collectRepoSettings();

    for (const call of vi.mocked(execFileSync).mock.calls) {
      expect(call[0]).toBe('gh');
      expect(Array.isArray(call[1])).toBe(true);
      expect((call[1] as string[])[0]).toBe('api');
    }
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

  it('degrades when the repo response has no boolean delete_branch_on_merge', () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify({ message: 'Not Found' }));

    const surface = collectRepoSettings();

    expect(surface.available).toBe(false);
    if (surface.available) return;
    expect(surface.reason).toContain('delete_branch_on_merge');
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
    });

    expect(text).toContain('✓ No deletion-safety findings');
    // The clean report must describe observed CONFIGURATION, never promise an
    // outcome: that a bypass-actor-free deletion rule actually stops GitHub's
    // admin-privileged auto-delete is an unverified premise, so the wording
    // must not read as a settled guarantee.
    expect(text).toContain('not a proven guarantee');
    expect(text).not.toContain('deletion is unreachable');
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
    });

    expect(text).toContain('2 repo deletion-safety findings:');
    expect(text).toContain('CRITICAL: boom');
    expect(text).toContain('HIGH: no deletion rule');
  });
});

describe('checkRepoSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  it('exits nonzero on findings', () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const path = (args as string[])[1];
      if (path === 'repos/{owner}/{repo}') {
        return JSON.stringify({ delete_branch_on_merge: true });
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
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const path = (args as string[])[1];
      if (path === 'repos/{owner}/{repo}') {
        return JSON.stringify({ delete_branch_on_merge: false });
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
});
