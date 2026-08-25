# Ops CLI Full Reference

This document provides the complete command reference for `pnpm ops`. For quick patterns and the audit-enforcement contract, see [`docs/reference/audit-enforcement.md`](../audit-enforcement.md) and [`.claude/rules/05-tooling.md`](../../../.claude/rules/05-tooling.md).

## Database Commands

| Command                               | Description                              |
| ------------------------------------- | ---------------------------------------- |
| `pnpm ops db:status --env <env>`      | Show migration status (applied, pending) |
| `pnpm ops db:migrate --env <env>`     | Run pending migrations (interactive)     |
| `pnpm ops db:migrate --dry-run`       | Preview without applying                 |
| `pnpm ops db:deploy --env <env>`      | Deploy migrations (non-interactive, CI)  |
| `pnpm ops db:check-drift --env <env>` | Check schema vs database drift           |
| `pnpm ops db:fix-drift <migrations>`  | Fix migration drift issues               |
| `pnpm ops db:inspect --env <env>`     | Inspect database state                   |
| `pnpm ops db:inspect --table <name>`  | Inspect specific table                   |
| `pnpm ops db:inspect --indexes`       | Show only indexes                        |
| `pnpm ops db:safe-migrate`            | Create migration with validation         |
| `pnpm ops db:check-safety`            | Check for dangerous patterns             |

**Environment options:** `local` (default), `dev`, `prod`

**Common options:**

- `--migrations-path <path>` - Custom migrations directory
- `--force` - Skip confirmation for production
- `--verbose` - Show detailed output

## Run Command

Run any command with Railway DATABASE_URL injected:

```bash
pnpm ops run --env <env> <command> [args...]
```

| Command                                              | Description                           |
| ---------------------------------------------------- | ------------------------------------- |
| `pnpm ops run --env dev tsx scripts/my-script.ts`    | Run script with dev DATABASE_URL      |
| `pnpm ops run --env prod npx prisma studio`          | Open Prisma Studio against prod       |
| `pnpm ops run --env dev --force <cmd>`               | Skip confirmation for prod ops        |
| `pnpm ops run --env prod -- tsx script.ts --dry-run` | Wrapped command carries its own flags |

**Wrapped-command flags need the `--` separator**: cac rejects any bare dash-flag in the command part (`--dry-run`, even `-c`) with an unknown-option error — that error is deliberate (silently stripping a `--dry-run` would run a destructive script for real). Everything after `--` passes through to the wrapped command untouched.

**When to use:** One-off scripts that need database access without adding dedicated ops commands.

## Deploy Commands

Railway deployment helpers (full procedure: `/tzurot-deployment`):

| Command                                          | Description                                         |
| ------------------------------------------------ | --------------------------------------------------- |
| `pnpm ops deploy:verify`                         | Verify the build before deploying                   |
| `pnpm ops deploy:dev`                            | Deploy to the Railway development environment       |
| `pnpm ops deploy:update-gateway`                 | Update the gateway URL in Railway                   |
| `pnpm ops deploy:setup-vars --env dev`           | Set up Railway environment variables from `.env`    |
| `pnpm ops deploy:setup-vars --env dev --dry-run` | Preview the variable set without writing to Railway |

## Dev Workflow Commands

Focused (changed-packages-only) task runs plus the standalone dev audits:

| Command                           | Description                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm ops dev:focus <task>`       | Run a turbo task only on packages with changes                                    |
| `pnpm ops dev:lint`               | Lint only changed packages                                                        |
| `pnpm ops dev:test`               | Test only changed packages                                                        |
| `pnpm ops dev:typecheck`          | Typecheck only changed packages                                                   |
| `pnpm ops dev:test-summary`       | Run tests and print a clean summary                                               |
| `pnpm ops dev:update-deps`        | Update all dependencies to latest versions                                        |
| `pnpm ops dev:dead-files`         | Find production files referenced only by their own tests                          |
| `pnpm ops dev:deferred-refs`      | Surface tracker tasks referencing the given (or staged) files — never fails       |
| `pnpm ops dev:schema-audit`       | Audit Prisma optional columns for fake-optionality                                |
| `pnpm ops dev:stale-debug`        | Audit for `debug`-typed commits whose scaffolding survives at HEAD                |
| `pnpm ops lint:complexity-report` | Report files/functions approaching the ESLint complexity limits                   |
| `pnpm ops commands:audit`         | Slash-command surface inventory + consistency audit (CI runs it with `--summary`) |

## Backlog Commands

| Command                   | Description                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm ops backlog`        | Lint the backlog surfaces: `now.md` caps, `queue.md` doc refs, tracker integrity      |
| `pnpm ops backlog:digest` | Session-start briefing from the tracker store (per-area counts, oldest 20, newest 10) |

`pnpm ops backlog` is wired into `pnpm quality` and the CI lint job (via the `pnpm backlog:lint` shortcut); `backlog:digest` is informational and never gates.

## Memory Commands

Commands for analyzing and managing pgvector memories:

