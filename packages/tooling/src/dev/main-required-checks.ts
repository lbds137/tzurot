/**
 * Second invariant for `guard:repo-settings`: every status check `main`'s
 * ruleset REQUIRES must be a job `main` can actually produce — and produce
 * that EXACT context, matrix legs expanded (`unit-tests (ai-worker)`, not
 * just the bare `unit-tests` job id).
 *
 * `main` has no bypass actor (`.github/rulesets/README.md` § If a release PR cannot merge):
 * a required context with no matching leg on `main` therefore has no path to ever report
 * `pass` on a release PR — a PERMANENT deadlock, not a flaky check, because the only CI
 * a main-cut PR ever runs is `main`'s own `ci.yml`. `origin/main` is read here rather than
 * the working tree or `develop`, whose `ci.yml` may already carry a job (or a leg of one)
 * that has not reached `main` yet. A develop-only context whose exact context has since
 * landed on `main` is a stale ruleset omission — the guard warns rather than fails, because
 * re-adding a context is a deliberate ruleset edit, not something this guard should force.
 */

import { execFileSync } from 'node:child_process';
import { describeGhFailure } from '../audits/health-extras.js';
import { ensureRef } from './git-ensure-ref.js';
import { parseWorkflowContexts, type WorkflowContexts } from './workflow-job-contexts.js';

// describeGhFailure is source-neutral (first non-empty stderr line, else the error message),
// so it describes a git failure as well as a gh one — aliased here for that reading.
const describeGitFailure = describeGhFailure;

/**
 * Where the guard reads main's workflow from — a REF, never the working tree: the guard runs
 * from feature branches and from develop, whose ci.yml may carry jobs main does not have yet.
 */
export const MAIN_CI_WORKFLOW_REF = 'origin/main:.github/workflows/ci.yml';

/**
 * Contexts develop requires that main deliberately must NOT. `fixup-check` is `if:`-gated
 * off for main/develop refs, so on a release PR (head ref develop) it reports `skipping`, not
 * `pass`; requiring it on main — which has no bypass actor — would deadlock every release
 * PR. Rationale and the observation: .github/rulesets/README.md § Required status checks.
 */
export const MAIN_EXEMPT_CONTEXTS: readonly string[] = ['fixup-check'];

/**
 * Job id a required-check context reports under: `unit-tests (ai-worker)` → `unit-tests`;
 * a bare `lint` is its own id. Matrix jobs report as `<job id> (<matrix value>)`, so the id
 * is everything before the first ` (`.
 *
 * Known gap: a non-matrix job whose literal `name:` differs from its job id reports under
 * that display name, while the workflow map is keyed by job id — so ANY such required
 * context yields a spurious missing-job HIGH (parens or not; loud, not silent). No
 * required-check job in ci.yml sets a bare literal name:
 * `git grep -n '^    name:' origin/main -- .github/workflows/ci.yml` shows only the
 * templated `unit-tests` name.
 */
export function contextJobId(context: string): string {
  const openParen = context.indexOf(' (');
  return openParen === -1 ? context : context.slice(0, openParen);
}

/**
 * A local object-store read (no network), bounded so every child process this sweep spawns
 * carries a finite timeout — pinned by `check-repo-settings.test.ts` › "never hands
 * execFileSync a fractional timeout". Also capped by the sweep's remaining budget (Fix 3):
 * the actual per-call timeout is `Math.min(GIT_SHOW_TIMEOUT_MS, budget())`.
 */
export const GIT_SHOW_TIMEOUT_MS = 10_000;

/**
 * Bound for `ensureRef`'s `git fetch` fallback — a network round trip, so a local-probe scale
 * is wrong for it (mirrors the reasoning of check-workflow-sync.ts's WORKFLOW_FETCH_TIMEOUT_MS;
 * not imported from there because that constant is scoped to workflow-sync's own budget-free
 * guard). Also capped by the sweep's remaining budget.
 */
export const GIT_FETCH_TIMEOUT_MS = 30_000;

