# Tzurot v3 - Project Configuration

@~/.claude/CLAUDE.md

> **🎯 SESSION STARTUP**: Read [CURRENT_WORK.md](CURRENT_WORK.md) → [ROADMAP.md](ROADMAP.md) → Start next unchecked task

> **⚠️ STATUS**: v3 is in **Public Beta** on Railway. BYOK complete, guest mode available.

## Project Overview

Tzurot is a Discord bot with multiple AI personalities powered by a microservices architecture. Users interact with personalities through @mentions, each maintaining long-term memory via pgvector.

**Context**: One-person project with AI assistance. Avoid team-oriented language.

**Why v3**: Shapes.inc killed their API, forcing a complete vendor-agnostic rewrite.

## 🚨 Critical Project Rules

### No Backward Compatibility

**One-person project. No external users. No compatibility concerns.**

- **NEVER** add compatibility layers, shims, or adapters
- **NEVER** keep old code paths "just in case"
- **ALWAYS** make the cleanest change, even if breaking

### No "Not My Problem" Excuses

**If tests fail or lint errors exist, FIX THEM. No exceptions.**

- **NEVER** use `--no-verify` to bypass checks
- **ALWAYS** leave the codebase better than you found it
- Previous session broke it? Fix it now.

### Deterministic UUIDs Required

**NEVER use random UUIDs (v4). ALWAYS use deterministic UUIDs (v5).**

This project syncs data between dev and prod. Random UUIDs cause sync failures.

```typescript
// ✅ CORRECT - Use generators from packages/common-types/src/utils/deterministicUuid.ts
import { generateUserPersonalityConfigUuid } from '@tzurot/common-types';

await prisma.userPersonalityConfig.upsert({
  create: {
    id: generateUserPersonalityConfigUuid(userId, personalityId),
    userId,
    personalityId,
    llmConfigId,
  },
});

// ❌ WRONG - No id specified, Prisma generates random UUID
await prisma.userPersonalityConfig.upsert({
  create: { userId, personalityId, llmConfigId },
});
```

**Available generators**: User, Personality, Persona, SystemPrompt, LlmConfig, UserPersonalityConfig, ConversationHistory, ActivatedChannel

### Gateway Client Usage

**NEVER use direct `fetch()` to the API gateway.** Use established clients.

| Client             | Purpose            | Use For              |
| ------------------ | ------------------ | -------------------- |
| `callGatewayApi()` | User-authenticated | `/user/*` endpoints  |
| `adminFetch()`     | Admin-only         | `/admin/*` endpoints |
| `GatewayClient`    | Internal service   | Service-to-service   |

**📚 See**: `tzurot-architecture` skill for examples and header reference

### Database Access Rules

**bot-client MUST NEVER use Prisma directly.** All database access goes through api-gateway.

| Service       | Prisma   | Why                     |
| ------------- | -------- | ----------------------- |
| `bot-client`  | ❌ NEVER | Use gateway APIs        |
| `api-gateway` | ✅ Yes   | Source of truth         |
| `ai-worker`   | ✅ Yes   | Memory/conversation ops |

## Tech Stack

- **Language**: TypeScript (Node.js 20+, pnpm workspaces)
- **Discord**: Discord.js 14.x
- **Services**: bot-client, api-gateway, ai-worker
- **Database**: PostgreSQL + pgvector, Redis + BullMQ
- **Deployment**: Railway (auto-deploy from develop)
- **AI**: OpenRouter (primary), Gemini (alternative)

## Project Structure

```
tzurot/
├── .claude/skills/         # 13 project-specific skills
├── services/
│   ├── bot-client/         # Discord interface
│   ├── api-gateway/        # HTTP API + BullMQ queue
│   └── ai-worker/          # AI processing + memory
├── packages/common-types/  # Shared types/interfaces
├── personalities/          # Personality configs (JSON)
├── prisma/                 # Database schema
└── docs/                   # Documentation
```

## Essential Commands

