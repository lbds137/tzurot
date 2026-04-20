# Tooling Reference

## Essential Commands

```bash
# Development
pnpm dev              # Start all services
pnpm test             # Run unit tests
pnpm test:int         # Run integration tests (snapshots, cross-service)
pnpm quality          # lint + cpd + depcruise + typecheck + typecheck:spec
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

This applies to all heavy commands: `pnpm test`, `pnpm test:int`, `pnpm quality`,
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
```

**Post-deploy migration reminder:** If the deployment includes new Prisma migrations, run `pnpm ops db:migrate --env dev` and `--env prod` after deploying. Migrations are NOT auto-applied on Railway.

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

### Test Audits

```bash
pnpm ops test:audit                  # Run coverage ratchet (CI)
pnpm ops test:audit --update         # Update baseline after closing gaps
```

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

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`
**Scopes:** `ai-worker`, `api-gateway`, `bot-client`, `common-types`, `ci`, `deps`

### PR Monitoring (automatic — do not wait to be asked)

**Whenever you create a PR or push commits to an open PR, arm a `Monitor` that waits for CI to finish and then reports on new reviewer comments.** Don't wait for the user to ask whether CI passed or whether a review landed.

The `.claude/hooks/pr-monitor-reminder.sh` PostToolUse hook fires after every `git push` / `gh pr create` and injects a reminder with the pre-built Monitor invocation. If you see that banner, arm the Monitor before doing anything else — the hook is the enforcement mechanism behind this rule. If it ever stops firing (settings.json drift, hook script removed, etc.), fall back to manually arming the monitor yourself.

The monitor command (PR number is `N`):

```
gh pr checks N --watch --interval=30 > /dev/null 2>&1; echo "CI_COMPLETE"; gh pr checks N
```

Note the `;` between each command (not `&&`). `echo "CI_COMPLETE"` and the final `gh pr checks N` run unconditionally — the sentinel fires even if `--watch` exits non-zero (network blip, bad flag). That's intentional: the trailing `gh pr checks N` surfaces the true state regardless, and "watch exited" is always a useful signal. `CI_COMPLETE` means "watch exited," not "all checks passed."

Pass to `Monitor` with `timeout_ms: 900000` (15 min — GitHub CI + CodeQL usually finishes well inside that; if it exceeds, re-arm).

When the monitor fires, **all four** of the following must happen before the cycle is complete — do not stop after step 1 even if every check passed:

1. Note the final CI state from the `gh pr checks N` output.
2. Fetch new review comments: `gh api /repos/lbds137/tzurot/issues/N/comments`. Track the `created_at` timestamp of the most recently reported comment in working memory so a subsequent push doesn't re-report reviews already surfaced. **Include human reviewer comments** alongside `claude[bot]` / `github-advanced-security[bot]` — user feedback matters as much as bot feedback.
3. In a single concise user-facing message, report: CI pass/fail summary **and** any new review findings (grouped as blocking vs. non-blocking). If there are no new reviews since the last push, say so explicitly — silence isn't a substitute for "no new comments."
4. **Do not fix anything without user approval.** Report only. The user decides in-PR vs. backlog (matching the pattern in `.claude/skills/tzurot-git-workflow/SKILL.md`).

The "step 1 without step 2" failure mode is the common one to guard against: all-green CI feels complete, so the comment-fetch step gets skipped. Steps 1 and 2 are both part of the Monitor-fire response contract; all-CI-green does not discharge the comment-fetch obligation.

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
