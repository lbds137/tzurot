# Tooling Reference

## Essential Commands

Beyond `CLAUDE.md` § Commands: `pnpm lint` / `pnpm lint:errors` (errors only),
`pnpm depcruise` (architecture boundaries), `pnpm knip` (unused
code/exports/deps), `pnpm knip:dead` (files only imported by their own tests),
and `pnpm focus:lint` / `pnpm focus:test` (changed packages only).

**Two local gate caches are shaped for correctness, not speed.** `pnpm
depcruise` runs **uncached** by design — its content cache reported stale
results in both directions, so `.dependency-cruiser.cjs` carries no `cache`
block; don't add one back. `turbo run lint` hashes the root `eslint.config.js`
through `$TURBO_ROOT$`, so an ESLint **rule** change invalidates every lint
task; the custom rule sources under `packages/tooling/src/eslint/` reach the
hash via the `@tzurot/tooling#build` dependency and need no entry of their own.

## Resource Constraints (CRITICAL)

**NEVER run heavy commands in parallel** — `pnpm test`, `pnpm test:component`,
`pnpm quality`, `pnpm typecheck`. The Steam Deck OOM-kills the IDE and Claude
Code. Run sequentially: `pnpm test && pnpm quality`.

## Ops CLI (`pnpm ops`)

**Every command, with its flags and examples:
[`OPS_CLI_REFERENCE.md`](../../docs/reference/tooling/OPS_CLI_REFERENCE.md).**
`pnpm ops guard:ops-doc` fails CI when a registered command has no row there,
so the reference cannot lag the CLI. This section keeps only the
decision-point triggers — when to reach for a command, and what never to do
with one.

### Database

`pnpm ops db:safe-migrate` requires `--name` in non-TTY environments (AI
assistants, CI). **Migration timing:** prod — `pnpm ops release:premigrate`
BEFORE merging the release PR; dev — `pnpm ops db:migrate --env dev` promptly
after the push. Details: `03-database.md` § Deployment. Destructive migrations
need maintenance mode (`pnpm ops maintenance on|off|status --env prod`) —
sequence in `/tzurot-deployment`.

### GitHub (Use instead of broken `gh pr edit`)

`gh pr edit` is broken — use `pnpm ops gh:pr-edit`. The three read commands
(`gh:pr-info`, `gh:pr-reviews`, `gh:pr-comments`) are the review-fetch step of
§ PR Monitoring below, and `pnpm ops gh:ci-gate` is its wait step.

### Codebase Analysis (Xray)

**Use `pnpm ops xray --summary` for an architectural overview** — full mode
lists every declaration. `--format md` is the LLM-consumable form;
`--suppressions` audits lint suppressions (`02-code-standards.md`).

### Mutation-Score Ratchet (Stryker)

`pnpm --filter @tzurot/<pkg> test:mutation` runs Stryker for one tracked
package; `pnpm ops mutation:check --summary` is the CI gate;
`pnpm ops mutation:update-baseline` is the only sanctioned refresh and needs a
fresh LOCAL report for EVERY tracked package. Tracked set: `MUTATED_PACKAGES`
(`packages/tooling/src/test/mutation-check.ts`). On a genuine score drop,
close the test gaps — never hand-edit the baseline. `ignoreStatic` stays OFF.
Services are not per-PR viable (30-70min); don't re-attempt without new data.
Adding a package: 4-step checklist in
`packages/tooling/src/test/mutation-check.WHY.md` § Onboarding.

### Secret Rotation

Never rotate `API_KEY_ENCRYPTION_KEY` by hand-replacing the variable — always
the staged command, `pnpm ops secrets:rotate-byok --env prod --stage 1|2|3`
(stage, reencrypt, finalize; dual-key window in
`common-types/utils/encryption.ts`). Intervals: BYOK 180d, others 365d; a
daily bot-client check nags the owner channel when one lapses.

Rotating any other shared service secret is `pnpm ops secrets:rotate-env
--env <env> --name <KEY>`, never the dashboard. For a name whose verifier
dual-accepts `<KEY>_PREVIOUS` (`INTERNAL_SERVICE_SECRET`) `--stage 1|2|3` is
REQUIRED; stage semantics and the single-shot 401 window:
`OPS_CLI_REFERENCE.md` § Secrets Commands.

### Security Advisories

