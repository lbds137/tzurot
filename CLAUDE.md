# Tzurot v3

@~/.claude/CLAUDE.md

Discord bot with AI personas. TypeScript monorepo on Railway.

> **Session Start**: Read [CURRENT.md](CURRENT.md) → [BACKLOG.md](BACKLOG.md) → Continue or pull next task

## Commands

```bash
pnpm dev              # Start all services
pnpm test             # Run unit tests
pnpm test:component   # Run component tests (after command structure changes)
pnpm quality          # the full static gate — composition in package.json scripts.quality (synced to CI by guard:gate-parity)
pnpm ops db:migrate --env dev  # Run migrations
```

## Project Structure

```
services/
├── bot-client/         # Discord interface (NO Prisma access)
├── api-gateway/        # HTTP API + BullMQ
├── ai-worker/          # AI processing + memory
└── voice-engine/       # Python FastAPI STT/TTS service
packages/
├── common-types/       # Shared types
├── embeddings/         # Local embedding model
├── test-utils/         # Shared test helpers + PGLite
├── tooling/            # Ops CLI (pnpm ops)
└── ...                 # +6 more: cache-invalidation, clients, config-resolver,
                        #   conversation-history, identity, test-factories
prisma/                 # Database schema
```

## Key Rules

All rules load automatically from `.claude/rules/`:

- **00-critical.md** - Security, git safety, testing (NEVER modify tests to pass)
- **01-architecture.md** - Service boundaries (bot-client never uses Prisma)
- **02-code-standards.md** - ESLint limits, TypeScript, testing patterns
- **03-database.md** - Prisma, pgvector, caching
- **04-discord.md** - 3-second deferral, slash commands, BullMQ
- **05-tooling.md** - CLI reference, commit & release standards
- **06-backlog.md** - Backlog structure and session workflow
- **07-documentation.md** - Doc placement, naming, lifecycle
- **08-review-response.md** - PR review-response iteration (auto-apply vs ASK)
- **09-interaction-style.md** - Session interaction style (don't suggest stopping)

## Git Workflow

**REBASE-ONLY. NO SQUASH. NO MERGE COMMITS.**

```bash
gh pr create --base develop --title "feat: description"
gh pr merge <number> --rebase --delete-branch  # Feature PRs only, when truly ready (00-critical § Merge Approval)
gh pr merge <number> --rebase                  # Release PRs (develop → main) — NEVER delete develop
```

## Post-Mortems

> **Entry criteria**: Only catastrophic, AI-specific behavioral failures that cause unrecoverable loss of code, data, or context. All other bugs go to PROJECT_POSTMORTEMS.md.

| Date       | Incident                       | Rule                                         |
| ---------- | ------------------------------ | -------------------------------------------- |
| 2026-02-03 | Context settings not cascading | Trace full runtime flow                      |
| 2026-01-30 | Gitignored data/ deleted       | Never rm -rf without okay                    |
| 2026-01-30 | Work reverted without consent  | Never abandon without asking                 |
| 2026-03-09 | Near-delete of develop branch  | Never --delete-branch on long-lived branches |
| 2026-01-24 | execSync with string commands  | Use execFileSync with arrays                 |

**Full details**: [docs/incidents/PROJECT_POSTMORTEMS.md](docs/incidents/PROJECT_POSTMORTEMS.md)

## Compaction Instructions

When compacting context, preserve:

- List of all modified files in this session
- Current task state and any blockers
- Test commands that were run and their results
- **Session settings the user changed** (reasoning effort level, permission mode) — post-compaction sessions have twice re-suggested settings that were already active
- **Open promises and asks**: anything announced as "I'll do X later," any unanswered question posed to the user, any user question not yet answered
- **The work-stack pointer**: the interrupted task and its resume point when a side-quest (prod bug, review round) preempted the main line
- **Manual-test / smoke-checklist state**: which items the user has executed and their results (also written to CURRENT.md per `/tzurot-testing` — the file is the source of truth)
- Re-read `.claude/rules/` files after compaction
- **Read-state does not survive compaction**: Edit/Write requires a fresh Read of any file post-compaction — and auto-loaded content (rules, CLAUDE.md, CURRENT.md, backlog injections) never counts as Read for editing purposes; Read the file first or the edit is rejected

**Recovery mechanism**: exact pre-compaction context (verbatim quotes, tool output, decisions) is recoverable by grepping the session JSONL under `~/.claude/projects/<project-slug>/` (the slug derives from the checkout path — `ls ~/.claude/projects/` to find it) — use it before re-deriving or guessing at lost state. When something specific feels missing post-compaction, actively recover in this order: (1) session settings (effort level, permission mode) — don't re-suggest what was active; (2) open promises/asks — grep for "I'll" / the user's unanswered questions; (3) the work-stack pointer (interrupted task + resume point); (4) manual-test/smoke results not yet in CURRENT.md.
