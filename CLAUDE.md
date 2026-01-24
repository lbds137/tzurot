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

### Completeness Over Speed

**NEVER sacrifice thoroughness for speed. NEVER take shortcuts.**

- Do not assume a pattern exists in only one location
- Do not assume APIs work a certain way without checking definitions
- When solving a problem, implement the proper solution—not documentation describing the limitation
- This is a monorepo: changes often ripple across packages. Check impact in `services/`, `packages/`, and infrastructure files

### Use MCP Council When Stuck

**When stuck on a problem, consult MCP council instead of taking shortcuts.**

Signs you're stuck and should consult council:

- Same approach failing multiple times
- About to simplify/skip something that should work
- Unsure why mocks, tests, or code aren't behaving as expected
- Tempted to say "this is good enough" when it isn't

```bash
# Debug help
mcp__council__debug({ error_message: "...", code_context: "..." })

# Second opinion on approach
mcp__council__ask({ question: "Why might X not be working?" })
```

**📚 See**: `tzurot-council-mcp` skill for full usage patterns

### Mandatory Global Discovery ("Grep Rule")

**Before modifying ANY configuration, infrastructure, or shared pattern:**

1. Search for ALL instances: `grep -r "pattern" --include="*.ext"`
2. List every file that will be affected
3. If you find N instances but only plan to edit N-1, justify why the last one is excluded

Examples:

- Updating Node version? Search `Dockerfile*`, `.nvmrc`, `package.json`, CI workflows
- Adding a workspace package? Check ALL Dockerfiles, not just the one you're focused on
- Changing an interface? Find ALL consumers across services

### Impact Analysis Plan

**Before applying edits, list the specific files you intend to modify.**

When making changes that affect multiple files:

1. State which files will be changed
2. Verify no files are missed using global search
3. If you find additional files mid-implementation, update the plan

### Mandatory Skill Pre-Flight Check

**Before writing ANY code, consult relevant skills:**

1. **Check skill descriptions** in `.claude/skills/` for matching keywords
2. **Invoke matching skills** to load project-specific patterns
3. **Follow skill guidance** over general knowledge

**Trigger Keywords → Skills**:

| Keywords                                         | Skill                   |
| ------------------------------------------------ | ----------------------- |
| `.test.ts`, `vitest`, `mock`, `coverage`         | tzurot-testing          |
| `BullMQ`, `job`, `async`, `deferral`             | tzurot-async-flow       |
| `Prisma`, `pgvector`, `database`, `migration`    | tzurot-db-vector        |
| `Railway`, `deploy`, `logs`, `service`           | tzurot-deployment       |
| `slash command`, `button`, `pagination`          | tzurot-slash-command-ux |
| `logging`, `debugging`, `operations`             | tzurot-observability    |
| `types`, `Zod`, `schema`, `constants`            | tzurot-types            |
| `secret`, `security`, `PII`, `execSync`, `shell` | tzurot-security         |
| `git`, `commit`, `PR`, `branch`                  | tzurot-git-workflow     |
| `cache`, `invalidation`, `TTL`                   | tzurot-caching          |
| `refactor`, `lint`, `complexity`                 | tzurot-code-quality     |
| `architecture`, `service boundary`               | tzurot-architecture     |
| `CURRENT_WORK.md`, `documentation`               | tzurot-docs             |
| `skill`, `SKILL.md`                              | tzurot-skills-guide     |
| `CLI`, `ops`, `script`                           | tzurot-tooling          |
| `MCP`, `council`, `second opinion`               | tzurot-council-mcp      |

**Why This Matters**: Skills contain project-specific patterns that override general knowledge. The tzurot-testing skill specifies `.component.test.ts` naming - ignoring it caused a misnamed test file.

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

## Engineering Standards

### Code Quality Limits (ESLint Enforced)

**Key limits**: 500 lines/file (error), 100 lines/function, 15 complexity, 4 nesting depth.

**📚 See**: `tzurot-code-quality` skill for full limits table, refactoring patterns, and extraction techniques.

### Type Safety (TypeScript Strict Mode)

- `strict: true` - All strict checks enabled
- `@typescript-eslint/no-explicit-any` - ERROR (use `unknown` + type guards)
- `@typescript-eslint/no-unsafe-*` - ERROR (no unsafe operations)
- `@typescript-eslint/strict-boolean-expressions` - ERROR

### Coverage Requirements (Codecov Enforced)

**Threshold**: 80% project-wide and per-patch. Codecov blocks if coverage drops >2%.