`pnpm ops security:advisories` classifies each open Dependabot advisory from
the resolved lockfile tree: **direct** (Dependabot auto-PRs the fix),
**transitive**, or **direct+transitive** (declarations patched, a vulnerable
copy still resolves) — the last two never get a Dependabot PR and need a manual
`pnpm.overrides` bump. **Decision-point trigger:** the release
security-preflight (`/tzurot-git-workflow` § Release) — ride any transitive or
direct+transitive advisory that has a fix into the release via an override.

### Test Audits

`pnpm ops test:audit` is the coverage ratchet (CI); `--update` is the only
sanctioned baseline refresh (run after closing coverage gaps). Bump
`TEST_AUDIT_IMPL_VERSION` (`packages/tooling/src/test/audit-version.ts`)
whenever measurement-affecting logic changes.

### CPD (Duplication Ratchet)

Bump `FILTER_IMPL_VERSION` (`packages/tooling/src/cpd/postFilter.ts`) when
the call-dominance heuristic changes. Raw vs. filtered, and when a clone trips
the ratchet: `02-code-standards.md` § CPD.

### Guards (Structural enforcement)

All guards hard-fail on findings. `guard:workflow-sync` covers ONLY `claude-code-review.yml` and `claude.yml` — those must land via a **main-cut** branch (a develop-first change silently disables claude-review on every PR until the next release); it self-skips on main-cut branches, `--base main` overrides. Other workflow files (`ci.yml`) may land via develop like any code change.

**After editing any hook, run its probe** — `guard:hook-probes` is the backstop, not the loop. Registry: `packages/tooling/src/dev/check-hook-probes-registry.ts`, bidirectional over `.claude/hooks/*.sh` AND `.husky/`. `develop-code-commit-guard.probe.sh` needs local `develop` and `main` branches (`git fetch origin develop:develop` on a fresh clone). A probe for a self-referential guard keeps its trigger pattern in the probe file as fixture data fed on stdin, never in the invoking command line.

`pnpm ops lines:check` keeps the always-loaded surfaces (`.claude/rules`
total, `CURRENT.md`, `.claude/skills` bodies) within their LINE and BYTE
budgets, and holds `CLAUDE.md` + `.claude/rules/*.md` under a hard 147,000-char
ceiling (Claude Code's instruction-file warning total, which no baseline
refresh can raise); `--breakdown` ranks every file worst-first by bytes — the
trim order the `/tzurot-doc-audit` economy pass consumes. `pnpm ops
lines:update-baseline` makes budget growth explicit; `--surface <name>` scopes
the write — the unscoped write ratchets a trimmed surface DOWN and a grown one
UP in the same commit.

### Backlog lint + digest

`pnpm ops backlog` (also `pnpm backlog:lint`) gates structural checks over
`now.md`, cross-references, and tracker task files; `pnpm ops backlog:digest`
is the session-start briefing and never gates. **The check list is
`backlogLint.ts`'s `problems` array, not any prose enumeration** — read the
array. Its warning naming an uncommitted file under `tracker/` is non-gating.

### Audit-tool infrastructure (Layers 1-3)

**Before adding a new audit tool, read [`docs/reference/audit-enforcement.md`](../../docs/reference/audit-enforcement.md)** — skipping its checklist fails CI in non-obvious ways.

## Git Workflow

**Procedures**: See `/tzurot-git-workflow` skill for commit, PR, rebase, and release procedures.

### Commit Message Format

`type(scope): subject`, a body saying what and why, then the generated-with line and the `Co-Authored-By:` trailer (the heredoc template: `/tzurot-git-workflow` § 2. Create Commit).

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `debug` (+ standard `build`, `ci`, `revert`, `style`; every valid type is also a valid branch prefix)
**Scopes:** every `packages/` + `services/` directory name (generated), plus `tests` and the static root set — `backlog`, `ci`, `deps`, `docs`, `hooks`, `husky`, `legal`, `prisma`, `repo`, `rules`, `skills`. Source of truth is `allScopes` in `commitlint.config.cjs`; read it rather than trusting a list here.

**Commitlint gotchas** (the hook catches these, but every trip costs a retry): the **full header must be ≤100 chars** (`header-max-length` — the most-tripped rule in practice; count before writing a long subject), the subject must start **lowercase** (`subject-case`), and the scope must be in the configured enum **or omitted entirely** — an unknown scope is rejected, no scope is fine.

#### The `debug` type

