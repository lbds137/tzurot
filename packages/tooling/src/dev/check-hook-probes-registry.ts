/**
 * The `guard:hook-probes` registry and the vocabulary it matches on.
 *
 * Split from `check-hook-probes.ts` so the DATA (which hooks exist, which have
 * harnesses, and why the rest do not) sits apart from the logic that checks it.
 * The reason it earns its own module is that it grows on a different schedule:
 * every new hook adds a row here and nothing there.
 */

/** Directory holding the Claude Code hook scripts and their harnesses. */
export const HOOKS_DIR = '.claude/hooks';

/** Directory holding husky's git-lifecycle scripts (plus its own `_/` internals). */
export const HUSKY_DIR = '.husky';

/**
 * Per-probe ceiling. The margin over the ~11s the whole current set takes is
 * deliberately wide, because the realistic non-hang cause of a slow probe is a
 * loaded machine rather than the probe itself. What it buys: a probe that
 * blocks on a stale git lock or an accidental network call fails fast and names
 * itself, instead of stalling the job until the step-level timeout with nothing
 * attributable.
 */
export const PROBE_TIMEOUT_MS = 120_000;

export interface HookProbeEntry {
  /** Repo-relative path of the hook script under test. */
  hook: string;
  /** Repo-relative path of its probe harness, or null when there is none. */
  probe: string | null;
  /** Required when `probe` is null: why this hook has no harness yet. */
  unprobedReason?: string;
}

/**
 * The registry. Adding a hook script without adding a row here fails the
 * guard, which is the point — the decision to ship an unprobed hook should be
 * written down, not defaulted into.
 *
 * The `.husky/*` rows are here rather than in a separate guard because they
 * are the same class of artifact: shell that runs on every commit with no test
 * tier behind it. Their probes live in `.claude/hooks/` alongside the rest
 * (husky executes only its exact lifecycle filenames, so a probe dropped into
 * `.husky/` would be inert AND confusing).
 */
export const HOOK_PROBES: HookProbeEntry[] = [
  {
    hook: '.claude/hooks/claim-shape-guard.sh',
    probe: '.claude/hooks/claim-shape-guard.probe.sh',
  },
  {
    hook: '.claude/hooks/cwd-drift-guard.sh',
    probe: '.claude/hooks/cwd-drift-guard.probe.sh',
  },
  {
    hook: '.claude/hooks/develop-code-commit-guard.sh',
    probe: '.claude/hooks/develop-code-commit-guard.probe.sh',
  },
  {
    hook: '.claude/hooks/fixup-rider-check.sh',
    probe: '.claude/hooks/fixup-rider-check.probe.sh',
  },
  {
    hook: '.claude/hooks/git-commit-filter-guard.sh',
    probe: '.claude/hooks/git-commit-filter-guard.probe.sh',
  },
  {
    hook: '.claude/hooks/promise-ledger-check.sh',
    probe: '.claude/hooks/promise-ledger-check.probe.sh',
  },
  {
    hook: '.claude/hooks/pr-merge-review-check.sh',
    probe: null,
    unprobedReason:
      'TASK-302 member. Highest-stakes hook in the set (it blocks `gh pr merge`) ' +
      'and the only verification it has ever had is a hand-built /tmp copy with ' +
      'ACK_FILE redirected. Needs an ACK_FILE env override plus pinned PR-number-' +
      'extraction cases before a harness can be written.',
  },
  {
    hook: '.claude/hooks/pr-monitor-reminder.sh',
    probe: '.claude/hooks/pr-monitor-reminder.probe.sh',
  },
  {
    hook: '.claude/hooks/eslint-on-edit.sh',
    probe: null,
    unprobedReason:
      'Unregistered — retained as a reference file, not wired into .claude/settings.json, ' +
      'so it never executes. A harness would pin behaviour nothing invokes. If it is ever ' +
      're-registered, it needs a probe in the same change.',
  },
  {
    hook: '.claude/hooks/session-start.sh',
    probe: null,
    unprobedReason:
      'Emits static text selected by the `source` field; a regression is visible in ' +
      'context on the next session start rather than silent. Lowest value in the set — ' +
      'probe it only if the branching grows past the current source switch.',
  },
  {
    hook: '.claude/hooks/skill-eval.sh',
    probe: null,
    unprobedReason:
      'Keyword→skill regex table. A miss degrades to a missing suggestion, never to a ' +
      'wrong action, and the table changes far more often than its shape does.',
  },
  {
    // Partial by design, and the probe's own header says so: it pins the
    // temporal-marker block's two regexes and their AND, not the whole hook.
    // Driving the other blocks means running the hook for real, whose first
    // act is lint-staged followed by codegen — minutes per invocation against
    // a gate budgeted in seconds.
    hook: '.husky/pre-commit',
    probe: '.claude/hooks/husky-pre-commit.probe.sh',
  },
  {
    hook: '.husky/commit-msg',
    probe: null,
    unprobedReason:
      'Three steps, each verified elsewhere: the session-URL grep is a one-line literal ' +
      'match, commitlint has its own test suite, and the rider step is covered by ' +
      'fixup-rider-check.probe.sh. Only the `|| exit 1` wiring is unpinned.',
  },
  {
    hook: '.husky/pre-push',
    probe: null,
    unprobedReason:
      'Runs the real gates (build, lint, tests, and a hand-picked subset of the guards) ' +
      'rather than deciding anything itself — a harness would have to re-run the pipeline ' +
      'it wraps. It composes its own check list rather than calling `pnpm quality`, and ' +
      'guard:hook-probes is deliberately NOT in it: this gate belongs to CI and to an ' +
      'explicit `pnpm quality`, as the backstop rather than the loop.',
  },
];