**📚 See**: `tzurot-testing` skill for coverage details and ratchet audits.

### Error Handling Strategy

**Predictable errors return values; unexpected failures throw.**

```typescript
// ✅ Gateway API responses use Result pattern
const result = await callGatewayApi<PersonaResponse>('/user/persona', { userId });
if (!result.ok) {
  await interaction.editReply(`❌ ${result.error}`);
  return;
}
// result.data is typed correctly here
```

### Discord 3-Second Rule

Discord interactions have a 3-second timeout. For AI operations:

```typescript
await interaction.deferReply(); // MUST be called within 3 seconds
// ... async work (AI generation, DB queries) ...
await interaction.editReply({ content: result });
```

**📚 See**: `tzurot-async-flow` skill for BullMQ deferral patterns

### Bounded Data Access

**All queries returning arrays must be bounded.**

- Required: `take` limit on `findMany` queries
- Required: Cursor-based pagination for list endpoints

```typescript
// ✅ CORRECT - Bounded query
const items = await prisma.personality.findMany({ take: 100 });

// ❌ WRONG - Unbounded (OOM risk as data grows)
const items = await prisma.personality.findMany();
```

### Boy Scout Rule

**Leave code better than you found it.**

When modifying a file:

- Fix lint warnings in code you touch
- Add missing types to functions you modify
- Extract helpers if adding to an already-long function

### Dead Code Policy (YAGNI)

**Delete immediately, don't comment out.**

- ❌ No `// TODO: remove later`
- ❌ No `if (false) { ... }`
- ❌ No unused imports/variables (ESLint enforced)
- ✅ Git history preserves deleted code

### Code Review Checklist

Before approving any PR:

| Category    | Checks                                                 |
| ----------- | ------------------------------------------------------ |
| **Safety**  | No secrets, no unbounded queries, error cases handled  |
| **Quality** | Functions <100 lines, complexity <15, no `any` types   |
| **Testing** | New behavior tested, tests pass, no `.skip` or `.only` |

## Tech Stack

- **Language**: TypeScript (Node.js 25+, pnpm workspaces)
- **Discord**: Discord.js 14.x
- **Services**: bot-client, api-gateway, ai-worker
- **Database**: PostgreSQL + pgvector, Redis + BullMQ
- **Deployment**: Railway (auto-deploy from develop)
- **AI**: OpenRouter (primary), Gemini (alternative)

## Project Structure

```
tzurot/
├── .claude/skills/         # 16 project-specific skills
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
pnpm test:summary

# Release management
pnpm bump-version 3.0.0-beta.31  # Bump version in all package.json files

# Ops CLI (Railway/database operations)
pnpm ops db:status --env dev     # Check migration status
pnpm ops db:migrate --env dev    # Run pending migrations
pnpm ops db:migrate --env prod --force  # Prod requires --force
pnpm ops run --env dev <cmd>     # Run any command with Railway DB credentials
```

**Note**: Use pnpm, NOT npm. ESLint uses flat config (`eslint.config.js`), NOT `.eslintrc.*`.

**📚 See**: `tzurot-tooling` skill for full CLI reference, `tzurot-deployment` for Railway ops, `tzurot-db-vector` for database patterns

## Git Workflow

**REBASE-ONLY. NO SQUASH. NO MERGE COMMITS.**

GitHub settings enforce rebase-only - merge commits and squash merges are disabled at the repository level.

### 🚨 PR Merge Rules

**NEVER merge a PR without explicit user approval.** This is non-negotiable.

- ✅ CI passing is necessary but NOT sufficient for merging
- ✅ User must explicitly approve/request the merge
- ❌ NEVER merge just because "CI is green"
- ❌ NEVER merge to "complete the task"

```bash
# Always target develop for PRs (never main for features)
gh pr create --base develop --title "feat: description"

# Commit format
git commit -m "feat(service): description"

# Merge strategy (ONLY with user approval)
gh pr merge <number> --rebase --delete-branch

# PR review/comments - USE OPS CLI (gh pr view is flaky)
pnpm ops gh:pr-comments <number>   # Get all comments
pnpm ops gh:pr-reviews <number>    # Get all reviews
pnpm ops gh:pr-all <number>        # Get everything
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

**🚨 SHELL COMMANDS - RECURRING ISSUE - ALWAYS USE `execFileSync` WITH ARRAYS:**

This pattern has been violated multiple times. Before writing ANY shell execution code, read this:

```typescript
import { execFileSync } from 'node:child_process';

