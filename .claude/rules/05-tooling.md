# Tooling Reference

## Essential Commands

```bash
# Development
pnpm dev              # Start all services
pnpm test             # Run unit tests
pnpm test:component   # Run component tests (snapshots, cross-service)
pnpm quality          # the full static gate — composition lives in package.json scripts.quality (guard:gate-parity keeps it in sync with the CI lint job; don't enumerate it here, that's a third list to drift)
pnpm lint             # Lint all packages
pnpm lint:errors      # Show only errors

# Static Analysis
pnpm depcruise        # Check architecture boundaries
pnpm knip             # Find unused code/exports/deps
pnpm knip:dead        # Find dead files (only imported by own tests)

# Focused (changed packages only)
pnpm focus:lint       # Lint changed packages
pnpm focus:test       # Test changed packages
```

## Resource Constraints (CRITICAL)

**NEVER run `pnpm test` and `pnpm quality` in parallel.** The Steam Deck has
limited RAM, and running both simultaneously causes OOM kills that crash the IDE
and Claude Code. Always run them **sequentially**:

```bash
# ✅ CORRECT - Sequential
pnpm test && pnpm quality

# ❌ WRONG - Parallel (crashes Steam Deck)
# Running both as background tasks simultaneously
```

This applies to all heavy commands: `pnpm test`, `pnpm test:component`, `pnpm quality`,
`pnpm typecheck`. Run one at a time, wait for completion, then run the next.

## Ops CLI (`pnpm ops`)

### Database

```bash
pnpm ops db:status --env dev          # Check migration status
pnpm ops db:migrate --env dev         # Apply pending migrations
pnpm ops db:safe-migrate --name <n>   # Create migration with drift sanitization
pnpm ops db:inspect                   # Inspect tables/indexes (local)
pnpm ops db:check-drift               # Check for migration drift
```

**Non-interactive note**: `db:safe-migrate` and `db:migrate` work in non-TTY
environments (AI assistants, CI). `--name` is required for `db:safe-migrate`
when stdin is not a TTY.

### GitHub (Use instead of broken `gh pr edit`)

```bash
pnpm ops gh:pr-info 478              # Get PR title, body, state
pnpm ops gh:pr-reviews 478           # Get all reviews
pnpm ops gh:pr-comments 478          # Get line-level review comments
pnpm ops gh:pr-edit 478 --title "..."  # Edit PR
```

### Deployment

```bash
pnpm ops deploy:setup-vars --env dev --dry-run  # Preview env var setup
pnpm ops run --env dev <command>     # Run any command with Railway creds
pnpm ops maintenance on|off|status --env prod   # Maintenance mode (destructive migrations) — sequence in /tzurot-deployment
```

**Migration-timing reminder:** Migrations are NOT auto-applied on Railway, and timing matters because every service auto-deploys in parallel. For a **prod release**, migrate BEFORE merging the release PR — `pnpm ops release:premigrate` (then merge; auto-deploy lands into the ready schema). For **dev**, apply promptly after the push — `pnpm ops db:migrate --env dev`. See `.claude/rules/03-database.md` § Deployment for the additive-vs-destructive distinction.

### Codebase Analysis (Xray)

```bash
pnpm ops xray                        # Full analysis (terminal)
pnpm ops xray --summary              # File-level overview (no declarations)
pnpm ops xray bot-client             # Single package
pnpm ops xray --format md            # Markdown (for LLM consumption)
pnpm ops xray --format json          # JSON (for tooling)
pnpm ops xray --summary --output f   # Write summary to file
pnpm ops xray --include-private      # Include non-exported declarations
pnpm ops xray --include-tests        # Include test files
pnpm ops xray --imports              # Include import analysis (auto for md/json)
```

**Use `--summary` for architectural overview.** Full mode lists every declaration.

**Decision-point trigger**: xray is not just a periodic-audit tool — it is the required sweep before any negative existence claim ("we don't have X") per `00-critical.md` § Don't Present Speculation as Fact. `pnpm ops xray --format md | grep -iE 'termA|termB|termC'` searches every export in seconds and cannot be stale.

