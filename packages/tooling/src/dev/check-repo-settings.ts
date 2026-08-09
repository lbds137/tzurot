/**
 * Guard: deletion of a long-lived branch (`main`, `develop`) must be UNREACHABLE.
 *
 * Two independent GitHub settings compose into that invariant, and neither one
 * is sufficient alone:
 *
 * - **`delete_branch_on_merge`** (repo setting) deletes the HEAD branch on
 *   EVERY merge, regardless of any per-merge `--delete-branch` flag. It is a
 *   repo-wide toggle, so a release PR (`develop` → `main`) is a merge like any
 *   other and its head branch is `develop`.
 * - **A branch ruleset's `deletion` rule** is what would otherwise stop that —
 *   except GitHub performs the auto-delete with ADMIN privileges, so a ruleset
 *   that lists any `bypass_actors` is passed straight through and protects
 *   nothing against this path.
 *
 * `develop` deliberately carries bypass actors (they are required for
 * `pnpm ops release:finalize`'s force-push and for the sanctioned direct
 * doc-commit path), so bypass actors on `develop` are NEVER a finding on their
 * own — only as the contributing condition of the CRITICAL combination above.
 * `main` is meant to be absolute: bypass actors there are a finding in their
 * own right.
 *
 * Binary sync-check (like guard:duplicate-exports), NOT audit-class: no
 * threshold, no WHY.md, no --summary. Network-dependent, so it degrades to a
 * reported reason and exits 0 rather than blocking on a query it cannot run.
 */

import { execFileSync } from 'node:child_process';
import { GH_TIMEOUT_MS, describeGhFailure } from '../audits/health-extras.js';

/** Branches that must never be deletable. */
export const LONG_LIVED_BRANCHES = ['main', 'develop'] as const;

/**
 * What `~DEFAULT_BRANCH` resolves to in a ruleset's `conditions.ref_name.include`.
 * Hardcoded rather than resolved via an extra API call: the repo's default
 * branch is `main`, and a drift here would surface as `main` losing its ruleset
 * coverage — a HIGH finding, i.e. loud rather than silent.
 */
const DEFAULT_BRANCH = 'main';

/** The ruleset rule type whose presence blocks branch deletion. */
const DELETION_RULE = 'deletion';

/** Ref-name token meaning "every branch" in a ruleset's `conditions.ref_name`. */
const ALL_BRANCHES_REF = '~ALL';

/** Ref-name token meaning the repository's default branch. */
const DEFAULT_BRANCH_REF = '~DEFAULT_BRANCH';

/** Per-branch protection state, derived from the active branch rulesets. */
export interface BranchDeletionState {
  branch: string;
  /** True when at least one active branch ruleset targeting it carries a `deletion` rule. */
  hasDeletionRule: boolean;
  /**
   * True when every ruleset carrying that branch's `deletion` rule also lists
   * bypass actors — i.e. an admin-privileged delete passes through all of them.
   */
  deletionRuleFullyBypassable: boolean;
  /** True when any active ruleset targeting the branch lists bypass actors. */
  hasBypassActors: boolean;
}

/** Severity ordering matches the report order: most severe first. */
export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM';

export interface RepoSettingsFinding {
  severity: FindingSeverity;
  message: string;
}

/** Everything the guard could read, or the reason it could not read it. */
export type RepoSettingsSurface =
  | {
      available: true;
      deleteBranchOnMerge: boolean;
      branches: BranchDeletionState[];
      findings: RepoSettingsFinding[];
    }
  | { available: false; reason: string };

/** One active branch ruleset, reduced to the fields this guard reasons about. */
export interface ActiveBranchRuleset {
  /** Branch names this ruleset applies to (refs and `~DEFAULT_BRANCH` already resolved). */
  branches: string[];
  hasDeletionRule: boolean;
  bypassActorCount: number;
}

/**
 * A branch is deletion-reachable when nothing structurally stops an
 * admin-privileged delete: either no active ruleset carries a `deletion` rule,
 * or every ruleset that does can be bypassed.
 *
 * UNVERIFIED PREMISE — read before trusting a clean report. The converse (a
 * deletion rule with ZERO bypass actors actually blocks the admin-privileged
 * auto-delete) has never been observed. The incident that motivated this guard
 * demonstrates only the FAILURE case: a bypassable rule on `develop`, deleted.
 * `main` survived because `main` is never the head branch of any merge here —
 * feature PRs merge into `develop`, and the release PR's head is `develop` —
 * NOT because its bypass-actor-free rule was exercised and held.
 *
 * So a "safe" verdict rests on how GitHub is assumed to treat bypass actors on
 * that path. If the auto-delete ignores rulesets entirely, this reports safe
 * for a branch that is still deletable — the silent direction. The falsifying
 * probe is cheap and has not been run: a disposable repo with a no-bypass
 * deletion rule and `delete_branch_on_merge: true`, merge a PR whose head is
 * that branch, see whether it survives. Until then the primary protection is
 * `delete_branch_on_merge: false`, which needs no assumption about rulesets.
 */