/**
 * git runner with a per-call timeout; default = execFileSync('git', args, { encoding: 'utf-8',
 * stdio: ['ignore','pipe','pipe'], timeout }).
 */
export type GitRunner = (args: string[], timeoutMs: number) => string;

function defaultGitRunner(args: string[], timeoutMs: number): string {
  return execFileSync('git', args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });
}

/**
 * `ensureRef(…, 'main')` then `git show` MAIN_CI_WORKFLOW_REF, parsed. Throws on any git
 * failure (the caller degrades the surface), including an up-front budget check before any
 * git call. Array args, never a shell string. Each git call's
 * timeout is `Math.min(<call-kind ceiling>, budget())` — the REMAINING sweep budget, not a
 * fresh allowance, so this read cannot outrun `collectRepoSettings`'s aggregate budget.
 */
export function readMainWorkflowContexts(
  budget: () => number,
  runGit: GitRunner = defaultGitRunner
): WorkflowContexts {
  // The per-call clamp below also calls `budget()`, but its first call sits inside
  // `ensureRef`'s bare `catch` — exhaustion there would fall through to the `fetch`
  // fallback and throw again with the same reason, correct only by coincidence.
  // Consulting the budget once up front (below) makes exhaustion throw before any git call.
  budget();
  const git = (args: string[]): string =>
    runGit(
      args,
      Math.min(args[0] === 'fetch' ? GIT_FETCH_TIMEOUT_MS : GIT_SHOW_TIMEOUT_MS, budget())
    );
  ensureRef(git, 'main');
  return parseWorkflowContexts(git(['show', MAIN_CI_WORKFLOW_REF]));
}

/** Structural view of a ruleset this module needs (avoids importing check-repo-settings.ts
 * back). */
export interface RulesetRequiredChecks {
  branches: string[];
  requiredChecks: string[];
}

export interface RequiredChecksInput {
  /** Every context required by rulesets covering `main` (deduped). */
  mainContexts: string[];
  /** Every context required by rulesets covering `develop` (deduped). */
  developContexts: string[];
  /** jobId → contexts that job produces, from origin/main's ci.yml. */
  mainWorkflow: WorkflowContexts;
}

export interface RequiredChecksFinding {
  severity: 'HIGH';
  message: string;
}

export interface RequiredChecksVerdict {
  /** Hard failures (the guard exits 1 on any finding). */
  findings: RequiredChecksFinding[];
  /** Report-only lines: the "re-add at the cut" prompts. Never fail the guard. */
  warnings: string[];
}

/** Everything the required-checks sub-surface could compute, or the reason it could not. */
export type RequiredChecksSurface =
  | { available: true; findings: RequiredChecksFinding[]; warnings: string[] }
  | { available: false; reason: string };

/**
 * Rule (A)/(B): a main-required context must be produced EXACTLY by main's own ci.yml, and no
 * exempt context may be required on main at all. A job present without that exact leg is its
 * own HIGH — a bare context of a matrix job never reports, because the job never produces the
 * bare id itself, only its expanded legs.
 */
function evaluateMainContexts(
  mainContexts: string[],
  mainWorkflow: WorkflowContexts,
  exempt: Set<string>
): RequiredChecksFinding[] {
  const findings: RequiredChecksFinding[] = [];
  for (const ctx of mainContexts) {
    if (exempt.has(ctx)) {
      findings.push({ severity: 'HIGH', message: exemptOnMainMessage(ctx) });
      continue;
    }
    const jobId = contextJobId(ctx);
    const produced = mainWorkflow.get(jobId);
    if (produced === undefined) {
      findings.push({ severity: 'HIGH', message: missingJobMessage(ctx, jobId) });
    } else if (!produced.includes(ctx)) {
      findings.push({ severity: 'HIGH', message: missingLegMessage(ctx, jobId, produced) });
    }
  }
  return findings;
}

/**
 * Rule (C): a develop-only context whose EXACT context has since reached main is a stale
 * omission worth flagging, not a failure — matched against the union of every context main's
 * ci.yml actually produces, never against job id alone (a develop-only leg of a job that
 * already exists on main must stay silent until that specific leg ships).
 */