`debug` = temporary diagnostic instrumentation in a production path, added to
confirm a bug's runtime behaviour and removed in a cleanup PR — use it for BOTH
the add and the remove. Permanent observability is `feat`: the distinction is
lifecycle. `git log --grep '^debug[:(]' origin/develop..HEAD` surfaces
instrumentation still live on a branch (empty = clean); `pnpm ops
dev:stale-debug` (weekly `ops health`) catches older forgotten scaffolding.

When a `fix`/`feat` commit removes a probe instead of a dedicated `debug:`
remove commit, it carries the trailer `Retires-debug: <sha>` (one SHA per line)
so `dev:stale-debug` stops tracking it. Git parses trailers from the FINAL
paragraph only, so the line goes beside `Co-Authored-By`, below the
generated-with line (probe: `git log -1 --format=%B | git interpret-trailers
--parse`).

### PR Monitoring (automatic — do not wait to be asked)

**Whenever you create a PR or push commits to an open PR, arm a `Monitor` that waits for CI to finish and then reports on new reviewer comments.** Don't wait for the user to ask whether CI passed or whether a review landed.

**Verify the push landed first** (the `-> branch` ref-update line, or `git status -sb` in-sync) — a monitor on a push that never landed reports a stale run as fresh.

**One monitor per PR: `TaskStop` this PR's previous monitor before arming a
new one** (a release PR alongside a feature PR keeps one each) — the reporting
half is not SHA-pinned, so a stale watcher reports current state under an older
push's label. **If the id is gone** (compaction): `TaskList` cannot enumerate
monitors, so `TaskStop` the `task-id` carried by the next event that fires for
a PR already reported at this SHA.

Arm the Monitor with this as its `command`, **substitution included** — copy it verbatim and only replace `N` with the PR number; never transcribe the SHA by hand:

```bash
pnpm -C "$(git rev-parse --show-toplevel)" ops gh:ci-gate N --sha $(git rev-parse HEAD)
```

The `-C` root-anchor, and why the substitution is safe to paste: [`pr-monitoring.md`](../../docs/reference/tooling/pr-monitoring.md).

**The substitution resolves when the Monitor executes, not when you pushed — so arm it immediately, from the checkout that holds the branch.** A branch hop in that checkout, or a shell cwd in a different checkout than the worktree holding the branch, resolves a different `HEAD`; the gate refuses a `--sha` that is not the PR head (a re-arm, not a mis-watch), but that head read is fail-open when GitHub cannot be read.

**This invocation is duplicated in three places on purpose** — here, the hook heredoc, and `/tzurot-git-workflow`. `pnpm ops guard:monitor-command` fails CI if the copies diverge, so change all three.

Pass `timeout_ms: 1800000` (30 min) and `persistent: false`. **The `false` is a deliberate departure from the Monitor tool's own guidance — don't "correct" it back**: `TaskList` cannot see a watcher, so its own timeout is the only thing bounding it. If it expires, re-arm.

The gate waits for the `CI` run to complete with nothing else on that SHA in flight, hands off to `gh pr checks --watch`, and prints exactly one sentinel (list below), then the final check list. **"Monitor script failed (exit 1)" can be cosmetic**: the final `gh pr checks` exits non-zero whenever ANY check is red, and `fixup-check` is intentionally red on a fixup-bearing branch until autosquash — read the event stream for the outcome.

When the monitor fires, **all four** of the following must happen — do not stop after step 1 even if every check passed:

1. Note the final CI state from `gh pr checks N`, **and run the SHA-pinned run-list query below**. Numbers and enumerations in the PR body and the commit body are re-derived against the head REF (`git grep <pat> HEAD`, `git show HEAD:<path>`), never the working tree.
2. Fetch new reviewer feedback from all **three** endpoints (`gh api /issues/N/comments` does not cover them together):
   - `pnpm ops gh:pr-comments N` — conversation + inline line-level review comments (where human reviewers leave blocking feedback)
   - `pnpm ops gh:pr-reviews N` — review summaries (Approve / Request Changes / Comment)
   - `pnpm ops gh:pr-info N` — PR-level state

   Track the last reported comment's timestamp so a later push doesn't re-report it, and **include human reviewers** alongside the bots. **claude-review health**: a green check means the action _completed_, not that a body was posted — if no new `claude[bot]` comment exists after a green run, `gh run rerun <run-id>` before proceeding.