export function isDeletionReachable(state: BranchDeletionState): boolean {
  return !state.hasDeletionRule || state.deletionRuleFullyBypassable;
}

/* -------------------------------------------------------------------------- */
/* gh fetch + parsing                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Overall budget for ONE `collectRepoSettings()` sweep.
 *
 * Without it the sweep is `1 + 1 + N` sequential `gh` calls, each carrying its
 * own independent `GH_TIMEOUT_MS` — so a repo with many rulesets plus a slow or
 * flaky `gh` compounds into MINUTES of waiting before the surface degrades to
 * "unavailable". Both call sites (release preflight, weekly ops health) are
 * latency-tolerant today and this repo has two rulesets, but a per-call timeout
 * with no aggregate is a budget only in the single-call case, and the ruleset
 * count is not ours to bound.
 *
 * 60s = two full per-call timeouts: one slow call plus its successor, past
 * which an informational surface has stopped being worth waiting for.
 */
export const REPO_SETTINGS_BUDGET_MS = 2 * GH_TIMEOUT_MS;

/**
 * Run one `gh api` call and return its raw stdout. Throws on any gh failure.
 *
 * `timeoutMs` is the REMAINING budget, not a fresh allowance — the caller
 * shrinks it as the sweep proceeds, so one slow call cannot overrun the whole
 * budget by itself.
 */
function ghApi(path: string, timeoutMs: number, ...extraArgs: string[]): string {
  return execFileSync('gh', ['api', path, ...extraArgs], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });
}

/**
 * Fetch every ruleset id, across pages, as newline-delimited numbers.
 *
 * `gh api` does NOT auto-paginate, and GitHub's default page size is 30 — so a
 * plain call silently evaluates only the first page once the repo grows past
 * that, dropping deletion rules that exist and reporting the branch as
 * unprotected.
 *
 * `--paginate` alone would not fix it: gh emits one JSON document PER PAGE, so
 * parsing the concatenated body fails past page 1. Pairing it with a streaming
 * `--jq` projection is the pattern the codebase already uses for this exact
 * class of endpoint (see `audits/advisories.ts`) — one value per line across
 * every page, with no array framing to reassemble.
 */
function fetchRulesetIdsNdjson(timeoutMs: number): string {
  return ghApi('repos/{owner}/{repo}/rulesets', timeoutMs, '--paginate', '--jq', '.[].id');
}

/** Fetch `delete_branch_on_merge`; throws when the field is missing or not a boolean. */
export function fetchDeleteBranchOnMerge(timeoutMs: number = GH_TIMEOUT_MS): boolean {
  const parsed = safeParse(ghApi('repos/{owner}/{repo}', timeoutMs), 'repository');
  const value = asRecord(parsed)?.delete_branch_on_merge;
  if (typeof value !== 'boolean') {
    throw new Error('repository response has no boolean delete_branch_on_merge');
  }
  return value;
}

/** Narrow an unknown to a plain object, or undefined when it is not one. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** JSON.parse with a caller-named failure message for the degradation line. */
function safeParse(raw: string, what: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`unparseable ${what} response from gh`);
  }
}

/**
 * Collect ruleset ids from the newline-delimited projection above. A line that
 * is not a finite integer (jq emits `null` for an entry with no `id`) is
 * dropped rather than propagated — one malformed entry must not poison the
 * whole surface.
 *
 * An error response needs no special case here: the `--jq` projection fails
 * against a non-array body, so `gh` exits nonzero and the caller degrades to
 * "unavailable" — never to a false-clean empty list.
 */
