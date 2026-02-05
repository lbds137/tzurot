# Tzurot v3

@~/.claude/CLAUDE.md

Discord bot with AI personas. TypeScript monorepo on Railway.

> **Session Start**: Read [CURRENT.md](CURRENT.md) → [BACKLOG.md](BACKLOG.md) → Continue or pull next task

## Commands

```bash
pnpm dev              # Start all services
pnpm test             # Run tests
pnpm quality          # lint + cpd + typecheck:spec
pnpm ops db:migrate --env dev  # Run migrations
```

## Project Structure

```
services/
├── bot-client/         # Discord interface (NO Prisma access)
├── api-gateway/        # HTTP API + BullMQ
└── ai-worker/          # AI processing + memory
packages/common-types/  # Shared types
prisma/                 # Database schema
```

## Key Rules

All rules load automatically from `.claude/rules/`:

- **00-critical.md** - Security, git safety, testing (NEVER modify tests to pass)
- **01-architecture.md** - Service boundaries (bot-client never uses Prisma)
- **02-code-standards.md** - ESLint limits, TypeScript, testing patterns
- **03-database.md** - Prisma, pgvector, caching
- **04-discord.md** - 3-second deferral, slash commands, BullMQ
- **05-tooling.md** - CLI reference, git workflow

## Git Workflow

**REBASE-ONLY. NO SQUASH. NO MERGE COMMITS.**

```bash
gh pr create --base develop --title "feat: description"
gh pr merge <number> --rebase --delete-branch  # ONLY with user approval
```

## Post-Mortems

| Date       | Incident                       | Rule                         |
| ---------- | ------------------------------ | ---------------------------- |
| 2026-02-03 | Context settings not cascading | Trace full runtime flow      |
| 2026-01-30 | Gitignored data/ deleted       | Never rm -rf without okay    |
| 2026-01-30 | Work reverted without consent  | Never abandon without asking |
| 2026-01-24 | execSync with string commands  | Use execFileSync with arrays |

**Full details**: [docs/incidents/PROJECT_POSTMORTEMS.md](docs/incidents/PROJECT_POSTMORTEMS.md)

## Compaction Instructions

When compacting context, preserve:

- List of all modified files in this session
- Current task state and any blockers
- Test commands that were run and their results
- Re-read `.claude/rules/` files after compaction