### Mutation-Score Ratchet (Stryker)

```bash
pnpm --filter @tzurot/<pkg> test:mutation   # run Stryker for one tracked package (writes reports/mutation/<pkg>/)
pnpm ops mutation:check --summary           # CI gate: per-package score >= baseline - graceMargin
pnpm ops mutation:gate                      # CI skip gate: run=false when the diff can't move any tracked score (fail-open)
pnpm ops mutation:update-baseline           # sanctioned refresh (needs a fresh LOCAL report for EVERY tracked package)
```

Tracked packages live in `MUTATED_PACKAGES` (`packages/tooling/src/test/mutation-check.ts`). Adding one: copy config-resolver's `stryker.config.mjs` + `logger-calls` ignorer (NOT cache-invalidation's copy — its `observability-options` rule is package-specific), add a `test:mutation` script + the `@stryker-mutator/*` devDeps, add to `MUTATED_PACKAGES` (fingerprint drift forces the baseline refresh), add its CI step before `mutation:check` (the gate + tracked-set intersection picks the new package up automatically). When the check fails on a genuine score drop: close the test gaps it names — never hand-edit the baseline. Services are adjudicated NOT per-PR viable (30-70min projected runs); don't re-attempt without new data. `ignoreStatic` stays OFF (owner decision — module-top-level mutants held the rollout's best real finds).

### Secret Rotation

```bash
pnpm ops secrets:rotation-status --env prod       # ledger + overdue state
pnpm ops secrets:mark-rotated <name> --env prod   # stamp a manual rotation
pnpm ops secrets:rotate-byok --env prod --stage 1 # staged BYOK key rotation (1=stage, 2=reencrypt, 3=finalize)
```

The ledger (`secret_rotations`, per-env, sync-excluded) drives a daily bot-client check that posts an owner-channel nag when a secret passes its interval (BYOK 180d, others 365d). BYOK rotation is breakage-free via the dual-key window in `common-types/utils/encryption.ts` — never rotate `API_KEY_ENCRYPTION_KEY` by hand-replacing the variable; always use the staged command.

### Security Advisories

```bash
pnpm ops security:advisories            # open Dependabot advisories: severity + fix version + direct/transitive
pnpm ops security:advisories --json     # machine-readable surface
pnpm ops security:advisories --strict   # exit nonzero on an actionable (fix-available) high/critical
```

Reads the GitHub Dependabot alerts API and prints each open advisory with its fix version and — the actionable bit — whether it's a **direct** dep (Dependabot auto-PRs the fix) or **transitive-only** (Dependabot _can't_ PR it; needs a manual `pnpm.overrides` bump and otherwise lingers open with no PR). **Decision-point trigger:** the release security-preflight (`/tzurot-git-workflow` § Release) — run it before cutting a release and ride any transitive-with-fix advisory into the release via an override. The same list also appears in `pnpm ops health`. Degrades to "unavailable" (never blocks) when the alerts API can't be read — CI tokens lack the `security-events` scope. Not an audit-class tool (a point-in-time report, no baseline/ratchet — see the exclusion note in `audit-tool-registry.ts`).

### Test Audits

```bash
pnpm ops test:audit                  # Run coverage ratchet (CI)
pnpm ops test:audit --update         # Update baseline + refresh meta block (run after closing coverage gaps)
```

**Drift detection (Layer 3):** `test:audit` hard-fails when the baseline's stored `configHash` doesn't match the current `getTestAuditConfigFingerprint()`. Bump `TEST_AUDIT_IMPL_VERSION` in `packages/tooling/src/test/audit-version.ts` whenever the measurement-affecting logic changes (Prisma-detection heuristic, service-file glob, etc.) — that bump invalidates baselines and forces an explicit `--update` refresh. The `--update` path is the only one that updates the meta block; hand-editing the baseline JSON is not the sanctioned path.

### CPD (Duplication Ratchet)