/**
 * Extensions that make a file in `.claude/hooks/` a hook script.
 *
 * Broader than the bash the directory currently holds, because a Claude Code
 * hook is any executable command — a future `.py` or `.mjs` hook must not slip
 * past the registry-parity check just because nobody thought to widen this. The
 * executable BIT would be the more natural discriminator, but husky's scripts
 * are mode 644 (v9 sources them rather than exec'ing them), so it cannot serve
 * as one rule across both directories; extension does.
 *
 * A non-script file (README, .json fixture) is correctly ignored.
 */
export const HOOK_SCRIPT_EXTENSIONS = ['.sh', '.bash', '.js', '.mjs', '.cjs', '.py', '.ts'];

/**
 * Suffixes that look like a hook script but are companion files.
 *
 * Only `.probe.sh` is in use today. The rest cover cases that do not exist yet
 * and would be confusing when they do: the first `.ts` hook will carry a
 * colocated `foo.test.ts` by this repo's own colocation rule, shared types for
 * it would land as a `.d.ts`, a bash hook could grow a `foo.test.sh`, and a
 * `.py` hook a `foo_test.py`. Without these the guard would demand a registry
 * row for a test or declaration file rather than for a hook.
 *
 * Two known limits, both stated rather than engineered around, because each
 * costs more machinery than the case is worth today:
 *
 * 1. Matching is suffix-only — it does NOT check that a base hook exists. A
 *    file named `cleanup.test.sh` with no `cleanup.sh` beside it reads as a
 *    companion and is dropped from discovery entirely, so it would never be
 *    reported as unregistered. Requiring the base to exist would close that,
 *    but it would also flag a standalone `types.d.ts` (declaration files
 *    legitimately have no same-named source) as an unregistered hook — trading
 *    one confusing outcome for another. If a real hook ever needs one of these
 *    names, give it a normal name instead.
 * 2. pytest's OTHER convention, `test_foo.py`, is a PREFIX and cannot be
 *    expressed here. If a Python hook ever lands, either name its test
 *    `foo_test.py` or teach this check about prefixes — don't assume it's
 *    covered.
 */
export const HOOK_COMPANION_SUFFIXES = [
  '.probe.sh',
  '.test.sh',
  '.test.ts',
  '.test.js',
  '.d.ts',
  '_test.py',
];

/**
 * Git's client-side hook names (githooks(5)). Used as the allowlist for
 * `.husky/`, because git invokes hooks by these exact filenames and nothing
 * else: a file there with any other name — a README, a stray editor swap file,
 * husky's own `_/` directory — is by definition not a hook, so matching on the
 * name is exact rather than heuristic. That is what makes the registry-parity
 * check apply to husky in BOTH directions: a newly added `.husky/post-checkout`
 * is reported as unregistered, while a committed README is correctly ignored.
 *
 * Kept exhaustive rather than trimmed to what husky plausibly uses — the rare
 * entries cost one line each, and a missing name fails in the silent direction
 * (a real hook that no row covers).
 */
export const GIT_HOOK_NAMES = [
  'applypatch-msg',
  'commit-msg',
  'fsmonitor-watchman',
  'p4-changelist',
  'p4-post-changelist',
  'p4-pre-submit',
  'p4-prepare-changelist',
  'post-applypatch',
  'post-checkout',
  'post-commit',
  'post-index-change',
  'post-merge',
  'post-rewrite',
  'pre-applypatch',
  'pre-auto-gc',
  'pre-commit',
  'pre-merge-commit',
  'pre-push',
  'pre-rebase',
  'prepare-commit-msg',
  'push-to-checkout',
  'reference-transaction',
  'sendemail-validate',
];
