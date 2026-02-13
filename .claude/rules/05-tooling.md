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

# Focused (changed packages only)
pnpm focus:lint       # Lint changed packages
pnpm focus:test       # Test changed packages
```

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

```markdown
## v3.0.0-beta.XX — Brief summary (under 60 chars)

### Features

- **scope:** description (#PR)

### Bug Fixes

- **scope:** description (#PR)

### Improvements

- **scope:** description (#PR)
```

**Rules:**

- Version + summary line is required (H2)
- Categories use H3: **Features**, **Bug Fixes**, **Improvements**, **Breaking Changes**, **Chores**
- Breaking Changes section always comes first when present
- Only include categories that have entries
- Line items: `- **scope:** description (#123)` — scope maps to commit scope, `#N` auto-links on GitHub
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

## References

- Full tooling guide: `packages/tooling/README.md`
- Ops CLI reference: `docs/reference/tooling/OPS_CLI_REFERENCE.md`
- Static analysis: `docs/reference/STATIC_ANALYSIS.md`
- Railway CLI: `docs/reference/RAILWAY_CLI_REFERENCE.md`
- GitHub CLI: `docs/reference/GITHUB_CLI_REFERENCE.md`