// ❌ WRONG - Command injection vulnerability (even with "trusted" data)
execSync(`npx prisma migrate diff --to-schema "${schemaPath}"`);
execSync(`railway variables --set "${key}=${value}"`);
execSync(`git commit -m "${message}"`);

// ✅ CORRECT - Arguments passed directly, no shell interpretation
execFileSync('npx', ['prisma', 'migrate', 'diff', '--to-schema', schemaPath]);
execFileSync('railway', ['variables', '--set', `${key}=${value}`]);
execFileSync('git', ['commit', '-m', message]);

// ✅ OK - Fully static commands (no variables)
execSync('git log --oneline -5');
```

**Rule:** If ANY variable is interpolated into a command, use `execFileSync` with an array.

**📚 See**: `tzurot-security` for comprehensive security patterns

## Skills Reference

16 project-specific skills in `.claude/skills/`:

| Skill                   | Use When                       | Enforces                 |
| ----------------------- | ------------------------------ | ------------------------ |
| tzurot-architecture     | Service design, error patterns | SRP, service boundaries  |
| tzurot-async-flow       | BullMQ, Discord deferrals      | Async patterns           |
| tzurot-caching          | Cache patterns                 | Cache invalidation       |
| tzurot-code-quality     | Lint errors, refactoring       | ESLint rules, SOLID      |
| tzurot-council-mcp      | Consulting external AI         | Second opinions          |
| tzurot-db-vector        | PostgreSQL, pgvector           | Query patterns           |
| tzurot-deployment       | Railway, troubleshooting       | Deploy safety            |
| tzurot-docs             | Documentation, session handoff | Knowledge continuity     |
| tzurot-git-workflow     | Commits, PRs, rebasing         | Git safety, hooks        |
| tzurot-observability    | Logging, debugging, operations | Structured logging       |
| tzurot-security         | Secrets, user input            | Least privilege          |
| tzurot-skills-guide     | Creating/updating skills       | Skill quality            |
| tzurot-slash-command-ux | Slash commands, pagination     | Standard naming, buttons |
| tzurot-testing          | Writing tests, mocking         | Coverage, test behavior  |
| tzurot-tooling          | CLI commands, dev scripts      | Ops CLI, standardization |
| tzurot-types            | Types, constants, Zod schemas  | Type safety, DRY         |

## Post-Mortems

| Date       | Incident                      | Rule                               |
| ---------- | ----------------------------- | ---------------------------------- |
| 2026-01-24 | execSync with string commands | Use execFileSync with arrays       |
| 2026-01-17 | Wrong branch migration deploy | Run migrations from correct branch |
| 2026-01-17 | Dockerfile missed new package | Use Grep Rule for all infra files  |
| 2026-01-07 | PR merged without approval    | Never merge PRs without user okay  |
| 2025-07-25 | Untested push broke develop   | Always run tests before pushing    |
| 2025-07-21 | Git restore destroyed work    | Confirm before destructive git     |
| 2025-10-31 | DB URL committed              | Never commit database URLs         |
| 2025-12-05 | Direct fetch broke /character | Use gateway clients                |
| 2025-12-06 | API contract mismatch         | Use shared Zod schemas             |

**Full details**: [docs/incidents/PROJECT_POSTMORTEMS.md](docs/incidents/PROJECT_POSTMORTEMS.md)

## Railway Deployment

**Project**: industrious-analysis (development)

- **api-gateway**: https://api-gateway-development-83e8.up.railway.app
- **Auto-deploy**: Push to develop branch
- **Cost Model**: BYOK (users provide API keys via `/wallet`)

**📚 See**: `tzurot-deployment` skill for operations, `docs/reference/RAILWAY_CLI_REFERENCE.md` for CLI

## Tool Permissions

### Approved (No Permission Needed)

- `pnpm` commands, file operations, search tools
- Railway/git read operations

### Requires Approval

- `pnpm add/remove`, Railway write operations
- Git commits/pushes, database migrations

## Key References

- **CLI**: `docs/reference/RAILWAY_CLI_REFERENCE.md`, `docs/reference/GITHUB_CLI_REFERENCE.md`
- **Folder Structure**: `docs/reference/standards/FOLDER_STRUCTURE.md`
- **Tri-State Pattern**: `docs/reference/standards/TRI_STATE_PATTERN.md` (for cascading settings)
- **v2 Feature Status**: `docs/proposals/active/V2_FEATURE_TRACKING.md`
- **Tech Debt**: `docs/proposals/active/TECH_DEBT.md`
