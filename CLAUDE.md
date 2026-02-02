# Tzurot v3 - Project Configuration

@~/.claude/CLAUDE.md

> **Session Start**: Read [CURRENT.md](CURRENT.md) → [BACKLOG.md](BACKLOG.md) → Continue or pull next task

> **Status**: v3 Public Beta on Railway. BYOK complete.

## Skills Reference (MUST Invoke Before Work)

| Keywords                                | Skill                     | Enforces                |
| --------------------------------------- | ------------------------- | ----------------------- |
| `.test.ts`, `vitest`, `mock`            | `tzurot-testing`          | Coverage, test behavior |
| `BullMQ`, `job`, `deferral`             | `tzurot-async-flow`       | Async patterns          |
| `Prisma`, `pgvector`, `migration`       | `tzurot-db-vector`        | Query patterns          |
| `Railway`, `deploy`, `logs`             | `tzurot-deployment`       | Deploy safety           |
| `slash command`, `button`, `pagination` | `tzurot-slash-command-ux` | Standard naming         |
| `git`, `commit`, `PR`                   | `tzurot-git-workflow`     | Git safety              |
| `secret`, `security`, `execSync`        | `tzurot-security`         | Least privilege         |
| `types`, `Zod`, `schema`                | `tzurot-types`            | Type safety             |
| `refactor`, `lint`, `complexity`        | `tzurot-code-quality`     | ESLint rules            |
| `CURRENT.md`, `BACKLOG.md`              | `tzurot-docs`             | Documentation           |
| `MCP`, `council`                        | `tzurot-council-mcp`      | Second opinions         |
| `architecture`, `service boundary`      | `tzurot-architecture`     | SRP                     |
| `cache`, `TTL`                          | `tzurot-caching`          | Invalidation            |
| `logging`, `debugging`                  | `tzurot-observability`    | Structured logging      |
| `CLI`, `ops`, `script`                  | `tzurot-tooling`          | Ops CLI                 |
| `skill`, `SKILL.md`                     | `tzurot-skills-guide`     | Skill quality           |

**Skills auto-load when relevant.** Claude invokes them based on task keywords. Use `Skill("tzurot-testing")` to load manually.

## Critical Project Rules

### No Backward Compatibility

One-person project. Make the cleanest change, even if breaking.

### Verify Before Accepting External Feedback

Automated reviewers can be wrong. Check schema/source/tests before implementing suggestions.

### Mandatory Global Discovery ("Grep Rule")

Before modifying config/infrastructure: Search ALL instances → List affected files → Justify exclusions.

### Never Merge PRs Without User Approval

CI passing ≠ merge approval. User must explicitly request merge.

### Deterministic UUIDs Required

Never use random UUIDs (v4). Use generators from `@tzurot/common-types`.

### Database Access Rules

| Service     | Prisma | Why              |
| ----------- | ------ | ---------------- |
| bot-client  | NEVER  | Use gateway APIs |
| api-gateway | Yes    | Source of truth  |
| ai-worker   | Yes    | Memory ops       |

### Gateway Clients

Never use direct `fetch()`. Use: `callGatewayApi()`, `adminFetch()`, or `GatewayClient`.

## Engineering Standards

### Code Quality (ESLint Enforced)

- 500 lines/file (error), 100 lines/function, 15 complexity, 4 nesting depth
- `strict: true`, no `any` types, no unsafe operations
- 80% coverage (Codecov enforced)

**See**: `tzurot-code-quality` skill for details

### Error Handling

Predictable errors return values; unexpected failures throw. Gateway APIs use Result pattern.

### Discord 3-Second Rule

```typescript
await interaction.deferReply(); // Within 3 seconds
// ... async work ...
await interaction.editReply({ content: result });
```

### Bounded Queries

All `findMany` must have `take` limit. No unbounded arrays.

### Security

**Never commit secrets.** Use `execFileSync` with arrays, not `execSync` with strings.

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

**See**: `tzurot-tooling` skill for full CLI reference

## Automation

**Hooks**: PostToolUse runs `eslint --fix` on .ts/.tsx edits. Config: `.claude/settings.json`

**Commands**: `/project:quality`, `/project:test-file`, `/project:pr-feedback`, `/project:session-end`

## Git Workflow

**REBASE-ONLY. NO SQUASH. NO MERGE COMMITS.**

```bash
gh pr create --base develop --title "feat: description"
gh pr merge <number> --rebase --delete-branch  # ONLY with user approval
```

**See**: `tzurot-git-workflow` skill for safety protocol

## Project Structure

```
tzurot/
├── .claude/skills/         # 16 project-specific skills
├── services/
│   ├── bot-client/         # Discord interface
│   ├── api-gateway/        # HTTP API + BullMQ
│   └── ai-worker/          # AI processing + memory
├── packages/common-types/  # Shared types
├── personalities/          # Personality configs
└── prisma/                 # Database schema
```

## Post-Mortems

| Date       | Incident                        | Rule                         |
| ---------- | ------------------------------- | ---------------------------- |
| 2026-02-01 | Accepted wrong type from review | Verify against schema        |
| 2026-01-30 | Gitignored data/ deleted        | Never rm -rf without okay    |
| 2026-01-30 | Work reverted without consent   | Never abandon without asking |
| 2026-01-28 | Error metadata missing model    | Update producer and consumer |
| 2026-01-24 | execSync with string commands   | Use execFileSync with arrays |

**Full details**: [docs/incidents/PROJECT_POSTMORTEMS.md](docs/incidents/PROJECT_POSTMORTEMS.md)

## Key References

- **Session**: `CURRENT.md`, `BACKLOG.md`
- **Docs**: `docs/reference/` (standards, guides)
- **Railway**: `docs/reference/RAILWAY_CLI_REFERENCE.md`
- **GitHub**: `docs/reference/GITHUB_CLI_REFERENCE.md`