```bash
pnpm cpd                             # Run jscpd (writes reports/jscpd/jscpd-report.json)
pnpm ops cpd:filtered                # Post-filter + breakdown (excludes call-dominant fragments)
pnpm ops cpd:filtered --show-pairs 25  # Show top 25 remaining file pairs
pnpm ops cpd:check                   # CI ratchet gate (drift-detected)
pnpm ops cpd:update-baseline         # Refresh baseline + meta block
pnpm ops cpd:update-baseline --dry-run  # Preview without writing
```

`cpd:check` hard-fails on either (a) `filteredLines > baseline + graceMargin` or (b) `configHash` drift. Same `--update`-refreshes-meta contract as `test:audit`. Bump `FILTER_IMPL_VERSION` in `packages/tooling/src/cpd/postFilter.ts` when the call-dominance heuristic changes.

### Guards (Structural enforcement)

```bash
pnpm ops guard:boundaries            # Service-boundary imports (bot-client/Prisma, etc.)
pnpm ops guard:duplicate-exports     # Same name exported from multiple files
pnpm ops guard:dockerfile-dist       # Dockerfile runner stages copy every runtime workspace dep's dist
pnpm ops guard:proposal-links        # docs/proposals/backlog/*.md must have inbound link
pnpm ops guard:audit-tool-docs       # Every registered audit tool has a non-stub WHY.md
pnpm ops guard:workflow-sync         # claude workflow files must be byte-identical to origin/main
pnpm ops guard:gate-parity           # pnpm-quality chain and CI lint job must not drift (allowlisted asymmetries excepted)
pnpm ops guard:ops-doc               # every registered ops CLI command has a row in OPS_CLI_REFERENCE.md
pnpm ops guard:hook-probes           # runs every .claude/hooks/*.probe.sh; every hook needs a probe or a written reason
pnpm ops lines:check                 # always-loaded surfaces (.claude/rules total, CURRENT.md) within their LINE and BYTE budgets
pnpm ops lines:update-baseline       # make budget growth explicit (same --update contract as cpd/test:audit); --surface <name> scopes the write
```

`lines:check` gates two dimensions independently, because lines is not what these surfaces cost: density varies several-fold across the corpus, so a line-only ratchet rated `CURRENT.md` comfortable while it carried a fifth of the rules corpus's bytes. `--breakdown` ranks every file worst-first by bytes — that ranking is the trim order, and the economy pass in `/tzurot-doc-audit` is the procedure that consumes it. Reach for `--surface <name>` whenever a refresh is wanted for one surface only — the unscoped write ratchets a trimmed surface DOWN and a grown one UP in the same commit.

The first five run in the CI `lint` job; all guards hard-fail on findings. `guard:workflow-sync` runs in `pnpm quality`, `.husky/pre-push`, AND the CI `lint` job; it skips itself on main-cut branches (detected by topology — no develop-exclusive history — with `--base main` as the explicit override), because main-cut workflow PRs are the sanctioned path. It covers ONLY the self-validating claude workflow files (`claude-code-review.yml`, `claude.yml`): a develop-first change to those silently disables claude-review on every PR (green ~15s no-op) until the next release, because the review's skip-validation compares the action's OWN workflow file against main — empirically file-scoped (a PR carrying ci.yml drift still received a real review). Other workflow files (e.g. `ci.yml`) execute from the PR branch and may land via develop like any code change. `guard:boundaries`, `guard:proposal-links`, and `guard:audit-tool-docs` also support `--summary` for the future aggregator. `guard:audit-tool-docs` self-registers and runs the bidirectional check (every registered tool has a WHY.md AND every `*.WHY.md` is either registered or on `UNREGISTERED_WHY_PATHS`).