function evaluateReAddWarnings(
  input: RequiredChecksInput,
  producedContexts: Set<string>,
  exempt: Set<string>
): string[] {
  const mainContexts = new Set(input.mainContexts);
  const warnings: string[] = [];
  for (const ctx of input.developContexts) {
    if (mainContexts.has(ctx) || exempt.has(ctx)) {
      continue;
    }
    if (producedContexts.has(ctx)) {
      warnings.push(reAddMessage(ctx, contextJobId(ctx)));
    }
  }
  return warnings;
}

export function evaluateRequiredChecks(input: RequiredChecksInput): RequiredChecksVerdict {
  const exempt = new Set(MAIN_EXEMPT_CONTEXTS);
  const producedContexts = new Set([...input.mainWorkflow.values()].flat());
  return {
    findings: evaluateMainContexts(input.mainContexts, input.mainWorkflow, exempt),
    warnings: evaluateReAddWarnings(input, producedContexts, exempt),
  };
}

/**
 * Never throws. Runs readMainWorkflowContexts + evaluateRequiredChecks in its OWN try; a git
 * failure (or an exhausted budget — `budget()` throws) degrades ONLY this sub-surface to
 * `{ available: false, reason }` via describeGitFailure, leaving the deletion-safety verdict
 * intact.
 */
export function collectRequiredChecks(
  rulesets: RulesetRequiredChecks[],
  budget: () => number,
  runGit?: GitRunner
): RequiredChecksSurface {
  try {
    const contextsFor = (branch: string): string[] => [
      ...new Set(rulesets.filter(r => r.branches.includes(branch)).flatMap(r => r.requiredChecks)),
    ];
    const mainWorkflow = readMainWorkflowContexts(budget, runGit);
    const verdict = evaluateRequiredChecks({
      mainContexts: contextsFor('main'),
      developContexts: contextsFor('develop'),
      mainWorkflow,
    });
    return { available: true, findings: verdict.findings, warnings: verdict.warnings };
  } catch (error) {
    return { available: false, reason: describeGitFailure(error) };
  }
}

function exemptOnMainMessage(ctx: string): string {
  return (
    `main's ruleset requires \`${ctx}\`, which main must NOT require: the job is ` +
    'if:-gated off for main/develop refs and reports skipping (not pass) on a release ' +
    `PR, so requiring it deadlocks every release PR. Remove \`${ctx}\` from the main ` +
    'ruleset (see .github/rulesets/README.md § Required status checks).'
  );
}

function missingJobMessage(ctx: string, jobId: string): string {
  return (
    `main's ruleset requires status check \`${ctx}\` but ${MAIN_CI_WORKFLOW_REF} has no ` +
    `job \`${jobId}\` — a main-cut PR cannot produce it, and main has no bypass actor, ` +
    `so every release PR is unmergeable until this is fixed. Remove \`${ctx}\` from the ` +
    `main ruleset, or wait until the release that ships job \`${jobId}\` reaches main.`
  );
}

function missingLegMessage(ctx: string, jobId: string, produced: string[]): string {
  const producedList = produced.map(p => `\`${p}\``).join(', ');
  return (
    `main's ruleset requires status check \`${ctx}\` but on ${MAIN_CI_WORKFLOW_REF} job ` +
    `\`${jobId}\` produces only: ${producedList} — a main-cut PR cannot produce that leg, ` +
    'and main has no bypass actor, so every release PR is unmergeable until this is fixed. ' +
    `Remove \`${ctx}\` from the main ruleset, or wait until the release that ships that leg ` +
    'reaches main.'
  );
}

function reAddMessage(ctx: string, jobId: string): string {
  return (
    `develop requires \`${ctx}\` and main does not, and job \`${jobId}\` on ` +
    `${MAIN_CI_WORKFLOW_REF} now produces it — the release that shipped it has reached ` +
    `main, so re-add \`${ctx}\` to the main ruleset and refresh ` +
    '.github/rulesets/branch-protection.json (procedure: .github/rulesets/README.md § ' +
    'Required status checks).'
  );
}