3. In one concise message, report CI pass/fail **and** any new review findings (blocking vs. non-blocking); if there are no new reviews, say so. **Read every `###` section of each review body — do not rely on the trailing Summary** — and every `claude[bot]` entry when there are several.

4. **Apply review feedback — INVOKE `/tzurot-review-response` first, before touching anything.**

If CI fails or CodeQL flags a new alert, surface it via `PushNotification`.

**A green `gh pr checks` list is not proof CI ran.** A run that dies before dispatch (`startup_failure`) creates zero check-runs, so it is absent from the list while the surviving workflows print green. Confirm the run list for the head SHA:

```bash
gh api "repos/{owner}/{repo}/actions/runs?head_sha=$(git rev-parse HEAD)" \
  --jq '.workflow_runs[] | "\(.status) \(.conclusion // "-") \(.name)"'
```

Don't substitute a client-side filter over `gh run list` (`head_sha` filters server-side, so the result is exhaustive). **An empty result minutes after a push means "not indexed yet"**: re-query before concluding anything. Anything not `completed success` (or `skipped`) is a finding; **pin on the SHA, never a timestamp window**.

**A red check with zero steps never ran — that's infrastructure, not your diff**, and is rerun-eligible per `00-critical.md`'s failure-shape table. `gh pr checks` renders it like a real failure, so read the step count when a job fails without an obvious cause:

```bash
gh api "repos/{owner}/{repo}/actions/runs/<run-id>/jobs?per_page=100" \
  --jq '.jobs[] | "\(.conclusion // "-") steps=\(.steps | length) \(.name)"'
```

**Wait on the gate, never on a `sleep` or a hand-written poll loop** — both were measured emitting a premature `CI_COMPLETE`.

**Outcome handling — read WHICH sentinel printed, not just whether one did.** Only the first means CI finished:

- `CI_COMPLETE` — CI finished and nothing else was in flight → proceed to the review fetch
- `CI_GATE_TIMEOUT` — the gate gave up at 25 min → re-arm; do NOT assume CI passed
- `CI_GATE_STARTUP_FAILURE` — a run died before dispatch (invisible in `gh pr checks`) → `gh run rerun <run-id>`, then re-arm
- _none of them_ — the Monitor's own 30-min `timeout_ms` killed the process → re-arm

**After the sentinel, the gate counts claude-review cycles on the PR.** From ≥1
cycle it prints `📋 REVIEW ROUNDS ARE DISPATCH WORK` — the trigger for
`/tzurot-review-response` § 3a: batch the round's findings into ONE worker
dispatch. At ≥6 it also prints `⚠️ REVIEW_ROUND_CAP` — the trigger for
§ 5a: stop iterating in this context and hand the open findings to a
fresh-context implementer or the owner. An `unavailable` line means the count
did not run, not that the PR is under the cap.

After a session restart, a re-fetch may re-surface already-reported comments once — expected, not a dedup bug.

**Merge mechanics.** When a merge follows a verification run in the same turn (a re-fetched check list, a review re-read), chain them with `&&` so a failed check halts before the destructive step. When the target branch moved under a long-lived feature branch, re-derive diffstats and counts against the MERGE-BASE, not the target's current HEAD.

### Release Notes Format

Conventional Changelog format. **Release title**: `v3.0.0-beta.XX` (version
number only, no summary). **Body** starts directly with H3 category headings, in
this order when present — **Breaking Changes**, **Features**, **Bug Fixes**,
**Improvements**, **Chores**, **Tests**, **Database Migrations** — omitting empty
ones. Line items are `- **scope:** description (#123)`. End with
`**Full Changelog**: https://github.com/lbds137/tzurot/compare/vOLD...vNEW`.

## No Standalone Scripts

**All tooling lives in `packages/tooling/`** as TypeScript, never as bash
scripts. New dev tool: `src/dev/<name>.ts` + colocated test + registration
in `src/commands/dev.ts` (+ a root `package.json` shortcut if frequent).
**Exception:** `scripts/` may hold one-off migration/codegen scripts that run
once and are deleted.

## References

`packages/tooling/README.md` (full tooling guide), `docs/reference/tooling/OPS_CLI_REFERENCE.md`, `docs/reference/STATIC_ANALYSIS.md`, `docs/reference/RAILWAY_CLI_REFERENCE.md`, `docs/reference/GITHUB_CLI_REFERENCE.md`.