| Command                                                                   | Description                                                                                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm ops memory:analyze --env dev`                                       | Analyze duplicate memories                                                                          |
| `pnpm ops memory:analyze --verbose`                                       | Show detailed breakdown                                                                             |
| `pnpm ops memory:backfill --env dev`                                      | Backfill LTM from `conversation_history` for a date range                                           |
| `pnpm ops memory:repair-fact-timestamps --env dev`                        | Rewrite `memory_facts.valid_from` to the newest source episode time (backward-only, idempotent)     |
| `pnpm ops memory:cleanup --env dev`                                       | Remove duplicate memories                                                                           |
| `pnpm ops memory:cleanup --dry-run`                                       | Preview what would be deleted                                                                       |
| `pnpm ops memory:cleanup --force`                                         | Skip confirmation (required for prod)                                                               |
| `pnpm ops memory:backfill-facts --env dev --dry-run`                      | Report fact-backfill scope (groups/windows)                                                         |
| `pnpm ops memory:backfill-facts --env dev --limit 5`                      | Canary: enqueue the first N extraction windows                                                      |
| `pnpm ops memory:backfill-facts --env dev`                                | Enqueue fact extraction over all uncovered memories                                                 |
| `pnpm ops memory:mine-goldens --env dev --persona-id <uuid>`              | Mine a stratified retrieval-eval sample (LOCAL-ONLY output in gitignored `reports/goldens-mining/`) |
| `pnpm ops memory:mine-conversation-goldens --env dev --persona-id <uuid>` | Mine real user turns + their fold windows (the honest re-baseline input; LOCAL-ONLY)                |
| `pnpm ops memory:mine-attachment-goldens --env dev --persona-id <uuid>`   | Mine attachment-bearing turns, pre-split for the search-query allocation A/B (LOCAL-ONLY)           |
| `pnpm ops memory:anonymize-goldens`                                       | Apply the owner-promoted swap map (`swap-map.json`); refuses on surviving entities                  |

**Use case:** After migrations or data imports, check for and clean up duplicate memory embeddings.

## Retention Commands

Data-minimization tooling for the inactivity retention/purge epic:

| Command                                                       | Description                                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm ops retention:preview --env dev`                        | Report the purge-eligible cohort + character impact (**read-only**)           |
| `pnpm ops retention:backfill-last-active --env dev --dry-run` | Report which users' `last_active_at` would advance                            |
| `pnpm ops retention:backfill-last-active --env dev`           | Seed `last_active_at` from historical activity (forward-only, idempotent)     |
| `pnpm ops retention:backfill-last-active --env prod --force`  | Skip the production confirmation prompt                                       |
| `pnpm ops retention:notify --env prod`                        | DM the deletion warning to reachable-but-inactive users (starts grace clocks) |
| `pnpm ops retention:purge --env prod`                         | **ERASE** the purge-eligible cohort, one account per call                     |
| `pnpm ops retention:reconcile-off-db --env prod`              | Retry avatar cleanup a completed purge still owes (idempotent)                |

**`retention:preview` is safe to run against prod** — it mutates nothing and has
no confirmation prompt. It reads the cohort from the gateway
(`GET /internal/retention/preview`) rather than querying locally, so the report
reflects exactly the eligibility predicate a purge would act on. It needs the
Railway CLI logged in (credentials come from the `api-gateway` service's
variables).

A user is purge-eligible when they are **unreachable** (DMs permanently failed,
or their Discord account is gone) **and** inactive past the retention window.
The bot owner and any `retention_exempt` account — including the Orphaned
Characters sentinel — are always excluded.

## Telemetry Commands

| Command                                | Description                                                          |
| -------------------------------------- | -------------------------------------------------------------------- |
| `pnpm ops telemetry:report --env prod` | Command discoverability report over `command_events` (**read-only**) |

## Context Commands

Quick codebase state for AI session startup:

| Command                              | Description                    |
| ------------------------------------ | ------------------------------ |
| `pnpm ops context`                   | Show full session context      |
| `pnpm ops context --verbose`         | Include detailed file lists    |
| `pnpm ops context --skip-migrations` | Skip migration check (faster)  |
| `pnpm ops session:save`              | Save current state for later   |
| `pnpm ops session:save --notes "x"`  | Save with notes                |
| `pnpm ops session:load`              | Restore previous session state |
| `pnpm ops session:clear`             | Clear saved session            |

**Context output includes:**

- Git branch and recent commits
- CI status (pass/fail/pending)
- Uncommitted changes summary
- CURRENT.md excerpt
- Next BACKLOG.md items
- Pending migrations (optional)

**Session save/load:** Captures state to `.claude-session.json` for continuity across sessions.

**Use case:** Run `pnpm ops context` at start of AI session. Use `session:save` before ending a session.

## Inspect Commands

Runtime state inspection for debugging:

| Command                                    | Description                                        |
| ------------------------------------------ | -------------------------------------------------- |
| `pnpm ops inspect:queue`                   | Show BullMQ queue stats                            |
| `pnpm ops inspect:queue --env prod`        | Inspect production queue                           |
| `pnpm ops inspect:queue --verbose`         | Show job payloads                                  |
| `pnpm ops inspect:queue --failed-limit 10` | Show more failed jobs                              |
| `pnpm ops inspect:dlq`                     | View failed jobs in the BullMQ dead-letter queue   |
| `pnpm ops inspect:redis-key <key>`         | Read one key from an env's Redis (prints the host) |
| `pnpm ops inspect:tts-configs`             | List all `tts_configs` rows for the current env    |

**Output includes:**

- Queue counts (waiting, active, completed, failed)
- Recent failed jobs with error messages
- Active job details (in verbose mode)

**Use case:** Debug BullMQ/async issues, check for stuck or failed jobs.

## Maintenance Mode

Quiesce user-facing traffic for destructive-migration windows (bot-client
replies with a friendly notice, api-gateway 503s below `/health`). The flag
lives in Redis; `on` waits ~5s for service flag-caches to converge, PAUSES both
BullMQ queues (`ai-requests` + `scheduled-jobs` — waiting/delayed jobs and cron
ticks park until `off`), then waits only for ACTIVE jobs to finish. A large
waiting backlog never blocks `on`. Full sequence: `/tzurot-deployment`.

| Command                                       | Description                                         |
| --------------------------------------------- | --------------------------------------------------- |
| `pnpm ops maintenance status --env prod`      | Show flag state + queue depth                       |
| `pnpm ops maintenance on --env prod`          | Enable + converge + drain (`--skip-drain` bypasses) |
| `pnpm ops maintenance off --env prod`         | Disable; traffic resumes within ~5s                 |
| `pnpm ops maintenance on --drain-timeout 300` | Longer drain deadline (seconds; default 120)        |

## Logs Commands

Fetch and analyze Railway service logs:

| Command                                 | Description                                                       |
| --------------------------------------- | ----------------------------------------------------------------- |
| `pnpm ops logs --env dev`               | Fetch logs from all dev services                                  |
| `pnpm ops logs --env prod`              | Fetch logs from production                                        |
| `pnpm ops logs --service api-gateway`   | Logs from specific service                                        |
| `pnpm ops logs --filter "@level:error"` | Server-side Railway query DSL                                     |
| `pnpm ops logs --lines 200`             | Fetch more lines (default: 100; clamped at the CLI's ~5000 cap)   |
| `pnpm ops logs --request-id <uuid>`     | Incident dig: local-match a request ID, sweeping all app services |
| `pnpm ops logs --job-id <id>`           | Incident dig: local-match a BullMQ job ID (ANDs with request-id)  |
| `pnpm ops logs --since 2h`              | Time floor (ISO-8601 or `45m`/`6h`/`2d`); local pino-time filter  |
| `pnpm ops logs --follow`                | Stream logs in real-time (not combinable with dig flags)          |

**Correlation dig flags** (`--request-id`/`--job-id`/`--since`) deliberately match
**locally** over a fetched window instead of using the server `--filter` DSL —
that engine routinely misses hyphenated tokens (UUIDs). With no `--service`,
the dig sweeps bot-client + api-gateway + ai-worker in labeled sections. It
reads the CURRENT deployment; for older windows use
`railway deployment list` + `railway logs <deployment-id>`.

**Output includes:**

- Colorized output (errors=red, warnings=yellow)
- Service and environment context
- Tips for common queries

**Use case:** Debug production issues, trace one request/job across services, monitor logs in real-time.

## Release Commands

Cover the full release lifecycle: bump versions before the release PR, draft and verify release notes, and finalize develop-vs-main alignment after the release merges.

| Command                                                              | Description                                                                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm ops release:bump 3.0.0-beta.49`                                | Bump version in all package.json files (refuses when CURRENT.md still declares the previous release)              |
| `pnpm ops release:bump 3.0.0 --dry-run`                              | Preview bump without writing (the CURRENT.md check still applies)                                                 |
| `pnpm ops release:bump 3.0.0 --allow-stale-current`                  | Bump anyway when CURRENT.md was deliberately not reset                                                            |
| `pnpm ops release:draft-notes`                                       | Draft release-notes skeleton from PRs merged since the previous tag                                               |
| `pnpm ops release:draft-notes --from v3.0.0-beta.103`                | Draft starting from a specific tag (else auto-discovered via `git describe`)                                      |
| `cat /tmp/notes.md \| pnpm ops release:verify-notes`                 | Verify a notes draft references every merged PR in range exactly once (exits 1 on missing/extra/duplicate refs)   |
| `pnpm ops release:range`                                             | List PRs merged since the previous tag, classified runtime vs. non-runtime, plus the range's diff size            |
| `pnpm ops release:range --from v3.0.0-beta.103`                      | Range starting from a specific tag (else auto-discovered via `git describe`)                                      |
| `pnpm ops release:premigrate --dry-run`                              | Preview the prod migrations in the release range without applying                                                 |
| `pnpm ops release:premigrate`                                        | Apply the release range's migrations to prod BEFORE merging the release PR (refuses destructive shapes)           |
| `pnpm ops release:publish 3.0.0-beta.155 --notes-file /tmp/notes.md` | Tag + publish the GitHub Release with correct latest/prerelease flags                                             |
| `pnpm ops release:finalize`                                          | Rebase develop onto main after a release PR merges (step 6 of the git-workflow release flow). Interactive prompt. |
| `pnpm ops release:finalize --yes`                                    | Skip the force-push confirmation prompt (required on non-TTY stdin)                                               |
| `pnpm ops release:finalize --dry-run`                                | Preview the finalize steps without executing                                                                      |

**Use cases:**

- `release:bump` — before cutting the release PR, bump the monorepo version so it ships tagged correctly. It also gates the PREVIOUS release's close-out: CURRENT.md's `> **Version**: vX` header must equal package.json's current version, which is exactly what a skipped CURRENT.md reset looks like. The reset itself stays human judgment; `--allow-stale-current` bypasses the check for a deliberate exception.
- `release:draft-notes` — generate the skeleton for the release PR body; edit as needed before submitting.
- `release:verify-notes` — CI/pre-publish gate: confirms every merged PR in the tag-to-HEAD range appears in the notes exactly once.
- `release:range` — the deterministic answer to "how many PRs since the last release, how many touch runtime, and how big is the diff?" Reuses `release:draft-notes`'s enumeration, so it can never disagree with it; use this instead of a hand-rolled `gh pr list` query. Prints two independent cut triggers: the runtime-PR count (prod risk, ~10) and the range's changed-file count against GitHub's 300-file diff-rendering ceiling (review capacity, advisory at 250) — a mostly-non-runtime range can trip the second without moving the first. When the file count can't be measured it warns on stderr rather than omitting the line silently.
- `release:premigrate` — run BEFORE merging the release PR so auto-deploy lands into a ready schema; destructive shapes need `--allow-destructive` inside a maintenance window, and a migration marked `-- tzurot:apply-after-deploy` needs `--allow-marked` (or, better, merge first and `db:migrate` after) (see `.claude/rules/03-database.md` § Deployment).
- `release:publish` — after the release merge, tag and publish the GitHub Release from the verified notes file.
- `release:finalize` — run after the release PR merges to main. Keeps develop's SHAs aligned with main's so the next release PR doesn't show phantom "conflicts with main."

## GitHub Commands

**🚨 Use these instead of `gh pr edit` (which is broken):**

| Command                                    | Description                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `pnpm ops gh:pr-info <n>`                  | Get PR title, body, state                                                               |
| `pnpm ops gh:pr-reviews <n>`               | Get all reviews on a PR                                                                 |
| `pnpm ops gh:pr-comments <n>`              | Get line-level review comments                                                          |
| `pnpm ops gh:pr-conversation <n>`          | Get conversation comments                                                               |
| `pnpm ops gh:pr-edit <n> --title "..."`    | Edit PR title                                                                           |
| `pnpm ops gh:pr-edit <n> --body "..."`     | Edit PR body                                                                            |
| `pnpm ops gh:pr-edit <n> --body-file f.md` | Edit PR body from file                                                                  |
| `pnpm ops gh:pr-all <n>`                   | Get all PR info at once                                                                 |
| `pnpm ops gh:ci-gate <n> --sha <sha>`      | Wait for CI, then report checks (arm in a Monitor; see `05-tooling.md` § PR Monitoring) |

These use `gh api` directly, bypassing the broken GraphQL calls.

## Xray Commands

Analyze TypeScript codebase structure via AST parsing. Extracts classes, functions, interfaces, types, imports, and lint suppressions.

| Command                                 | Description                                                             |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm ops xray`                         | Full analysis (terminal format)                                         |
| `pnpm ops xray --summary`               | File-level overview (no per-declaration list)                           |
| `pnpm ops xray bot-client`              | Analyze a single package                                                |
| `pnpm ops xray bot-client ai-worker`    | Analyze multiple packages                                               |
| `pnpm ops xray --format md`             | Markdown output (GFM tables, for LLMs)                                  |
| `pnpm ops xray --format json`           | JSON output (for tooling)                                               |
| `pnpm ops xray --summary --output f.md` | Write summary to file                                                   |
| `pnpm ops xray --include-private`       | Include non-exported declarations                                       |
| `pnpm ops xray --include-tests`         | Include test files                                                      |
| `pnpm ops xray --imports`               | Include import analysis (auto for md/json)                              |
| `pnpm ops xray --suppressions`          | Lint-suppression audit report (by rule + justification)                 |
| `pnpm ops xray --suppressions --check`  | CI gate: exit 1 on any unjustified suppression (runs in `pnpm quality`) |

**Options:**

- `--format <fmt>` - Output format: `terminal` (default), `md`, `json`
- `--summary` - File-level overview without individual declarations (64% smaller output)
- `--include-private` - Include non-exported declarations (default: exported only)
- `--include-tests` - Include `*.test.ts` and `*.spec.ts` files
- `--imports` - Include import analysis (defaults to on for md/json, off for terminal)
- `--output <file>` - Write to file instead of stdout

**Health warnings:** Xray flags packages that exceed thresholds (>3000 lines, >40 files, >50 exports, >400-line files, >8 avg decl/file, >20 lint suppressions).

**Suppression tracking:** Counts `eslint-disable`, `eslint-disable-next-line`, `@ts-expect-error`, and `@ts-nocheck` comments as tech debt signals. Extracts rule names and justifications where present.

**Generated code:** `generated/` directories are automatically excluded from analysis.

**Use case:** Architectural overview, tech debt assessment, LLM context for refactoring.

## Test Audit Commands

Ratchet audits to enforce test coverage (CI runs these automatically):

| Command                                  | Description                                                 |
| ---------------------------------------- | ----------------------------------------------------------- |
| `pnpm ops test:audit`                    | Run both contract and service audits                        |
| `pnpm ops test:audit-contracts`          | Audit API schema contract test coverage                     |
| `pnpm ops test:audit-services`           | Audit service component test coverage                       |
| `pnpm ops test:audit --strict`           | Fail on ANY gap (not just new ones)                         |
| `pnpm ops test:audit-contracts --update` | Update baseline after adding contract tests                 |
| `pnpm ops test:audit-services --update`  | Update baseline after adding component tests                |
| `pnpm ops test:tiers`                    | Report the per-package test-tier distribution (report-only) |
| `pnpm ops test:generate-schema`          | Regenerate the PGLite schema SQL from Prisma                |

**How ratchets work:**

- Baselines track known gaps (`.github/baselines/*.json`)
- CI passes if no NEW gaps are introduced
- Use `--update` to accept current state after closing gaps
- Use `--strict` to see ALL gaps (existing + new)

**Drift detection (Layer 3):** `test:audit` hard-fails when the baseline's stored `configHash` doesn't match the current measurement-affecting config. Bumping `TEST_AUDIT_IMPL_VERSION` (in `packages/tooling/src/test/audit-version.ts`) invalidates baselines and forces an explicit `--update` refresh. The `--update` path is the only sanctioned way to refresh the meta block; hand-editing the baseline JSON skips meta updates and produces subtle staleness.

See `tzurot-testing` skill for chip-away workflow details and [`docs/reference/audit-enforcement.md`](../audit-enforcement.md) for the audit-tool infrastructure.

## Mutation-Score Commands

Stryker ratchet over the tracked packages (`MUTATED_PACKAGES` in `packages/tooling/src/test/mutation-check.ts`):

| Command                             | Description                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm ops mutation:check`           | CI gate: per-package score must stay ≥ baseline − `graceMargin`                       |
| `pnpm ops mutation:check --summary` | Emit the JSONL audit-summary line                                                     |
| `pnpm ops mutation:gate`            | CI skip gate: `run=false` when the diff can't move any tracked score (fail-open)      |
| `pnpm ops mutation:update-baseline` | Write current scores to the baseline (needs a fresh LOCAL report per tracked package) |

Reports come from `pnpm --filter @tzurot/<pkg> test:mutation`. When `mutation:check` fails on a genuine drop, close the test gaps it names — never hand-edit the baseline.

## Secrets Commands

Rotation ledger (`secret_rotations`, per-env, sync-excluded) driving the daily owner-channel nag:

| Command                                             | Description                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm ops secrets:rotation-status --env prod`       | Show the ledger with overdue state                                |
| `pnpm ops secrets:mark-rotated <name> --env prod`   | Stamp the ledger: `<name>` was rotated now (manual rotations)     |
| `pnpm ops secrets:rotate-byok --env prod --stage 1` | Staged BYOK key rotation (1=stage, 2=re-encrypt rows, 3=finalize) |

BYOK rotation is breakage-free via the dual-key window in `common-types/utils/encryption.ts` — never rotate `API_KEY_ENCRYPTION_KEY` by hand-replacing the variable.

## Security Commands

| Command                                 | Description                                                            |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm ops security:advisories`          | Open Dependabot advisories: severity + fix version + direct/transitive |
| `pnpm ops security:advisories --json`   | Machine-readable surface                                               |
| `pnpm ops security:advisories --strict` | Exit non-zero on an actionable (fix-available) high/critical           |

Run it in the release security-preflight: transitive-only advisories get no Dependabot PR and need a manual `pnpm.overrides` bump. Degrades to "unavailable" (never blocks) when the alerts API can't be read.

## Codegen Commands

| Command                                  | Description                                                    |
| ---------------------------------------- | -------------------------------------------------------------- |
| `pnpm ops codegen:routes`                | Generate the route-manifest-derived client classes             |
| `pnpm ops codegen:routes --check`        | CI drift gate: fail if the committed generated files are stale |
| `pnpm ops codegen:command-types`         | Generate the type-safe slash-command option schemas            |
| `pnpm ops codegen:command-types --check` | CI drift gate for the generated command-option schemas         |

## Topology Commands

| Command                              | Description                                                      |
| ------------------------------------ | ---------------------------------------------------------------- |
| `pnpm ops topology:generate`         | Print the cross-service coverage topology                        |
| `pnpm ops topology:generate --write` | Write `coverage-topology.json`                                   |
| `pnpm ops topology:check`            | CI gate: fail if the committed `coverage-topology.json` is stale |

## CPD Commands

Filtered copy-paste detection ratchet — same structural shape as test:audit:

| Command                                  | Description                                          |
| ---------------------------------------- | ---------------------------------------------------- |
| `pnpm cpd`                               | Run jscpd (writes `reports/jscpd/jscpd-report.json`) |
| `pnpm ops cpd:filtered`                  | Post-filter + breakdown (excludes call-dominant)     |
| `pnpm ops cpd:filtered --show-pairs 25`  | Show top 25 remaining file pairs                     |
| `pnpm ops cpd:check`                     | CI ratchet gate (drift-detected)                     |
| `pnpm ops cpd:update-baseline`           | Refresh baseline + meta block                        |
| `pnpm ops cpd:update-baseline --dry-run` | Preview without writing                              |

`cpd:check` fails on either `filteredLines > baseline + graceMargin` OR `configHash` drift. The post-filter excludes fragments where ≥80% of classifiable lines are call-expression shape — see [`docs/reference/CPD_CAMPAIGN_AUDIT.md`](../CPD_CAMPAIGN_AUDIT.md) for the rationale. Bump `FILTER_IMPL_VERSION` (in `packages/tooling/src/cpd/postFilter.ts`) when the heuristic changes.

## Cache Commands

Two unrelated caches share the `cache:` namespace: `cache:inspect` / `cache:clear` act on the **local Turborepo build cache** (`.turbo/`, dev-machine only), while `cache:clear-credit-exhaustion` / `cache:prefix-diff` act on **runtime state in a target environment** (Redis and the diagnostic store) and therefore take `--env`.

| Command                                                                   | Description                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm ops cache:inspect`                                                  | Report local Turborepo cache size, file count, and oldest/newest entry                                 |
| `pnpm ops cache:clear`                                                    | Delete the local Turborepo cache to force fresh builds (`--dry-run` previews)                          |
| `pnpm ops cache:clear-credit-exhaustion --env prod --user-id <discordId>` | Delete one BYOK user's OpenRouter credit-exhaustion Redis entry (operator escape valve after a top-up) |
| `pnpm ops cache:clear-credit-exhaustion --env dev --system`               | Same, for the system-bucket entry (guest mode / system-key fallback)                                   |
| `pnpm ops cache:prefix-diff --env dev --channel <snowflake>`              | Diff consecutive requests' system prompts for a channel to diagnose provider prompt-cache misses       |
| `... --personality <uuid>`                                                | Restrict the diff to one personality                                                                   |
| `... --limit <pairs>`                                                     | Row budget as pairs (per-stream pairing may yield fewer) — default 5, **max 100**                      |

**`cache:clear-credit-exhaustion`** requires exactly one of `--user-id` or `--system`; supplying both or neither is rejected. Keys mirror `CreditExhaustionCache` in ai-worker (`nocredits:openrouter:user:<discordId>` / `nocredits:openrouter:system`).

**`cache:prefix-diff`** requires `--channel` (read verbatim from argv — a Discord snowflake exceeds `MAX_SAFE_INTEGER` and would be corrupted by cac's number coercion). It fetches the channel's diagnostic rows in a subprocess against the target env, groups them into per-personality streams, finds the first byte divergence between each consecutive pair of system prompts **within a stream**, and names the prompt section the divergence landed in. Pairing is per stream because provider prompt caches key per model+stream: in a channel carrying two personalities the rows interleave, and a cross-personality pair is not a cache-miss event at all. Diagnostic rows live 24h, so it diagnoses live cache behavior, not history. The `--limit` cap exists because the subprocess returns `limit + 1` full prompt payloads over a 128MB `maxBuffer`; an uncapped limit against prod overflows it and the run dies mid-transfer. `--show-divergence [chars]` additionally prints the shared tail plus each side's differing text at the divergence, because the section name alone cannot distinguish a roster member arriving from one leaving from a bio edit from a reordering from a field flickering on an entry that did not otherwise move — each a different fix. The window is verbatim prompt text and may contain a participant's persona bio, so it stays off by default and its output belongs in the terminal, not in a commit message or task file.

## Guard Commands

Structural enforcement checks that hard-fail CI on findings:

| Command                                      | Description                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm ops guard:boundaries`                  | Service-boundary imports (bot-client never imports Prisma directly, etc.) (audit-class, `--summary` not yet wired)                                                                                                                                                                                                                                |
| `pnpm ops guard:duplicate-exports`           | Same name exported from multiple files within a package (CI gate, intentionally not audit-class — no `--summary`)                                                                                                                                                                                                                                 |
| `pnpm ops guard:no-export-star`              | Fail if any production `src/**` uses `export *` (re-masks knip's dead-export tracing) (CI gate, not audit-class)                                                                                                                                                                                                                                  |
| `pnpm ops guard:build-scripts`               | Fail if a `tsc`-invoking `build` script doesn't clear `dist` + `tsconfig.tsbuildinfo` first (turbo cache poisoning across a branch switch) (CI gate, not audit-class)                                                                                                                                                                             |
| `pnpm ops guard:prompt-tags`                 | Fail if a structural prompt tag is emitted but not classified (protected vs known-unprotected) (CI gate, not audit-class)                                                                                                                                                                                                                         |
| `pnpm ops guard:commands-doc`                | Fail when `docs/commands.md` drifts from the bot-client command modules (that table renders live on the website)                                                                                                                                                                                                                                  |
| `pnpm ops guard:ops-doc`                     | Fail when a registered `pnpm ops` command has no row in this file (CI gate, not audit-class)                                                                                                                                                                                                                                                      |
| `pnpm ops guard:repo-settings`               | Fail when deletion of a long-lived branch (`main`, `develop`) is reachable via GitHub settings (release preflight + `ops health`; NOT a CI gate — CI tokens can't read rulesets, so it would degrade to a no-op there)                                                                                                                            |
| `pnpm ops guard:repo-settings --json`        | Emit the raw deletion-safety surface as JSON                                                                                                                                                                                                                                                                                                      |
| `pnpm ops guard:monitor-command`             | Fail when the CI-monitor command drifts between the hook, `05-tooling.md`, and the git-workflow skill (CI gate)                                                                                                                                                                                                                                   |
| `pnpm ops guard:commit-scope-sync`           | Fail when the commit-scope prose in `05-tooling.md` or the git-workflow skill drifts from `allScopes` in `commitlint.config.cjs` (CI gate, not audit-class)                                                                                                                                                                                       |
| `pnpm ops guard:hook-probes`                 | Run every `.claude/hooks/*.probe.sh`, and fail when a hook script has neither a probe nor a written reason (CI gate)                                                                                                                                                                                                                              |
| `pnpm ops guard:dockerfile-dist`             | Service Dockerfile runner stages copy every runtime workspace dep's dist (CI gate, not audit-class)                                                                                                                                                                                                                                               |
| `pnpm ops guard:claude-content-refs`         | Skill/rule `pnpm ops` references resolve to registered commands; warns on stale `lastUpdated` (audit-class, `--summary`)                                                                                                                                                                                                                          |
| `pnpm ops guard:test-taxonomy`               | The test-tier taxonomy is single-sourced in `TESTING.md` and linked from the rule + skill                                                                                                                                                                                                                                                         |
| `pnpm ops guard:workflow-sync`               | Fail when the claude workflow files differ from origin/main (a develop-first change silently disables claude-review)                                                                                                                                                                                                                              |
| `pnpm ops guard:proposal-links`              | Every `docs/proposals/backlog/*.md` has an inbound link                                                                                                                                                                                                                                                                                           |
| `pnpm ops guard:proposal-links --summary`    | Emit JSONL summary line (for aggregator)                                                                                                                                                                                                                                                                                                          |
| `pnpm ops guard:audit-tool-docs`             | Every registered audit tool has a non-stub WHY.md (bidirectional check)                                                                                                                                                                                                                                                                           |
| `pnpm ops guard:audit-tool-docs --summary`   | Emit JSONL summary line                                                                                                                                                                                                                                                                                                                           |
| `pnpm ops guard:gate-parity`                 | `pnpm quality` chain and CI lint job must not drift (justified `CI_ONLY`/`LOCAL_ONLY` allowlists; stale entries flagged)                                                                                                                                                                                                                          |
| `pnpm ops lines:check`                       | Always-loaded surfaces (`.claude/rules/*.md` total, `CURRENT.md`) within their LINE and BYTE budgets (audit-class, `--summary` wired; `--breakdown` ranks every file worst-first by bytes — the trim order)                                                                                                                                       |
| `pnpm ops lines:update-baseline`             | Make budget growth explicit on both dimensions (`--dry-run` supported; `--surface <name>` refreshes one surface only; same meta contract as `cpd:update-baseline`)                                                                                                                                                                                |
| `pnpm ops health`                            | Layer-5 aggregator: run every summary-capable audit tool and print one consolidated report                                                                                                                                                                                                                                                        |
| `pnpm ops health:post-webhook --file <path>` | Chunk a health report (default `health-report.txt`) under Discord's 2000-char cap and POST each chunk sequentially to `DISCORD_AUDIT_WEBHOOK_URL`; unset URL / missing (ENOENT) or empty file are exit-0 no-ops, while any other read error or delivery failure exits 1 (a mid-sequence failure posts a best-effort incompleteness trailer first) |

`guard:ops-doc` keeps THIS file honest: the command set it checks comes from a scan of the registrar sources in `packages/tooling/src/commands/`, and a command passes on a loose match (`pnpm ops <name>` anywhere in the file, or a backtick span holding exactly the name). Per-option coverage is out of scope. Deliberately-undocumented commands go on the justified `UNDOCUMENTED_ALLOWLIST` in `check-ops-doc.ts`.

`guard:proposal-links` also hard-fails on single-segment proposal basenames (`memory.md`, `api.md`) because they defeat the word-boundary regex's precision. Multi-segment kebab-case or SCREAMING_SNAKE_CASE only.

`guard:repo-settings` encodes one invariant: deletion of a long-lived branch must be UNREACHABLE. `delete_branch_on_merge` deletes the head branch on EVERY merge (the per-merge `--delete-branch` flag is irrelevant), and GitHub performs that delete with admin privileges — so it passes straight through a ruleset that lists `bypass_actors`. CRITICAL fires only on the combination (auto-delete on AND some long-lived branch deletion-reachable); a missing `deletion` rule is HIGH on its own; bypass actors on `main` are MEDIUM. Bypass actors on `develop` are **deliberate** (needed for `release:finalize`'s force-push and the sanctioned direct doc-commit path) and are never a finding on their own. Network-dependent: it degrades to an "unavailable" line and exits 0 when `gh` can't answer.

`guard:audit-tool-docs` is self-registered — its own WHY.md is subject to its own check. The bidirectional sweep also detects orphan WHY.md files (files in the tooling tree with no registry entry). See [`docs/reference/audit-enforcement.md`](../audit-enforcement.md) for the full pattern.

## Voice Commands

| Command                                | Description                                                    |
| -------------------------------------- | -------------------------------------------------------------- |
| `pnpm ops voice-refs:audit`            | Probe Personality voice references against the Mistral 30s cap |
| `pnpm ops voice-refs:audit --env dev`  | Same, against Railway dev database                             |
| `pnpm ops voice-refs:audit --env prod` | Same, against Railway prod database (interactive confirmation) |
| `pnpm ops voice-refs:audit --json`     | JSON output for scripting / piping                             |

**Why this exists:** Mistral Voxtral TTS rejects reference audio >30s with a 400 error. The `TtsDispatcher` silently falls through to self-hosted voice-engine, so operators never see the downgrade unless they grep ai-worker logs. This audit surfaces all references in one report sorted by duration, color-coded by severity (red = over cap, yellow = within 0.5s of cap, green = comfortable margin).

**Requirements:** `ffprobe` (part of `ffmpeg`) must be installed on the host running the command. If missing, every probe will return errored with "ffprobe spawn failed".

## Prompt Commands

| Command                                                           | Description                                                                                           |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm ops prompt:mine-voice-probes --env dev --owner <discordId>` | Mine OWNER-ONLY conversation probes for the voice-consistency harness (LOCAL-ONLY, gitignored output) |
| `... --personalities lilith,the-fluffle`                          | Override the activity auto-pick with explicit personality slugs                                       |
| `... --depths 5,10,15,20,25,30 --cutoff <iso>`                    | Probe depths in prior turns · anchor cutoff (default: the beta.190 deploy instant)                    |

**Why this exists:** the caching epic's Phase-1→2 exit gate replays real conversations through competing prompt-assembly arms (old vs restructured) and compares persona voice. This miner produces the probe corpus: per personality, one anchor (a real assistant reply) per conversation-depth stratum, with the triggering user turn + the prior window + the real logged reply (`referenceReply`, the harness's validity anchor). **Privacy scope:** `--owner` is required; only that operator's conversations are mined, and any probe whose window contains another user's turn is dropped.

## Package.json Shortcuts

Root `package.json` provides shortcuts for common ops CLI commands:

| Script                        | Maps To                          | Description                |
| ----------------------------- | -------------------------------- | -------------------------- |
| `pnpm focus:lint`             | `pnpm ops dev:lint`              | Lint changed packages      |
| `pnpm focus:test`             | `pnpm ops dev:test`              | Test changed packages      |
| `pnpm focus:build`            | `pnpm ops dev:focus build`       | Build changed packages     |
| `pnpm test:summary`           | `pnpm ops dev:test-summary`      | Summarize test results     |
| `pnpm audit:*`                | `pnpm ops test:audit-*`          | Coverage ratchet audits    |
| `pnpm with-env`               | `pnpm ops run --env`             | Run with Railway env       |
| `pnpm bump-version`           | `pnpm ops release:bump`          | Bump monorepo version      |
| `pnpm focus:typecheck`        | `pnpm ops dev:typecheck`         | Typecheck changed packages |
| `pnpm generate:pglite`        | `pnpm ops test:generate-schema`  | Regenerate PGLite schema   |
| `pnpm generate:command-types` | `pnpm ops codegen:command-types` | Generate command type defs |
| `pnpm update-deps`            | `pnpm ops dev:update-deps`       | Update dependencies        |
