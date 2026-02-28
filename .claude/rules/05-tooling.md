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