```bash
# Development
pnpm install          # Install dependencies
pnpm dev              # Start all services
pnpm build            # Build all
pnpm typecheck        # Type check all
pnpm lint             # Lint all
pnpm test             # Run all tests

# Service-specific
pnpm --filter @tzurot/bot-client dev
pnpm --filter @tzurot/ai-worker test

# Test summary (always run after tests)
pnpm test 2>&1 | grep -E "(Test Files|Tests)" | sed 's/\x1b\[[0-9;]*m//g'
```

**Note**: Use pnpm, NOT npm. ESLint uses flat config (`eslint.config.js`), NOT `.eslintrc.*`.

**📚 See**: `tzurot-db-vector` for database commands, `tzurot-deployment` for Railway commands

## Git Workflow

**REBASE-ONLY. NO SQUASH. NO MERGE.**

```bash
# Always target develop for PRs (never main for features)
gh pr create --base develop --title "feat: description"

# Commit format
git commit -m "feat(service): description"
```

**📚 See**: `tzurot-git-workflow` for complete workflow, hooks, safety protocol

## Environment Variables

### bot-client

- `DISCORD_TOKEN`, `GATEWAY_URL`

### api-gateway

- `REDIS_URL`, `DATABASE_URL`

### ai-worker

- `REDIS_URL`, `DATABASE_URL`, `AI_PROVIDER`
- `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`

## Security

**🚨 NEVER COMMIT SECRETS** - Has happened TWICE. Rotate immediately if committed.

```bash
# Pre-commit check
git diff --cached | grep -iE '(password|secret|token|api.?key|postgresql://|redis://)'
```

**📚 See**: `tzurot-security` for comprehensive security patterns

## Skills Reference

13 project-specific skills in `.claude/skills/`:

| Skill                | Use When                       |
| -------------------- | ------------------------------ |
| tzurot-testing       | Writing tests, mocking         |
| tzurot-types         | Types, constants, Zod schemas  |
| tzurot-git-workflow  | Commits, PRs, rebasing         |
| tzurot-security      | Secrets, user input            |
| tzurot-observability | Logging, debugging, operations |
| tzurot-architecture  | Service design, error patterns |
| tzurot-docs          | Documentation, session handoff |
| tzurot-gemini-collab | Consulting Gemini MCP          |
| tzurot-db-vector     | PostgreSQL, pgvector           |
| tzurot-async-flow    | BullMQ, Discord deferrals      |
| tzurot-deployment    | Railway, troubleshooting       |
| tzurot-caching       | Cache patterns                 |
| tzurot-skills-guide  | Creating/updating skills       |

## Post-Mortems

| Date       | Incident                      | Rule                            |
| ---------- | ----------------------------- | ------------------------------- |
| 2025-07-25 | Untested push broke develop   | Always run tests before pushing |
| 2025-07-21 | Git restore destroyed work    | Confirm before destructive git  |
| 2025-10-31 | DB URL committed              | Never commit database URLs      |
| 2025-12-05 | Direct fetch broke /character | Use gateway clients             |
| 2025-12-06 | API contract mismatch         | Use shared Zod schemas          |

**Full details**: [docs/postmortems/PROJECT_POSTMORTEMS.md](docs/postmortems/PROJECT_POSTMORTEMS.md)

## Railway Deployment

**Project**: industrious-analysis (development)

- **api-gateway**: https://api-gateway-development-83e8.up.railway.app
- **Auto-deploy**: Push to develop branch
- **Cost Model**: BYOK (users provide API keys via `/wallet`)

**📚 See**: `tzurot-deployment` for operations, `docs/reference/RAILWAY_CLI_REFERENCE.md` for CLI

## Tool Permissions

### Approved (No Permission Needed)

- `pnpm` commands, file operations, search tools
- Railway/git read operations

### Requires Approval

- `pnpm add/remove`, Railway write operations
- Git commits/pushes, database migrations

## Key References

- **CLI**: `docs/reference/RAILWAY_CLI_REFERENCE.md`, `docs/reference/GITHUB_CLI_REFERENCE.md`
- **Folder Structure**: `docs/standards/FOLDER_STRUCTURE.md`
- **v2 Feature Status**: `docs/planning/V2_FEATURE_TRACKING.md`
