# Tzurot v3 - Project Configuration

@~/.claude/CLAUDE.md

> **Session Start**: Read [CURRENT.md](CURRENT.md) → [BACKLOG.md](BACKLOG.md) → Continue or pull next task

> **Status**: v3 Public Beta on Railway. BYOK complete.

## Skills System

**Skills do NOT auto-activate reliably.** A hook detects keywords and reminds you to load them.

- **Skill routing**: `.claude/rules/00-skill-routing.md` maps keywords to skills
- **Invariants**: `.claude/rules/01-invariants.md` contains critical constraints (always loaded)
- **Skill eval hook**: `.claude/hooks/skill-eval.sh` runs on every prompt

When you see the skill check banner, invoke relevant skills with `Skill("skill-name")` BEFORE implementation.

## Critical Project Rules

### No Backward Compatibility

One-person project. Make the cleanest change, even if breaking.

### Verify Before Accepting External Feedback

Automated reviewers can be wrong. Check schema/source/tests before implementing suggestions.

### Mandatory Global Discovery ("Grep Rule")

Before modifying config/infrastructure: Search ALL instances -> List affected files -> Justify exclusions.

### Never Merge PRs Without User Approval

CI passing != merge approval. User must explicitly request merge.

### Never Modify Tests to Make Them Pass

If tests fail, the IMPLEMENTATION is wrong. Fix the code, not the tests.

## Tech Stack

- **Language**: TypeScript (Node.js 25+, pnpm workspaces)
- **Services**: bot-client, api-gateway, ai-worker
- **Database**: PostgreSQL + pgvector, Redis + BullMQ
- **Deployment**: Railway (auto-deploy from develop)

## Essential Commands

```bash
pnpm dev              # Start all services
pnpm test             # Run tests
pnpm quality          # lint + cpd + typecheck:spec
pnpm ops db:migrate --env dev  # Run migrations
```

## Git Workflow

**REBASE-ONLY. NO SQUASH. NO MERGE COMMITS.**

```bash
gh pr create --base develop --title "feat: description"
gh pr merge <number> --rebase --delete-branch  # ONLY with user approval
```

## Project Structure

```
tzurot/
├── .claude/
│   ├── rules/              # Always-loaded constraints
│   ├── hooks/              # Automation (skill-eval, eslint)
│   └── skills/             # 16 procedural skills
├── services/
│   ├── bot-client/         # Discord interface (NO Prisma)
│   ├── api-gateway/        # HTTP API + BullMQ
│   └── ai-worker/          # AI processing + memory
├── packages/common-types/  # Shared types
└── prisma/                 # Database schema
```

## Post-Mortems

| Date       | Incident                        | Rule                         |
| ---------- | ------------------------------- | ---------------------------- |
| 2026-02-03 | Context settings not cascading  | Trace full runtime flow      |
| 2026-02-01 | Accepted wrong type from review | Verify against schema        |
| 2026-01-30 | Gitignored data/ deleted        | Never rm -rf without okay    |
| 2026-01-30 | Work reverted without consent   | Never abandon without asking |
| 2026-01-28 | Error metadata missing model    | Update producer and consumer |
| 2026-01-24 | execSync with string commands   | Use execFileSync with arrays |

**Full details**: [docs/incidents/PROJECT_POSTMORTEMS.md](docs/incidents/PROJECT_POSTMORTEMS.md)

## Key References

- **Rules**: `.claude/rules/` (invariants, skill routing)
- **Session**: `CURRENT.md`, `BACKLOG.md`
- **Docs**: `docs/reference/` (standards, guides)

## Compaction Instructions

When compacting context, preserve:

- List of all modified files in this session
- Current task state and any blockers
- Test commands that were run and their results
- Re-read `.claude/rules/` files after compaction
