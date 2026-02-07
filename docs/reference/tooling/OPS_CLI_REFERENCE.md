# Ops CLI Full Reference

This document provides the complete command reference for `pnpm ops`. For quick patterns and when to use each command, see the `tzurot-tooling` skill.

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

| Command                                           | Description                      |
| ------------------------------------------------- | -------------------------------- |
| `pnpm ops run --env dev tsx scripts/my-script.ts` | Run script with dev DATABASE_URL |
| `pnpm ops run --env prod npx prisma studio`       | Open Prisma Studio against prod  |
| `pnpm ops run --env dev --force <cmd>`            | Skip confirmation for prod ops   |

**When to use:** One-off scripts that need database access without adding dedicated ops commands.

## Memory Commands

Commands for analyzing and managing pgvector memories:

| Command                             | Description                           |
| ----------------------------------- | ------------------------------------- |
| `pnpm ops memory:analyze --env dev` | Analyze duplicate memories            |
| `pnpm ops memory:analyze --verbose` | Show detailed breakdown               |
| `pnpm ops memory:cleanup --env dev` | Remove duplicate memories             |
| `pnpm ops memory:cleanup --dry-run` | Preview what would be deleted         |
| `pnpm ops memory:cleanup --force`   | Skip confirmation (required for prod) |

**Use case:** After migrations or data imports, check for and clean up duplicate memory embeddings.

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
- CURRENT_WORK.md excerpt
- Next ROADMAP.md items
- Pending migrations (optional)

**Session save/load:** Captures state to `.claude-session.json` for continuity across sessions.

**Use case:** Run `pnpm ops context` at start of AI session. Use `session:save` before ending a session.

## Inspect Commands

Runtime state inspection for debugging:

| Command                                    | Description              |
| ------------------------------------------ | ------------------------ |
| `pnpm ops inspect:queue`                   | Show BullMQ queue stats  |
| `pnpm ops inspect:queue --env prod`        | Inspect production queue |
| `pnpm ops inspect:queue --verbose`         | Show job payloads        |
| `pnpm ops inspect:queue --failed-limit 10` | Show more failed jobs    |

**Output includes:**

- Queue counts (waiting, active, completed, failed)
- Recent failed jobs with error messages
- Active job details (in verbose mode)

**Use case:** Debug BullMQ/async issues, check for stuck or failed jobs.

## Logs Commands

Fetch and analyze Railway service logs:

| Command                               | Description                      |
| ------------------------------------- | -------------------------------- |
| `pnpm ops logs --env dev`             | Fetch logs from all dev services |
| `pnpm ops logs --env prod`            | Fetch logs from production       |
| `pnpm ops logs --service api-gateway` | Logs from specific service       |
| `pnpm ops logs --filter error`        | Filter by log level              |
| `pnpm ops logs --filter "keyword"`    | Filter by text content           |
| `pnpm ops logs --lines 200`           | Fetch more lines (default: 100)  |
| `pnpm ops logs --follow`              | Stream logs in real-time         |

**Output includes:**

- Colorized output (errors=red, warnings=yellow)
- Service and environment context
- Tips for common queries

**Use case:** Debug production issues, check for errors across services, monitor logs in real-time.

## Release Commands

Version management:

| Command                                 | Description                 |
| --------------------------------------- | --------------------------- |
| `pnpm ops release:bump 3.0.0-beta.49`   | Bump all package.json files |
| `pnpm ops release:bump 3.0.0 --dry-run` | Preview without changes     |

**Use case:** Bump version across monorepo before release.

## GitHub Commands

**🚨 Use these instead of `gh pr edit` (which is broken):**

| Command                                    | Description                    |
| ------------------------------------------ | ------------------------------ |
| `pnpm ops gh:pr-info <n>`                  | Get PR title, body, state      |
| `pnpm ops gh:pr-reviews <n>`               | Get all reviews on a PR        |
| `pnpm ops gh:pr-comments <n>`              | Get line-level review comments |
| `pnpm ops gh:pr-conversation <n>`          | Get conversation comments      |
| `pnpm ops gh:pr-edit <n> --title "..."`    | Edit PR title                  |
| `pnpm ops gh:pr-edit <n> --body "..."`     | Edit PR body                   |
| `pnpm ops gh:pr-edit <n> --body-file f.md` | Edit PR body from file         |
| `pnpm ops gh:pr-all <n>`                   | Get all PR info at once        |

These use `gh api` directly, bypassing the broken GraphQL calls.

## Xray Commands

Analyze TypeScript codebase structure via AST parsing. Extracts classes, functions, interfaces, types, imports, and lint suppressions.

| Command                                 | Description                                   |
| --------------------------------------- | --------------------------------------------- |
| `pnpm ops xray`                         | Full analysis (terminal format)               |
| `pnpm ops xray --summary`               | File-level overview (no per-declaration list) |
| `pnpm ops xray bot-client`              | Analyze a single package                      |
| `pnpm ops xray bot-client ai-worker`    | Analyze multiple packages                     |
| `pnpm ops xray --format md`             | Markdown output (GFM tables, for LLMs)        |
| `pnpm ops xray --format json`           | JSON output (for tooling)                     |
| `pnpm ops xray --summary --output f.md` | Write summary to file                         |
| `pnpm ops xray --include-private`       | Include non-exported declarations             |
| `pnpm ops xray --include-tests`         | Include test files                            |
| `pnpm ops xray --imports`               | Include import analysis (auto for md/json)    |

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

| Command                                  | Description                                  |
| ---------------------------------------- | -------------------------------------------- |
| `pnpm ops test:audit`                    | Run both contract and service audits         |
| `pnpm ops test:audit-contracts`          | Audit API schema contract test coverage      |
| `pnpm ops test:audit-services`           | Audit service component test coverage        |
| `pnpm ops test:audit --strict`           | Fail on ANY gap (not just new ones)          |
| `pnpm ops test:audit-contracts --update` | Update baseline after adding contract tests  |
| `pnpm ops test:audit-services --update`  | Update baseline after adding component tests |

**How ratchets work:**

- Baselines track known gaps (`.github/baselines/*.json`)
- CI passes if no NEW gaps are introduced
- Use `--update` to accept current state after closing gaps
- Use `--strict` to see ALL gaps (existing + new)

See `tzurot-testing` skill for chip-away workflow details.

## Package.json Shortcuts

Root `package.json` provides shortcuts for common ops CLI commands:

| Script                 | Maps To                         | Description              |
| ---------------------- | ------------------------------- | ------------------------ |
| `pnpm focus:lint`      | `pnpm ops dev:lint`             | Lint changed packages    |
| `pnpm focus:test`      | `pnpm ops dev:test`             | Test changed packages    |
| `pnpm focus:build`     | `pnpm ops dev:focus build`      | Build changed packages   |
| `pnpm test:summary`    | `pnpm ops dev:test-summary`     | Summarize test results   |
| `pnpm audit:*`         | `pnpm ops test:audit-*`         | Coverage ratchet audits  |
| `pnpm with-env`        | `pnpm ops run --env`            | Run with Railway env     |
| `pnpm bump-version`    | `pnpm ops release:bump`         | Bump monorepo version    |
| `pnpm generate:pglite` | `pnpm ops test:generate-schema` | Regenerate PGLite schema |

**Note:** Data import scripts use original implementations (not yet migrated):

- `pnpm import-personality` → `tsx scripts/data/import-personality/import-personality.ts`
- `pnpm bulk-import` → `tsx scripts/data/import-personality/bulk-import.ts`