`guard:hook-probes` is the only verification the hook scripts have — a bash hook has no unit-test tier, so its colocated `*.probe.sh` exit-code harness is it. **After editing any hook, run its probe**; the gate is the backstop, not the loop. It runs unconditionally (~18s) rather than keying off a hooks-dir diff, and its `HOOK_PROBES` registry in `packages/tooling/src/dev/check-hook-probes-registry.ts` is bidirectional over BOTH `.claude/hooks/*.sh` and the `.husky/` lifecycle scripts: a new hook in either place with no probe must carry a written reason, and an orphan probe fails too. **New local precondition:** because the probes now run on every `pnpm quality`, `develop-code-commit-guard.probe.sh` needs local branches named `develop` and `main` to exist (it puts a worktree on each to test the hook's branch check). A fresh clone has only `main` — `git fetch origin develop:develop` if the probe fails on it. Branches are fabricated automatically only on a real GitHub Actions runner (gated on `GITHUB_ACTIONS` set AND `ACT` unset — `act` sets `CI`, `GITHUB_ACTIONS` and `ACT` alike, so neither of the first two alone excludes a local run), never on a working repo.

**Note on `guard:duplicate-exports`, `guard:dockerfile-dist`, `guard:hook-probes`, and `guard:gate-parity`**: all four are CI gates but intentionally NOT registered as audit-class tools (no WHY.md, no canary, no `--summary` mode). The criteria for "audit-class" require a measurement with a threshold — duplicate-exports and dockerfile-dist are binary "is this in sync?" checks, not measurements. Same framing as `memory:analyze` (one-shot remediation, not periodic audit). See [`docs/reference/audit-enforcement.md`](../../docs/reference/audit-enforcement.md) for the registry criteria.

### Backlog lint + digest

```bash
pnpm ops backlog                     # Gate: now.md caps + queue.md doc references + task-file integrity + open-task triage labels
pnpm backlog:lint                    # Same check (root-level shortcut)
pnpm ops backlog:digest              # Session-start briefing from tracker/: per-area counts, oldest 20, newest 10
pnpm tracker task list --search <t> --plain   # Query the small-item pool (Backlog.md CLI)
```

The lint verifies the caps (Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10), flags `cold/queue.md` doc references (`doc-N`) that don't resolve in `tracker/docs/`, fails on any `tracker/tasks/` file whose frontmatter won't parse (a broken task silently vanishes from every query surface), and enforces triage on every OPEN task — ≥1 `area:*` label, exactly one `size:S|M|L`, exactly one `state:*` (`ready` · `observable` · `dependent` · `owner` · `unreachable`), and a high/medium/low priority, the four axes every selection query filters on. A label carrying a known prefix but an unknown value (`state:blocked`, `size:XL`) is reported as unknown, never as missing — a present-but-invalid label must not read as an absent one. **Wired into `pnpm quality` AND the CI lint job** (they are separate lists — CI does not run `quality`; `guard:gate-parity` keeps the two in sync). Like the binary guards above, it's a layout sync-check, not an audit-class tool — no WHY.md / canary / `--summary`. The digest is informational (never gates) — the aging-escalation surface lives there, read at session start per `06-backlog.md`.

### Audit-tool infrastructure (Layers 1-3)

`pnpm ops`-class commands that meet the audit criteria (measurement + threshold + periodic) are subject to three structural enforcement layers. **Before adding a new audit tool, read [`docs/reference/audit-enforcement.md`](../../docs/reference/audit-enforcement.md)** — it covers the WHY.md convention, the canary-fixture pattern, the JSONL summary line shape, and the baseline-meta drift contract. Skipping these checklist items will fail CI in non-obvious ways.

## Git Workflow

**Procedures**: See `/tzurot-git-workflow` skill for commit, PR, rebase, and release procedures.

### Commit Message Format

```bash
git commit -m "$(cat <<'EOF'
feat(ai-worker): add pgvector memory retrieval

Brief description of what and why.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `debug`
**Scopes:** `ai-worker`, `api-gateway`, `bot-client`, `common-types`, `ci`, `deps`

**Commitlint gotchas** (the hook catches these, but every trip costs a retry): the **full header must be ≤100 chars** (`header-max-length` — the most-tripped rule in practice; count before writing a long subject), the subject must start **lowercase** (`subject-case`), and the scope must be in the configured enum **or omitted entirely** — an unknown scope is rejected, no scope is fine.

The list above is the project's primary set. `commitlint.config.cjs` also accepts the rest of the standard Conventional Commits types — `build`, `ci`, `revert`, `style` — and the `.husky/pre-push` branch-name allowlist permits all of them as branch prefixes too, so a valid commit type is always a valid branch prefix. Reach for the standard ones when they genuinely fit (`build:` for bundler/Docker changes, `revert:` for a clean revert); otherwise the primary set covers most work.

#### The `debug` type

`debug` is for **temporary diagnostic instrumentation** — logging (or similar probes) added to a production code path to confirm a bug's _runtime_ behaviour before fixing it, then removed in a cleanup PR once the bug is understood. It exists because such work fits none of the other types cleanly: it is not `feat` (nothing ships to users), not `fix` (it corrects no behaviour), and not `chore` (it is risky production-path code, not housekeeping). Use it for **both** adding and removing the scaffolding (`debug(bot-client): add forward-shape probes` … `debug(bot-client): remove forward-shape probes`) so an add/remove pair reads cleanly in the log.

The payoff is a built-in safety net: a `debug` commit is a high-signal "did I remove this?" marker. `git log --grep '^debug[:(]' origin/develop..HEAD` on a branch surfaces any instrumentation still live on it — empty output means the production code is clean. (The `[:(]` anchors to the conventional `debug:` / `debug(scope):` forms so a free-form subject like `debugged the parser` doesn't false-match.) The token grep is per-branch hygiene only; the structural catch for FORGOTTEN scaffolding is `pnpm ops dev:stale-debug` (weekly `ops health` roster) — blame-based, so it finds survivors whose lines don't contain any greppable marker word.

Do **not** use `debug` for **permanent** observability (structured logs, metrics, traces that stay) — that is a real operational improvement and should be `feat`. The distinction is lifecycle: `debug` is scaffolding you intend to delete; `feat` observability is infrastructure you intend to keep.

Enforced by `commitlint.config.cjs` (`type-enum`) and the `.husky/pre-push` branch-name allowlist (`debug/` branches permitted).

### PR Monitoring (automatic — do not wait to be asked)

**Whenever you create a PR or push commits to an open PR, arm a `Monitor` that waits for CI to finish and then reports on new reviewer comments.** Don't wait for the user to ask whether CI passed or whether a review landed. There is no hook behind this — `pr-monitor-reminder.sh` fires but its output never reaches the agent, so this text is the mechanism.

**First verify the push actually landed.** Backgrounded pushes reporting "exit 0" and foreground pushes with filtered output can both hide a failed transfer. Confirm the `-> branch` ref-update line or `git status -sb` in-sync — a monitor watching a push that never landed reports a stale CI run as fresh.

**One monitor per PR: `TaskStop` this PR's previous monitor before arming a new one** (scoped per-PR — a release PR alongside a feature PR keeps one each). The reporting half is not SHA-pinned, so a stale watcher reports the PR's current state under an older push's label, which reads identically to a finished run. Keep the id `Monitor` returns and stop it as the first step of the next arm.

**If the id is gone** (compaction, session restart), you cannot look it up — `TaskList` does not enumerate background monitors, so it returns "No tasks found" with one live. Recover from the notification itself: every monitor event carries its own `task-id`, so when one fires for a PR you already reported on at this SHA, `TaskStop` that id instead of re-reporting. That dedupes but does not prove freshness; the SHA-pinned query in step 1 is what does. Preserving live ids across compaction is in `CLAUDE.md` § Compaction Instructions for this reason.

Arm the Monitor with this as its `command`, **substitution included** — copy it verbatim and only replace `N` with the PR number. Never transcribe the SHA by hand; a hand-completed SHA passes any format check and then spins silently:

```bash
pnpm ops gh:ci-gate N --sha $(git rev-parse HEAD)
```

**The substitution resolves when the Monitor executes, not when you pushed — so arm it immediately.** Anything that moves `HEAD` in between makes the gate watch a different SHA in silence, and **a branch hop is the likelier trigger than another commit** (filing a tracker task means a hop to `develop`). A moved `HEAD` still names a real commit, so no local check objects.

**This invocation is duplicated in three places on purpose** — here, the hook heredoc, and `/tzurot-git-workflow` — because a pointer would hide it where it needs reading. `pnpm ops guard:monitor-command` fails CI if the copies diverge, so change all three.

Pass `timeout_ms: 1800000` (30 min) and `persistent: false`. **The `false` is a deliberate departure from the Monitor tool's own guidance — don't "correct" it back**: a forgotten session-length watcher cannot be cleaned up, since `TaskList` cannot see it, so its own timeout is the only thing bounding it. If it expires, re-arm.

The gate waits for the `CI` run to complete and for nothing else on that SHA to be in flight, then hands off to `gh pr checks --watch`. It prints exactly one sentinel (table below) and then the final check list. Its behaviour is covered by `packages/tooling/src/gh/ci-gate.test.ts`; read that rather than restating it here.

**Exit-code semantics — "Monitor script failed (exit 1)" can be cosmetic.** The final `gh pr checks` exits non-zero whenever ANY check is red, and `fixup-check` is intentionally red on a fixup-bearing branch until autosquash. **Read the event stream for the outcome; treat the exit code as informational.**

When the monitor fires, **all four** of the following must happen — do not stop after step 1 even if every check passed:

1. Note the final CI state from `gh pr checks N`, **and run the SHA-pinned run-list query below** — a green check list is not proof CI ran.
2. Fetch new reviewer feedback. GitHub splits it across **three** endpoints that `gh api /issues/N/comments` does not cover together:
   - `pnpm ops gh:pr-comments N` — conversation + inline line-level review comments
   - `pnpm ops gh:pr-reviews N` — review summaries (Approve / Request Changes / Comment)
   - `pnpm ops gh:pr-info N` — PR-level state

   Inline line comments are where human reviewers leave blocking feedback. Track the last reported comment's timestamp so a later push doesn't re-report it, and **include human reviewers** alongside the bots.

   **Never pipe review fetches through `| tail` / `| head`** — truncating the fetch is how body findings get silently dropped.

   **claude-review health**: a green check means the action _completed_, not that a body was posted. If no new `claude[bot]` comment exists after a green run, `gh run rerun <run-id>` before proceeding.

3. In one concise message, report CI pass/fail **and** any new review findings (blocking vs. non-blocking). If there are no new reviews, say so explicitly — silence isn't a substitute for "no new comments."

   **Read every `###` section of each review body — do not rely on the trailing Summary.** Reviewer output is tiered, and the summary routinely under-reports what the body flags; treat a 100+ line review as a skimming risk. If multiple `claude[bot]` entries exist, read every one.

4. **Apply review feedback — INVOKE `/tzurot-review-response` first, before touching anything.** That skill carries the full procedure. Loading it is not optional politeness — applying feedback from memory is how the rubber-stamping this procedure prevents creeps back in.

Two failure modes, both observed:

- **Step 1 without step 2**: all-green CI feels complete, so the comment fetch gets skipped. All-CI-green does not discharge it.
- **Step 2 without a full-body read**: extracting only the summary section. A review ending "two actionable items" usually has more in the body.

If CI fails or CodeQL flags a new alert, surface it via `PushNotification` — that class of feedback changes what the user does next.

**A green `gh pr checks` list is not proof CI ran.** A run that dies before dispatch (`startup_failure`) creates zero jobs and therefore zero check-runs, so it is absent from the check list entirely while the surviving workflows print clean green. Confirm the run list for the head SHA:

```bash
gh api "repos/{owner}/{repo}/actions/runs?head_sha=$(git rev-parse HEAD)" \
  --jq '.workflow_runs[] | "\(.status) \(.conclusion // "-") \(.name)"'
```

`head_sha` filters server-side, so the result is exhaustive with no `--limit` window to outgrow — don't substitute a client-side filter over `gh run list`. **An empty result minutes after a push means "not indexed yet", not "no run dispatched"**: re-query before concluding anything. Anything not `completed success` (or `skipped`) is a finding, and **pin on the SHA, never a timestamp window** — a window silently spans two pushes.

**A red check with zero steps never ran — that's infrastructure, not your diff**, and is rerun-eligible per `00-critical.md`'s failure-shape table. `gh pr checks` renders it identically to a real failure, so read the step count from `actions/runs/<run-id>/jobs` when a job fails without an obvious cause.

**Outcome handling — read WHICH sentinel printed, not just whether one did.** Only the first means CI finished:

| Sentinel                  | Meaning                                                             | Action                               |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------ |
| `CI_COMPLETE`             | CI finished and nothing else was in flight                          | proceed to the review fetch          |
| `CI_GATE_TIMEOUT`         | the gate gave up at 25 min; CI never reached a releasable state     | re-arm; do NOT assume CI passed      |
| `CI_GATE_STARTUP_FAILURE` | a run died before dispatch (zero jobs, invisible in `gh pr checks`) | `gh run rerun <run-id>`, then re-arm |
| _none of them_            | the Monitor's own 30-min `timeout_ms` killed the process            | re-arm                               |

**Working-memory caveat**: the dedup timestamp lives in conversation state, so after a session restart a re-fetch may surface previously-reported comments once. Acceptable — re-reporting a known comment beats silently missing a new one.

### Release Notes Format

Release notes follow the Conventional Changelog format. This enables machine parsing for Discord release notifications.

- **Release title**: `v3.0.0-beta.XX` (version number only, no summary)
- **Body** starts directly with category headings (no version line in body)

```markdown
### Features

- **scope:** description (#PR)

### Bug Fixes

- **scope:** description (#PR)

### Improvements

- **scope:** description (#PR)

**Full Changelog**: https://github.com/lbds137/tzurot/compare/vOLD...vNEW
```

**Rules:**

- Categories use H3: **Features**, **Bug Fixes**, **Improvements**, **Breaking Changes**, **Chores**, **Tests**, **Database Migrations**
- Breaking Changes section always comes first when present
- Only include categories that have entries
- Line items: `- **scope:** description (#123)` — scope maps to commit scope, `#N` auto-links on GitHub (PR numbers optional)
- End with: `**Full Changelog**: https://github.com/lbds137/tzurot/compare/vOLD...vNEW`

## Project Structure

```
tzurot/
├── .claude/
│   ├── rules/              # Always-loaded constraints (THIS DIRECTORY)
│   ├── hooks/              # Automation (skill-eval, merge/commit guards)
│   └── skills/             # Procedural skills
├── services/
│   ├── bot-client/         # Discord interface (NO Prisma)
│   ├── api-gateway/        # HTTP API + BullMQ
│   └── ai-worker/          # AI processing + memory
├── packages/
│   ├── common-types/       # Shared types
│   └── tooling/            # CLI commands (pnpm ops)
└── prisma/                 # Database schema
```

## No Standalone Scripts

**All tooling must live in `packages/tooling/`** as TypeScript, not as standalone
bash/shell scripts. This ensures:

- Consistent patterns (options objects, typed interfaces)
- Unit testability (colocated `.test.ts` files with mocked child_process)
- Discoverability via `pnpm ops --help`

When adding a new dev tool, follow the existing pattern:

1. Implementation in `packages/tooling/src/dev/<name>.ts`
2. Tests in `packages/tooling/src/dev/<name>.test.ts`
3. Command registration in `packages/tooling/src/commands/dev.ts`
4. Shortcut in root `package.json` if frequently used (e.g., `"knip:dead"`)

**Exception:** `scripts/` may contain one-off data migration or codegen scripts
that run once and are deleted. Persistent tooling goes in the tooling package.

## References

- Full tooling guide: `packages/tooling/README.md`
- Ops CLI reference: `docs/reference/tooling/OPS_CLI_REFERENCE.md`
- Static analysis: `docs/reference/STATIC_ANALYSIS.md`
- Railway CLI: `docs/reference/RAILWAY_CLI_REFERENCE.md`
- GitHub CLI: `docs/reference/GITHUB_CLI_REFERENCE.md`
