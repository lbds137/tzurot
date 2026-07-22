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
pnpm ops lines:check                 # always-loaded surfaces (.claude/rules total, CURRENT.md) within line budgets
pnpm ops lines:update-baseline       # make budget growth explicit (same --update contract as cpd/test:audit)
```

The first five run in the CI `lint` job; all guards hard-fail on findings (including `guard:boundaries` — its `--summary` mode is still pending (tracked in `backlog/cold/follow-ups.md`), but hard-fail is independent of `--summary`). `guard:workflow-sync` runs in `pnpm quality`, `.husky/pre-push`, AND the CI `lint` job; it skips itself on main-cut branches (detected by topology — no develop-exclusive history — with `--base main` as the explicit override), because main-cut workflow PRs are the sanctioned path. It covers ONLY the self-validating claude workflow files (`claude-code-review.yml`, `claude.yml`): a develop-first change to those silently disables claude-review on every PR (green ~15s no-op) until the next release, because the review's skip-validation compares the action's OWN workflow file against main — empirically file-scoped (a PR carrying ci.yml drift still received a real review). Other workflow files (e.g. `ci.yml`) execute from the PR branch and may land via develop like any code change. `guard:proposal-links` and `guard:audit-tool-docs` also support `--summary` for the future aggregator. `guard:audit-tool-docs` self-registers and runs the bidirectional check (every registered tool has a WHY.md AND every `*.WHY.md` is either registered or on `UNREGISTERED_WHY_PATHS`).

**Note on `guard:duplicate-exports`, `guard:dockerfile-dist`, and `guard:gate-parity`**: all three are CI gates but intentionally NOT registered as audit-class tools (no WHY.md, no canary, no `--summary` mode). The criteria for "audit-class" require a measurement with a threshold — duplicate-exports and dockerfile-dist are binary "is this in sync?" checks, not measurements. Same framing as `memory:analyze` (one-shot remediation, not periodic audit). See [`docs/reference/audit-enforcement.md`](../../docs/reference/audit-enforcement.md) for the registry criteria.

### Backlog layout lint

```bash
pnpm ops backlog                     # Check HOT/COLD caps + dangling cold/themes/ links
pnpm backlog:lint                    # Same check (root-level shortcut)
```

Verifies the caps (Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10), flags dangling `cold/themes/` links, and surfaces the oldest follow-ups as an aging-escalation nudge (it never auto-deletes — see `06-backlog.md`). **Wired into `pnpm quality` AND the CI lint job** (they are separate lists — CI does not run `quality`; `guard:gate-parity` keeps the two in sync). Like the binary guards above, it's a layout sync-check, not an audit-class tool — no WHY.md / canary / `--summary`.

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

The payoff is a built-in safety net: a `debug` commit is a high-signal "did I remove this?" marker. `git log --grep '^debug[:(]' origin/develop..HEAD` on a branch surfaces any instrumentation still live on it — empty output means the production code is clean. (The `[:(]` anchors to the conventional `debug:` / `debug(scope):` forms so a free-form subject like `debugged the parser` doesn't false-match.)

Do **not** use `debug` for **permanent** observability (structured logs, metrics, traces that stay) — that is a real operational improvement and should be `feat`. The distinction is lifecycle: `debug` is scaffolding you intend to delete; `feat` observability is infrastructure you intend to keep.

Enforced by `commitlint.config.cjs` (`type-enum`) and the `.husky/pre-push` branch-name allowlist (`debug/` branches permitted).

### PR Monitoring (automatic — do not wait to be asked)

**Whenever you create a PR or push commits to an open PR, arm a `Monitor` that waits for CI to finish and then reports on new reviewer comments.** Don't wait for the user to ask whether CI passed or whether a review landed.

**First verify the push actually landed.** Backgrounded pushes reporting "exit 0" AND foreground pushes with `| tail`/`| grep`-filtered output can both hide a failed transfer. Confirm the `-> branch` ref-update line or `git status -sb` in-sync before arming the Monitor — a monitor watching a push that never landed reports a stale CI run as fresh.

The `.claude/hooks/pr-monitor-reminder.sh` PostToolUse hook fires after every `git push` / `gh pr create` and injects a reminder with the pre-built Monitor invocation. If you see that banner, arm the Monitor before doing anything else — the hook is the enforcement mechanism behind this rule. If it ever stops firing (settings.json drift, hook script removed, etc.), fall back to manually arming the monitor yourself.

The monitor command (PR number is `N`):

```
sleep 60; gh pr checks N --watch --interval=30 > /dev/null 2>&1; sleep 5; echo "CI_COMPLETE"; gh pr checks N
```

Note the `;` between each command (not `&&`). `echo "CI_COMPLETE"` and the final `gh pr checks N` run unconditionally — the sentinel fires even if `--watch` exits non-zero (network blip, bad flag). That's intentional: the trailing `gh pr checks N` surfaces the true state regardless, and "watch exited" is always a useful signal. `CI_COMPLETE` means "watch exited," not "all checks passed."

**Exit-code semantics — "Monitor script failed (exit 1)" can be cosmetic.** The trailing `gh pr checks N` exits non-zero whenever ANY check is red. Branches with active `fixup!` commits will have `fixup-check` red intentionally until autosquash, so the Monitor tool will report "script failed" on every fixup-bearing branch even though the script ran perfectly and emitted the event stream. **Read the event stream for the actual outcome; treat the exit code as informational only.** Do not append `; true` to muzzle this — that would also suppress real `gh` CLI failures (network errors, rate limits) which are useful signal.

**Don't reinvent the watch loop, but DO add a startup `sleep` for fresh pushes.** `gh pr checks --watch` snapshots the check list at start time — it does NOT correctly wait for checks that register after polling begins. On a fresh push, slow checks (CodeQL, claude-review) may take 10-30s to register; if `--watch` starts before they appear, it watches only the fast-registering checks (GitGuardian, voice-engine-tests) and exits when those reach terminal states, leaving the slow checks pending. Mitigation: prepend a `sleep 60` before `--watch` so all checks have time to register first. The canonical pattern with the delay is:

```
sleep 60; gh pr checks N --watch --interval=30 > /dev/null 2>&1; sleep 5; echo "CI_COMPLETE"; gh pr checks N
```

The 60s prefix lets check-runs register; the `--watch` then correctly waits for all of them; the trailing 5s lets state propagate before the final-state query. This pattern is required for any monitor armed immediately after a `git push` — including post-autosquash. Custom `until` loops parsing `gh pr checks --json bucket` are still wrong (different race: partial check lists momentarily appearing "all non-pending" before slow checks register), but the bare `--watch` without startup delay is also wrong on fresh pushes. Use the sleep-prefixed canonical pattern.

Pass to `Monitor` with `timeout_ms: 900000` (15 min — GitHub CI + CodeQL usually finishes well inside that; if it exceeds, re-arm).

When the monitor fires, **all four** of the following must happen before the cycle is complete — do not stop after step 1 even if every check passed:

1. Note the final CI state from the `gh pr checks N` output.
2. Fetch new reviewer feedback. GitHub splits it across **three** endpoints that the raw `gh api /issues/N/comments` call does **not** cover together:
   - `pnpm ops gh:pr-comments N` — conversation comments + inline line-level review comments
   - `pnpm ops gh:pr-reviews N` — review summaries (Approve / Request Changes / Comment)
   - `pnpm ops gh:pr-info N` — PR-level state (status, mergeable, etc.)

   Inline line comments are where human reviewers typically leave blocking feedback; if you only check `/issues/N/comments` you'll silently miss them. Track the most recently reported comment's timestamp in working memory so a subsequent push doesn't re-report already-surfaced feedback. **Include human reviewer comments** alongside `claude[bot]` / `github-advanced-security[bot]`.

   **Never pipe review fetches through `| tail` / `| head`** — truncating the fetch is how body findings get silently dropped; pull the full output and read it.

   **claude-review health**: the check turning green means the action _completed_ — it does NOT guarantee a review body was posted. If no new `claude[bot]` comment exists after a green run, re-run the workflow (`gh run rerun <run-id>`) before proceeding (observed twice: a placeholder post and a completed-but-posted-nothing run).

3. In a single concise user-facing message, report: CI pass/fail summary **and** any new review findings (grouped as blocking vs. non-blocking). If there are no new reviews since the last push, say so explicitly — silence isn't a substitute for "no new comments."

   **Read every `###` section of each review body — do not rely on the trailing "Summary" / "Actionable items" section.** Reviewer output is tiered (verdict → strengths → major → minor → observations → summary), and the summary is a shortcut that commonly under-reports items the body flags. When a review is 100+ lines, treat length itself as a skimming red flag. Cross-check correlated signals: if codecov flags missing lines, grep the review body for a corresponding test-gap call-out. If multiple `claude[bot]` entries exist (e.g., one per push cycle), read every one — don't assume only the latest matters.

4. **Apply review feedback per `08-review-response.md`.** That rule distinguishes trivial edit shapes (auto-apply via `--fixup` commit, test-gated) from semantic-shape edits (ASK). Batch-present all auto-applied + asked items in one end-of-round message. Cap automated iteration at 3 rounds; escalate to user on round 4. The prior "report only, never fix" stance produced review-cycle rubber-stamping fatigue on multi-round PRs — see `08-review-response.md` §"Why this rule exists" for the full rationale.

Two failure modes to guard against — both matter:

- **Step 1 without step 2**: all-green CI feels complete, so the comment-fetch step gets skipped. Steps 1 and 2 are both part of the Monitor-fire response contract; all-CI-green does not discharge the comment-fetch obligation.
- **Step 2 without full-body read**: fetching comments but only extracting items from the trailing summary section. A review that ends "Summary: two actionable items" almost always has a body listing more (observed: body-only items, including a codecov-confirmed coverage gap, missed on three consecutive PRs).

If CI fails or CodeQL flags a new alert, surface it via `PushNotification` — that class of feedback changes what the user does next.

**Timeout handling**: if the monitor output doesn't contain `CI_COMPLETE`, the 15-min `timeout_ms` fired before CI finished. Re-arm the monitor rather than assuming CI passed.

**Working-memory caveat**: the `created_at` dedup lives in conversation state, which is lost when the session restarts. After a session restart, re-fetching may surface previously-reported comments once. That's acceptable — re-reporting a known comment once is strictly preferable to silently missing a new one.

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
│   ├── hooks/              # Automation (skill-eval, eslint)
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