export function parseRulesetIds(raw: string): number[] {
  const ids: number[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const id = Number(trimmed);
    if (Number.isInteger(id)) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Expand one ruleset ref-name pattern into the long-lived branches it covers.
 *
 * `~ALL` and `~DEFAULT_BRANCH` are GitHub's wildcard tokens; a literal
 * `refs/heads/<name>` is stripped to its branch name. `~ALL` expands to the
 * long-lived set rather than to every branch in the repo, because those are the
 * only branches this guard reasons about — expanding further would add names
 * nothing downstream reads.
 *
 * Returning an array (not a single name) is what lets `~ALL` cover more than
 * one branch; a scalar mapping made a wildcard ruleset resolve to the literal
 * string `~ALL`, matching no branch and producing a false HIGH.
 *
 * Known gap: fnmatch globs (`dev*`, `release/*`) are NOT expanded, so a ruleset
 * that covers a long-lived branch only via a glob reads as not covering it.
 * That direction is a false HIGH — loud, not silent — so it is left unhandled
 * rather than guessed at; this note exists so the eventual "why is it crying
 * wolf" investigation starts here instead of rediscovering it.
 */
function expandRef(ref: string): string[] {
  if (ref === ALL_BRANCHES_REF) {
    return [...LONG_LIVED_BRANCHES];
  }
  if (ref === DEFAULT_BRANCH_REF) {
    return [DEFAULT_BRANCH];
  }
  return [ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref];
}

/** Every string in an unknown value that is an array of strings; [] otherwise. */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Narrow one ruleset detail payload to the fields this guard reasons about,
 * returning undefined when the ruleset is not an ACTIVE BRANCH ruleset, or when
 * its payload is a well-formed JSON value of the wrong shape — both mean "does
 * not protect anything", so both are skipped.
 *
 * UNPARSEABLE JSON is different and deliberately NOT skipped: `safeParse`
 * throws, the throw escapes the per-id loop in `collectRepoSettings`, and the
 * WHOLE surface degrades to `unavailable`. One bad response therefore blinds
 * the guard to every other ruleset rather than excluding just that entry —
 * chosen on purpose. Refusing to answer on unreadable data is the right posture
 * for a safety check; skipping the bad entry would emit a confident verdict
 * computed from a knowingly-incomplete ruleset set.
 */
export function parseRulesetDetail(raw: string): ActiveBranchRuleset | undefined {
  const detail = asRecord(safeParse(raw, 'ruleset detail'));
  if (detail === undefined) {
    return undefined;
  }
  if (detail.enforcement !== 'active' || detail.target !== 'branch') {
    return undefined;
  }

  // `exclude` is subtracted from `include`, not ignored: a ruleset that
  // includes ~ALL but excludes a branch does NOT protect that branch, and
  // treating it as coverage would under-report — the one direction this guard
  // must never fail in.
  const refName = asRecord(asRecord(detail.conditions)?.ref_name);
  const excluded = new Set(toStringArray(refName?.exclude).flatMap(expandRef));
  const branches = toStringArray(refName?.include)
    .flatMap(expandRef)
    .filter(branch => !excluded.has(branch));

  const rules = Array.isArray(detail.rules) ? detail.rules : [];
  const hasDeletionRule = rules.some(rule => asRecord(rule)?.type === DELETION_RULE);

  // Every bypass actor counts, regardless of its `bypass_mode` (GitHub
  // distinguishes `always` from `pull_request`-scoped). Deliberate and
  // conservative: whether a pull_request-scoped actor covers GitHub's
  // admin-privileged auto-delete path is NOT established — the incident that
  // motivated this guard only ever exhibited `always`. Counting both
  // over-reports at worst (a false CRITICAL, which is loud and cheap to
  // dismiss); ignoring `pull_request` would risk the silent direction, which
  // is the one failure this guard exists to prevent. Narrow it only against
  // evidence of how that mode behaves for a repo-setting-driven delete.
  const bypassActors = detail.bypass_actors;
  const bypassActorCount = Array.isArray(bypassActors) ? bypassActors.length : 0;

  return { branches, hasDeletionRule, bypassActorCount };
}

/* -------------------------------------------------------------------------- */
/* Derivation                                                                  */
/* -------------------------------------------------------------------------- */

/** Reduce the active rulesets into one deletion state per long-lived branch. */
export function deriveBranchStates(rulesets: ActiveBranchRuleset[]): BranchDeletionState[] {
  return LONG_LIVED_BRANCHES.map(branch => {
    const covering = rulesets.filter(r => r.branches.includes(branch));
    const deletionRulesets = covering.filter(r => r.hasDeletionRule);
    return {
      branch,
      hasDeletionRule: deletionRulesets.length > 0,
      // Every deletion-carrying ruleset bypassable = an admin delete passes
      // through all of them. One un-bypassable deletion rule is enough to make
      // deletion structurally impossible, so `every` (not `some`) is correct.
      deletionRuleFullyBypassable:
        deletionRulesets.length > 0 && deletionRulesets.every(r => r.bypassActorCount > 0),
      hasBypassActors: covering.some(r => r.bypassActorCount > 0),
    };
  });
}

/**
 * Word the MEDIUM finding for `main` from what was actually observed.
 *
 * THREE states, not two. `deletionRuleFullyBypassable` is *vacuously* false
 * when no covering ruleset carries a deletion rule at all — so a two-way
 * ternary on it collapses "no deletion rule exists" into "an un-bypassable
 * deletion rule exists" and reports `deletion is still blocked`, a false
 * reassurance printed directly beside the HIGH finding that says the opposite.
 * The un-bypassable claim requires `hasDeletionRule` to be true.
 */
function mainBypassMessage(main: BranchDeletionState): string {
  const closer =
    ' main is meant to carry no bypass actors at all, because any rule added to a ' +
    'bypassable ruleset later inherits them. (develop carries bypass actors ' +
    'deliberately; main must not.)';
  if (!main.hasDeletionRule) {
    return (
      'a ruleset covering main lists bypass actors, and main has NO deletion rule at ' +
      'all (see the HIGH finding) — the bypass-actor status is not a safety net here.' +
      closer
    );
  }
  if (main.deletionRuleFullyBypassable) {
    return (
      "main's own deletion rule is bypassable — an admin-privileged delete passes " +
      'straight through it. main must be absolute.' +
      closer
    );
  }
  return (
    'a ruleset covering main lists bypass actors. At least one deletion rule covering ' +
    'main is un-bypassable, so deletion is still blocked today — but' +
    closer
  );
}

/**
 * Turn the collected state into findings.
 *
 * Deliberate non-finding: bypass actors on `develop` alone. They are required
 * for the release-finalize force-push and the sanctioned direct doc-commit
 * path, so they are reported ONLY as a contributing condition of the CRITICAL
 * combination — never on their own.
 */
export function evaluateRepoSettings(
  deleteBranchOnMerge: boolean,
  branches: BranchDeletionState[]
): RepoSettingsFinding[] {
  const findings: RepoSettingsFinding[] = [];

  const reachable = branches.filter(isDeletionReachable);
  if (deleteBranchOnMerge && reachable.length > 0) {
    findings.push({
      severity: 'CRITICAL',
      message:
        `delete_branch_on_merge is enabled AND deletion is reachable for: ` +
        `${reachable.map(b => b.branch).join(', ')}. GitHub deletes the head branch on ` +
        'EVERY merge regardless of the per-merge --delete-branch flag, and it performs ' +
        'that delete with ADMIN privileges — so it passes straight through any ruleset ' +
        'that lists bypass actors. A release PR merge would delete its head branch. ' +
        'Turn delete_branch_on_merge off, or give each listed branch a deletion rule ' +
        'with no bypass actors.',
    });
  }

  for (const branch of branches) {
    if (!branch.hasDeletionRule) {
      findings.push({
        severity: 'HIGH',
        message:
          `${branch.branch} has no active branch ruleset carrying a deletion rule — ` +
          'nothing structurally prevents the branch from being deleted.',
      });
    }
  }

  const main = branches.find(b => b.branch === 'main');
  if (main?.hasBypassActors === true) {
    // `hasBypassActors` spans EVERY ruleset covering the branch, not only the
    // deletion-carrying ones, so the message must not assert the deletion
    // mechanism unless that specific ruleset is the bypassable one. Claiming a
    // causal link the data doesn't show is exactly the failure this guard was
    // written in response to.
    findings.push({
      severity: 'MEDIUM',
      message: mainBypassMessage(main),
    });
  }

  return findings;
}

/* -------------------------------------------------------------------------- */
/* Collection + report                                                         */
/* -------------------------------------------------------------------------- */

/** Options for {@link collectRepoSettings}. */
export interface CollectRepoSettingsOptions {
  /**
   * Injectable clock, defaulting to `Date.now`. The sweep is synchronous, so a
   * fake clock is the only way to advance time across calls in a test.
   */
  readonly now?: () => number;
}

/**
 * Read the repo setting + every active branch ruleset and evaluate the
 * invariant. Never throws: `gh` is legitimately unavailable (missing binary,
 * no auth, no network, a CI token without the rulesets scope), and a guard
 * must degrade rather than block on a query it cannot run.
 */
export function collectRepoSettings(options: CollectRepoSettingsOptions = {}): RepoSettingsSurface {
  try {
    const now = options.now ?? Date.now;
    // Inside the try so "never throws" holds unconditionally, not merely for
    // well-behaved clocks. Date.now cannot throw; an injected one could.
    const startedAt = now();

    // Remaining budget, clamped to the per-call ceiling. Throws once spent, so
    // expiry lands in the same catch as any gh failure and degrades the surface
    // to "unavailable" with a reason naming the BUDGET — not the last gh error,
    // which would send a reader chasing a network problem that is not there.
    //
    // Math.floor is not cosmetic: execFileSync rejects a FRACTIONAL timeout
    // with ERR_OUT_OF_RANGE (verified by running it, not recalled). Date.now
    // yields integers so production never reaches it, but every clock this
    // function accepts is a chance to, and the tests inject clocks by design.
    const budget = (): number => {
      const left = REPO_SETTINGS_BUDGET_MS - (now() - startedAt);
      if (left <= 0) {
        throw new Error(
          `repo-settings budget of ${REPO_SETTINGS_BUDGET_MS}ms exhausted before the sweep finished`
        );
      }
      // Math.max(1, …) guards a floor to ZERO. `left` can be fractional and
      // strictly between 0 and 1 — the `left <= 0` throw above lets it through
      // — and Node reads `timeout: 0` as NO TIMEOUT, not as expire-now
      // (verified by running it: a `sleep 1` under `timeout: 0` ran to
      // completion). Flooring to 0 would therefore hand the last gh call an
      // UNBOUNDED wait, which is the exact failure this budget exists to
      // prevent, arriving through the fix for it.
      return Math.max(1, Math.floor(Math.min(left, GH_TIMEOUT_MS)));
    };

    const deleteBranchOnMerge = fetchDeleteBranchOnMerge(budget());
    const rulesets: ActiveBranchRuleset[] = [];
    for (const id of parseRulesetIds(fetchRulesetIdsNdjson(budget()))) {
      // The id came from GitHub's own list response and is narrowed to a
      // finite number above; it is passed as an ARRAY argument, never as part
      // of a shell command string.
      const detail = parseRulesetDetail(ghApi(`repos/{owner}/{repo}/rulesets/${id}`, budget()));
      if (detail !== undefined) {
        rulesets.push(detail);
      }
    }
    const branches = deriveBranchStates(rulesets);
    return {
      available: true,
      deleteBranchOnMerge,
      branches,
      findings: evaluateRepoSettings(deleteBranchOnMerge, branches),
    };
  } catch (error) {
    return { available: false, reason: describeGhFailure(error) };
  }
}

const SEVERITY_ICON: Record<FindingSeverity, string> = {
  CRITICAL: '🚨',
  HIGH: '❌',
  MEDIUM: '⚠️',
};

/** Render the human-readable report (degradation-aware). */
export function formatRepoSettingsReport(surface: RepoSettingsSurface): string {
  if (!surface.available) {
    return `⚠️  Repo deletion-safety settings: unavailable (${surface.reason})`;
  }

  const stateLines = surface.branches.map(b => {
    const rule = b.hasDeletionRule
      ? b.deletionRuleFullyBypassable
        ? 'deletion rule present but fully bypassable'
        : 'deletion rule present, not bypassable'
      : 'no deletion rule';
    return `  ${b.branch}: ${rule}${b.hasBypassActors ? ' (ruleset has bypass actors)' : ''}`;
  });

  if (surface.findings.length === 0) {
    return [
      '✓ No deletion-safety findings — every long-lived branch carries an un-bypassable',
      '  deletion rule. (Reports observed CONFIGURATION, not a proven guarantee — see',
      '  the unverified-premise note in check-repo-settings.ts.)',
      `  delete_branch_on_merge: ${String(surface.deleteBranchOnMerge)}`,
      ...stateLines,
    ].join('\n');
  }

  const count = surface.findings.length;
  const lines = [
    `❌ ${count} repo deletion-safety finding${count === 1 ? '' : 's'}:`,
    '',
    ...surface.findings.map(f => `  ${SEVERITY_ICON[f.severity]} ${f.severity}: ${f.message}`),
    '',
    `  delete_branch_on_merge: ${String(surface.deleteBranchOnMerge)}`,
    ...stateLines,
  ];
  return lines.join('\n');
}

interface RepoSettingsCommandOptions {
  json?: boolean;
}

/**
 * `guard:repo-settings` entry point. Hard-fails on findings (guards gate), but
 * fails OPEN when the API is unreadable — never block on a query it cannot run.
 */
export function checkRepoSettings(options: RepoSettingsCommandOptions = {}): void {
  const surface = collectRepoSettings();
  if (options.json === true) {
    console.log(JSON.stringify(surface, null, 2));
  } else {
    console.log(formatRepoSettingsReport(surface));
  }
  if (surface.available && surface.findings.length > 0) {
    process.exitCode = 1;
  }
}
