# Tzurot v3 - Project Configuration

@~/.claude/CLAUDE.md

> **🎯 MASTER ROADMAP - THE SOURCE OF TRUTH**: Read [ROADMAP.md](ROADMAP.md) at the start of EVERY session to understand the current sprint, active tasks, and overall strategy. This is the ONLY planning document you need to reference - all other planning docs are supporting details.

> **📍 SESSION STARTUP PROTOCOL**:
>
> 1. Read [CURRENT_WORK.md](CURRENT_WORK.md) - Understand what was last worked on
> 2. Read [ROADMAP.md](ROADMAP.md) - Find the current sprint and active tasks
> 3. Start working on the next unchecked task in the current sprint
> 4. If user has a new idea → Add to Icebox section in ROADMAP.md, don't derail

> **🚂 RAILWAY CLI REFERENCE**: Before running ANY `railway` command, consult [docs/reference/RAILWAY_CLI_REFERENCE.md](docs/reference/RAILWAY_CLI_REFERENCE.md) to avoid errors from outdated AI training data. This reference has accurate, tested commands for Railway CLI 4.5.3.

> **🐙 GITHUB CLI REFERENCE**: Before running `gh` commands (especially `gh api` or reading PR comments), consult [docs/reference/GITHUB_CLI_REFERENCE.md](docs/reference/GITHUB_CLI_REFERENCE.md). Key pitfall: PR comments have THREE different API endpoints (issue comments, review comments, reviews) - using the wrong one returns empty results!

> **⚠️ PRODUCTION STATUS**: v3 is deployed on Railway in TWO environments:
>
> - **Development**: For testing new features before stable release
> - **Production**: Stable alpha version for bot owner + alpha users
>
> ✅ **BYOK IS COMPLETE** - Public beta launch ready. Users can bring their own API keys via `/wallet` commands. Guest mode (free models) available for users without BYOK keys.

## Project Overview

Tzurot is a Discord bot with multiple AI personalities powered by a microservices architecture. Users interact with different personalities through @mentions, and each personality maintains long-term memory via vector database.

**Project Context**: This is a **one-person project** developed and maintained by a single developer with AI assistance. Avoid team-oriented language and assumptions.

**Why v3 Exists**: Shapes.inc (the AI API provider for v2) killed their API to force users to their website only, forcing a complete rewrite. v3 is vendor-agnostic and uses modern patterns.

## No Backward Compatibility Concerns

**This is a one-person project. You control all the code. There are no external users to maintain compatibility for.**

- **NEVER** add backward compatibility layers, shims, or adapters
- **NEVER** keep old code paths "just in case"
- **NEVER** justify a decision with "but it maintains compatibility"
- **ALWAYS** make the cleanest change possible, even if breaking

**Examples of backward compatibility anti-patterns to avoid:**

- "I'll keep both the old and new methods for compatibility"
- "I'll add a migration layer so existing code still works"
- "Let me make this work with the old format too"
- "I'll cache by all three keys to maintain compatibility"

**The correct approach:**

- Change it the RIGHT way
- Update all call sites
- Delete the old code
- Ship it

If a change breaks something, that's fine - you'll fix it in the next commit. Clean code > compatibility.

## Development Strategy: "Launch, Stabilize, Evolve"

**THE CRITICAL INSIGHT** (from Gemini consultation, 2025-11-22):

> "You are blocking yourself from success by thinking about the Brain (OpenMemory) before you have built the Wallet (BYOK). Build the Wallet. Launch. Then build the Brain."

### The Three-Phase Roadmap

All work is organized in [ROADMAP.md](ROADMAP.md) following this structure:

1. **Phase 1: "Gatekeeper"** ✅ COMPLETE
   - **Goal**: Enable BYOK to allow public launch without bankruptcy risk
   - **Sprints**: Testing baseline → BYOK schema migration → Slash commands
   - **Milestone**: Public beta launch
   - **Status**: ✅ Complete - BYOK, /wallet commands, guest mode all implemented

2. **Phase 2: "Refinement"** (12-18 sessions, 3-5 weeks)
   - **Goal**: Feature parity with v2, user retention features
   - **Sprints**: Voice enhancements → Quick wins → V2 feature parity
   - **Milestone**: Production-ready for sustained growth
   - **Status**: 📋 Planned (after Phase 1)

3. **Phase 3: "Evolution"** (15-23 sessions, 4-6 weeks)
   - **Goal**: Advanced architecture and cognitive features
   - **Sprints**: OpenMemory foundation → Agentic features → Advanced features
   - **Milestone**: AGI-lite with sophisticated memory graphs
   - **Status**: 🧊 Icebox (DO NOT START until Phase 1 & 2 complete)

### The "One Document Rule"

**Problem**: Too many planning docs leads to decision fatigue and context switching.

**Solution**: ROADMAP.md is the single source of truth. All other planning docs (PHASED_IMPLEMENTATION_PLAN.md, QOL_MODEL_MANAGEMENT.md, OPENMEMORY_MIGRATION_PLAN.md, V2_FEATURE_TRACKING.md) are supporting details referenced by specific sprints.

**If User Has a New Idea**:

1. Add it to the Icebox section of ROADMAP.md
2. Ask: "Does this help launch the public beta?" → If no, leave in Icebox
3. Ask: "Does this prevent a production fire?" → If no, leave in Icebox
4. Resume current sprint without derailment

### AI Session Workflow

**Start of Every Session**:

```
1. Read CURRENT_WORK.md ("Last worked on: Sprint X, Task Y")
2. Open ROADMAP.md
3. Navigate to current sprint (e.g., "Sprint 2: BYOK Schema Migration")
4. Find the next unchecked [ ] task
5. Begin work on that specific task
```

**During Session**:

- Stay focused on ONE task at a time
- Don't jump ahead to "interesting" tasks in later sprints
- If blocked, mark task with issue and move to next task in SAME sprint

**End of Session**:

- Update CURRENT_WORK.md with "Last worked on: Sprint X, Task Y"
- Mark completed tasks with [x] in ROADMAP.md
- Commit and push changes

**Resist Shiny Objects**:

- If your brain says "Let's design the cognitive architecture"
- Check ROADMAP.md: Is Phase 1 complete? Is Phase 2 complete?
- If no → Write the idea in Icebox, close the thought, resume current sprint

### Why This Order Matters

**Phase 1 is complete** - BYOK enabled public beta launch.

**Phase 2 builds on Phase 1**:

- Voice features expensive → Users have their own API keys now
- V2 feature parity → Retention requires stable billing model
- Polish features → Need production usage data to know what to polish

**Phase 3 requires real data**:

- OpenMemory is a massive rewrite → Test against real user conversations
- Agentic features → Need to understand actual usage patterns first
- Advanced features → Build when you have users asking for them

**DON'T**:

- ❌ Start OpenMemory before Phase 2 is done
- ❌ Design sophisticated architectures before basic features work
- ❌ Optimize before you have users
- ❌ Build "nice to have" features when quick wins remain

**DO**:

- ✅ Follow the roadmap order strictly
- ✅ Ship early, iterate based on user feedback
- ✅ Write tests as safety net before refactoring

## Tech Stack

### Core Technologies

- **Language**: TypeScript (all services)
- **Runtime**: Node.js 20+
- **Package Manager**: pnpm 8+ (workspaces)
- **Discord**: Discord.js 14.x

### Microservices Architecture

- **bot-client**: Discord.js client + webhook management
- **api-gateway**: Express HTTP API + BullMQ queue
- **ai-worker**: AI processing + pgvector memory

### Infrastructure

- **Database**: PostgreSQL (user data, conversation history, vector memory via pgvector)
- **Queue**: Redis + BullMQ (job processing)
- **Deployment**: Railway (all services)

### AI Providers

- **Primary**: OpenRouter (400+ models)
- **Alternative**: Direct Gemini API
- **Architecture**: Vendor-agnostic provider abstraction

## Claude Code Skills

Tzurot v3 includes 12 project-specific Claude Code Skills in `.claude/skills/` that streamline development workflows and codify best practices.

### Available Skills

**Core Development Skills:**

1. **tzurot-testing** - Vitest patterns, fake timers, promise handling, mocking strategies,
   colocated tests
2. **tzurot-constants** - Magic numbers elimination, domain-separated organization,
   centralization rules
3. **tzurot-git-workflow** - Rebase-only strategy, PR creation against develop,
   commit format, safety checks
4. **tzurot-security** - Secret management, AI-specific security (prompt injection,
   PII scrubbing), Economic DoS prevention, Discord permissions, microservices security,
   supply chain integrity

**Architecture & Design Skills:**

1. **tzurot-architecture** - Microservices boundaries, service responsibilities,
   dependency rules, anti-patterns from v2
2. **tzurot-docs** - Documentation maintenance (CURRENT_WORK.md, folder structure),
   session handoff protocol
3. **tzurot-gemini-collab** - MCP best practices, when to consult Gemini,
   cost optimization, prompt structuring

**Advanced Technical Skills:**

1. **tzurot-shared-types** - Zod schemas, type guards, DTOs, workspace exports,
   runtime validation
2. **tzurot-db-vector** - PostgreSQL patterns, pgvector similarity search,
   connection pooling, migrations
3. **tzurot-async-flow** - BullMQ job queue, Discord interaction deferral,
   idempotency, retry strategies
4. **tzurot-observability** - Structured logging with Pino, correlation IDs,
   privacy considerations, Railway log analysis
5. **tzurot-deployment** - Railway operations, service management, log analysis,
   troubleshooting production issues

### How Skills Work

Skills automatically activate when their topics become relevant during development. They provide:

- **Context-aware guidance** - Relevant patterns and anti-patterns
- **Best practice enforcement** - Codified standards from experience
- **Quick reference** - No need to search through docs
- **Consistency** - Same patterns applied across all development

### Invoking Skills Manually

While skills auto-activate, you can explicitly invoke them using the Skill tool:

```
skill: "tzurot-testing"       # Testing guidance
skill: "tzurot-db-vector"     # Database/pgvector patterns
skill: "tzurot-architecture"  # Service design decisions
```

### Skill Maintenance

**When to update skills:**

- New patterns emerge from production experience
- Post-mortem lessons learned
- Architecture changes
- Tool upgrades (e.g., Vitest version)

**Skills are source-controlled** - Changes go through PR process like code.

## Project Structure

```
tzurot/
├── .claude/                     # Claude Code configuration
│   └── skills/                 # Project-specific skills (12 skills)
│
├── services/                    # Microservices
│   ├── bot-client/             # Discord interface
│   ├── api-gateway/            # HTTP API + job queue
│   └── ai-worker/              # AI processing + memory
│
├── packages/                    # Shared code
│   ├── common-types/           # TypeScript types/interfaces
│   └── api-clients/            # External API clients
│
├── personalities/               # Personality configs (JSON)
│   ├── lilith.json
│   ├── default.json
│   └── sarcastic.json
│
├── tzurot-legacy/              # v2 archived codebase
│
├── prisma/                     # Database schema
├── scripts/                    # Deployment & utility scripts
└── docs/                       # Documentation
```

## Essential Commands

### Development

```bash
# Install dependencies
pnpm install

# Start all services in dev mode
pnpm dev

# Start individual service
pnpm --filter @tzurot/bot-client dev
pnpm --filter @tzurot/api-gateway dev
pnpm --filter @tzurot/ai-worker dev

# Build all services
pnpm build

# Type checking
pnpm typecheck

# Linting
pnpm lint
pnpm lint:fix

# Formatting
pnpm format
```

### Deployment

```bash
# Deploy to Railway (pushes trigger auto-deploy)
git push origin feat/v3-continued

# Check Railway status
railway status

# View logs
railway logs --service api-gateway
railway logs --service ai-worker
railway logs --service bot-client

# Set environment variables
railway variables set KEY=value --service service-name
```

### Database

```bash
# Migrations - see tzurot-db-vector skill for complete workflow
# Quick reference:
npx prisma migrate dev --create-only --name migration_name  # Create
npx prisma migrate deploy                                    # Apply
npx prisma migrate status                                    # Check

# Generate Prisma client
railway run npx prisma generate

# View database
railway run psql
```

**📚 See**: `tzurot-db-vector` skill for the complete migration workflow and checksum troubleshooting

## Standardized Commands - Tzurot v3

**IMPORTANT**: To avoid constantly asking for approval of slightly different command variations, use ONLY these standardized commands:

### Testing

1. **Run all tests**: `pnpm test`
2. **Run specific service tests**: `pnpm --filter @tzurot/ai-worker test`
3. **Run specific file**: `pnpm test -- AudioTranscriptionJob.test.ts`
4. **Check test summary** (shows BOTH passes AND failures): `pnpm test 2>&1 | grep -E "(Test Files|Tests)" | sed 's/\x1b\[[0-9;]*m//g'`
   - This strips ANSI color codes for readability and shows all results (passed, failed, skipped)
   - ALWAYS use this after running tests to verify nothing broke

### Linting

1. **Lint all**: `pnpm lint`
2. **Fix issues**: `pnpm lint:fix`

**🚨 CRITICAL: ESLint Configuration**

This project uses **ESLint 9 flat config** (`eslint.config.js`), NOT legacy `.eslintrc.*` files.

- ✅ **Active config**: `eslint.config.js` (flat config format)
- ❌ **No `.eslintrc.json`**: Deleted to prevent confusion - ESLint 9 ignores it anyway

**DO NOT:**

- Create `.eslintrc.json`, `.eslintrc.js`, or any legacy config files
- Add `overrides` sections (that's legacy syntax)
- Reference `.eslintrc.*` patterns in documentation
- Use `ignorePatterns` (use `ignores` array in flat config instead)

**DO:**

- Edit `eslint.config.js` for all ESLint configuration changes
- Use flat config syntax (array of config objects with `files` and `rules`)
- Test files ARE linted with the same rules as production code

### Type Checking

1. **Check all**: `pnpm typecheck`

### Building

1. **Build all**: `pnpm build`
2. **Build specific**: `pnpm --filter @tzurot/bot-client build`

**Note**: This project uses pnpm workspaces, NOT npm. Never use npm commands in this project.

### Timer Patterns (`setTimeout`/`setInterval`)

**⚠️ HORIZONTAL SCALING CONCERN**: `setInterval` creates in-memory state that prevents horizontal scaling. Multiple service instances would each run their own intervals.

**✅ OK Patterns** (use freely):

```typescript
// 1. Request timeouts with AbortController
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);
try {
  const response = await fetch(url, { signal: controller.signal });
} finally {
  clearTimeout(timeout);
}

// 2. One-time delays (retry backoff, startup delays)
await new Promise(resolve => setTimeout(resolve, delayMs));

// 3. Test utilities
await vi.advanceTimersByTimeAsync(1000);
```

**❌ Scaling Blockers** (avoid or migrate):

```typescript
// BAD: Persistent cleanup intervals
this.cleanupInterval = setInterval(() => this.cleanup(), 60000);

// BAD: Reconnection timers without coordination
this.reconnectTimeout = setTimeout(() => this.reconnect(), 5000);
```

**✅ Alternatives for Cleanup/Scheduled Tasks**:

1. **BullMQ Repeatable Jobs** (preferred for this codebase):

   ```typescript
   await queue.add(
     'cleanup-cache',
     {},
     {
       repeat: { every: 60000 }, // Every minute
     }
   );
   ```

2. **Redis-based coordination** (for distributed locks)

3. **External scheduler** (Railway cron, etc.)

**Current Known Scaling Blockers** (tracked for future migration):

- `BaseConfigResolver.ts` - cache cleanup interval (used by LlmConfigResolver and PersonaResolver)
- `WebhookManager.ts` - webhook cleanup interval
- `DatabaseNotificationListener.ts` - reconnection timeout

**DO NOT USE**:

- Different grep patterns or flags
- Different tail lengths
- Complex piped commands with multiple greps
- Variations with sed, awk, or other tools

If you need something beyond these commands, ask first or add it as a new pnpm script in package.json.

### Scripts (Database & Utility Operations)

The `scripts/` folder is a pnpm workspace package (`@tzurot/scripts`). All new scripts should be TypeScript in `scripts/src/`:

**Database Operations:**

```bash
# Check for migration drift (checksums don't match)
pnpm --filter @tzurot/scripts run db:check-drift

# Fix drifted migrations
pnpm --filter @tzurot/scripts run db:fix-drift -- <migration_name> [<migration_name> ...]
```

**Why this approach:**

- Uses `tsx` which handles ESM/CJS interop automatically (no more `.mjs` vs `.cjs` confusion)
- Proper workspace dependency on `@tzurot/common-types` for Prisma access
- TypeScript provides type safety and better AI assistance

**Writing new scripts:** Use `scripts/src/db/check-migration-drift.ts` as a template:

1. Import from `@tzurot/common-types` (e.g., `getPrismaClient`, `disconnectPrisma`)
2. Use async/await with proper error handling
3. Always call `disconnectPrisma()` in `finally` block

**Note:** Legacy scripts in subdirectories (`git/`, `deployment/`, etc.) still use shell scripts or older patterns.

## Architecture

### Microservices Flow

```
Discord User
    ↓
bot-client (Discord.js)
    ↓ HTTP
api-gateway (Express + BullMQ)
    ↓ Redis Queue
ai-worker (AI + pgvector)
    ↓
OpenRouter/Gemini API
```

### Key Design Principles

1. **No DDD** - v2's DDD architecture was over-engineered. v3 uses simple, clean classes.
2. **Vendor Independence** - AI provider abstraction layer prevents vendor lock-in
3. **TypeScript First** - Full type safety across all services
4. **Microservices** - Each service has single responsibility
5. **Long-term Memory** - pgvector for personality memory across conversations

### Service Responsibilities

**bot-client**:

- Discord message events
- Webhook management (unique avatar/name per personality)
- Message formatting and chunking
- Slash command registration

**api-gateway**:

- HTTP API endpoints
- Job creation in BullMQ queue
- Request validation
- BYOK credential management (encrypted API key storage)

**ai-worker**:

- Job processing from queue
- pgvector memory retrieval
- AI provider integration (OpenRouter/Gemini)
- Conversation history management
- Response generation

### 🚨 Gateway Client Usage (CRITICAL)

**NEVER use direct `fetch()` calls to the API gateway.** Always use the established gateway clients.

**Why this matters**: Using direct fetch with wrong headers caused a major production regression where /character commands couldn't find any personalities. Tests didn't catch it because they mocked at too high a level.

**Available Gateway Clients** (in `bot-client/src/utils/`):

| Client                             | Purpose                     | Headers Added                 | When to Use                                                |
| ---------------------------------- | --------------------------- | ----------------------------- | ---------------------------------------------------------- |
| `callGatewayApi()`                 | User-authenticated requests | `X-User-Id`, `X-Service-Auth` | Any `/user/*` endpoint                                     |
| `adminFetch()` / `adminPostJson()` | Admin-only requests         | `X-Service-Auth`              | Any `/admin/*` endpoint (add `X-Owner-Id` header manually) |
| `GatewayClient`                    | Internal service requests   | `X-Service-Auth`              | Service-to-service communication                           |

**Examples:**

```typescript
// ✅ CORRECT - User endpoint
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const result = await callGatewayApi<ResponseType>('/user/personality', {
  userId: interaction.user.id,
  method: 'POST',
  body: data,
});

// ✅ CORRECT - Admin endpoint
import { adminFetch } from '../../utils/adminApiClient.js';

const response = await adminFetch('/admin/personality', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Owner-Id': interaction.user.id,
  },
  body: JSON.stringify(payload),
});

// ❌ WRONG - Direct fetch (caused production bug!)
const response = await fetch(`${config.GATEWAY_URL}/user/personality`, {
  headers: {
    'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
    'X-Discord-User-Id': userId, // WRONG HEADER NAME!
  },
});
```

**Header Reference:**

- `X-User-Id` - Required for user-authenticated endpoints (NOT `X-Discord-User-Id`)
- `X-Owner-Id` - Required for admin endpoints (bot owner verification)
- `X-Service-Auth` - Required for all internal service calls

## Current Features (Development Deployment)

### ✅ Working in Dev Deployment

- @personality mentions (@lilith, @default, @sarcastic)
- Reply detection (reply to bot to continue conversation)
- Webhook management (unique appearance per personality)
- Message chunking (Discord 2000 char limit)
- Conversation history tracking
- Long-term memory (pgvector)
- Image attachment support
- Voice transcription support
- Model indicator in responses
- Persistent typing indicators
- Basic slash commands (/ping, /help)

### 📋 Not Yet Ported from v2

- Auto-response (activated channels)
- Full slash command suite
- Rate limiting
- NSFW verification
- Request deduplication

### ✅ Public Production Launch Status

**Completed**:

- ✅ **BYOK (Bring Your Own Key)**: User-provided API keys via `/wallet` commands
- ✅ **Guest Mode**: Free model fallback for users without API keys
- ✅ **Vision Fallback Tiering**: Guest users get free vision models, BYOK users get paid models
- ✅ **Admin Commands**: Bot owner management utilities (`/admin servers`, `/admin kick`, `/admin usage`)

## Code Style - Tzurot v3

**TypeScript Style**:

- 2 spaces indentation
- Single quotes
- Semicolons
- 100 character line limit
- camelCase for variables/functions
- PascalCase for classes/types

**File Organization**:

- One class per file
- Export at bottom of file
- Imports grouped: external, then internal
- Types/interfaces in separate files when shared

**Logging**:

- Use Pino logger from @tzurot/common-types
- Structure: `logger.info({ context }, 'message')`
- Never log secrets/tokens or PII

**📚 See**: `tzurot-observability` skill for structured logging patterns, correlation IDs, privacy considerations, and Railway log analysis

**Type Centralization**:

- **ALWAYS define reusable types in `common-types` package IMMEDIATELY** - Don't let duplication happen
- If a type/type guard might be used in >1 service, put it in common-types right away

**📚 See**: `tzurot-shared-types` skill for Zod schemas, type guards, DTOs, and workspace exports

**Constants and Magic Numbers**:

- **NO magic numbers or strings** - Use named constants from `@tzurot/common-types/constants`
- **Domain-separated constants**: Constants live in `packages/common-types/src/constants/` organized by domain (ai, timing, queue, discord, error, media, message, service)
- **Import pattern**: `import { TIMEOUTS, INTERVALS, REDIS_KEY_PREFIXES } from '@tzurot/common-types'`
- **Naming convention**: `SCREAMING_SNAKE_CASE` with JSDoc comments

**📚 See**: `tzurot-constants` skill for when to create constants, domain organization details, and migration patterns

## Folder Structure Standards

> **📁 ALWAYS FOLLOW**: See [docs/standards/FOLDER_STRUCTURE.md](docs/standards/FOLDER_STRUCTURE.md) for comprehensive folder structure and file naming standards.

**Quick Reference**:

- ✅ **Root directory**: ≤5 files (index.ts + config files only)
- ✅ **Standard folders**: `services/`, `utils/`, `types/`, domain-specific folders
- ✅ **No single-file folders**: Merge into parent or wait until ≥2 files
- ✅ **File naming**: PascalCase for classes, camelCase for utilities
- ✅ **Folder naming**: Always plural (`services/` not `service/`)
- ❌ **No `-utils.ts` suffix in root**: Use `utils/` folder instead

**Common Anti-Patterns**:

- Root file bloat (15 files in common-types was too many!)
- Single-file folders (context/, gateway/, webhooks/ with 1 file each)
- Inconsistent naming (mix of PascalCase and camelCase)
- Functions in constants files (use utils/ instead)

See the full documentation for detailed examples and migration guidance.

## Git Workflow

### 🚨 CRITICAL: Rebase-Only Workflow

**THIS PROJECT USES REBASE-ONLY. NO SQUASH. NO MERGE. ONLY REBASE.**

GitHub repository settings enforce this (rebase and merge is the ONLY option enabled).

### 🚨 CRITICAL: Always Target `develop` for PRs

**NEVER create PRs directly to `main`!**

- ✅ **Feature PRs → `develop`** (v3 is still in testing)
- ❌ **Feature PRs → `main`** (only for releases)

```bash
# ✅ CORRECT
gh pr create --base develop --title "feat: your feature"
```

### Branch Strategy

- `main` - Production releases only (v3 not ready yet)
- `develop` - Active development branch (current v3 work)
- Feature branches from `develop` (prefixes: `feat/`, `fix/`, `docs/`, `refactor/`)

### Commit Messages

Format: `type: description` (e.g., `feat: add voice transcription support`)

### Deployment Flow

1. Merge PR to `develop` → Railway auto-deploys
2. Check health endpoint: https://api-gateway-development-83e8.up.railway.app/health
3. Monitor logs via `railway logs`

**📚 See**: `tzurot-git-workflow` skill for complete PR workflow, rebase conflict handling, commit format details, and git safety protocol

### Git Hooks

**🚨 CRITICAL: Pre-commit hooks are source-controlled in `./hooks/` NOT `.git/hooks/`**

- **Source-controlled location**: `./hooks/pre-commit` (tracked in git)
- **Installed location**: `.git/hooks/pre-commit` (NOT tracked in git)
- **ALWAYS update**: `./hooks/pre-commit` (the source-controlled version)
- **NEVER edit**: `.git/hooks/pre-commit` directly (will not persist in repository)

**Installation script**: `./scripts/git/install-hooks.sh` copies hooks from `./hooks/` to `.git/hooks/`

When modifying pre-commit checks:

1. Edit `./hooks/pre-commit` (source-controlled)
2. Run `./scripts/git/install-hooks.sh` to install updated hook locally
3. Commit and push `./hooks/pre-commit` changes

New developers should run `./scripts/git/install-hooks.sh` after cloning the repository.

## Environment Variables

### Required for bot-client

- `DISCORD_TOKEN` - Discord bot token
- `GATEWAY_URL` - API gateway URL (Railway provides)

### Required for api-gateway

- `REDIS_URL` - Redis connection (Railway provides)
- `DATABASE_URL` - PostgreSQL connection (Railway provides)

### Required for ai-worker

- `REDIS_URL` - Redis connection
- `DATABASE_URL` - PostgreSQL connection (includes pgvector for vector memory)
- `AI_PROVIDER` - "openrouter" or "gemini"
- `OPENROUTER_API_KEY` - OpenRouter key (if using)
- `GEMINI_API_KEY` - Gemini key (if using)
- `OPENAI_API_KEY` - For embeddings

## Testing

**Framework**: Vitest 4.0.3 with comprehensive test coverage

**Current Status**: Run `pnpm test` to see current test counts.

**Key Standards**:

- **Colocated tests**: `MyService.test.ts` next to `MyService.ts`
- **Always run tests before pushing**: `pnpm test` (no exceptions!)
- Test behavior, not implementation
- Mock all external dependencies
- Use fake timers for time-based code

### Coverage

**Provider**: v8 (via `@vitest/coverage-v8`)

**Coverage files are NOT committed** - `coverage/` is in `.gitignore`. Each service generates its own coverage report in `<service>/coverage/`.

**Commands** (run from project root):

| Command                                            | Description                            |
| -------------------------------------------------- | -------------------------------------- |
| `pnpm test:coverage`                               | Run coverage for ALL services/packages |
| `pnpm --filter @tzurot/api-gateway test:coverage`  | Coverage for specific service          |
| `pnpm --filter @tzurot/bot-client test:coverage`   | Coverage for bot-client                |
| `pnpm --filter @tzurot/ai-worker test:coverage`    | Coverage for ai-worker                 |
| `pnpm --filter @tzurot/common-types test:coverage` | Coverage for common-types              |

**Reading coverage output**:

- **Console**: Text summary with % Stmts, % Branch, % Funcs, % Lines columns
- **HTML**: Open `<service>/coverage/index.html` in browser for detailed view
- **JSON**: `<service>/coverage/coverage-final.json` for programmatic access

**Important notes**:

- Running `pnpm test:coverage` generates **separate** reports per service (not a unified report)
- Coverage runs are slower than regular tests
- Look for files with <70% statement coverage as priority for improvement

**📚 See**: `tzurot-testing` skill for comprehensive Vitest patterns, fake timer handling, promise rejection patterns, and mocking strategies

**Resources**:

- [Testing Guide](docs/guides/TESTING.md) - Comprehensive testing patterns
- [Global Testing Philosophy](~/.claude/CLAUDE.md#universal-testing-philosophy) - Universal principles

## Security

### 🚨 NEVER COMMIT SECRETS - CRITICAL

**This has happened TWICE in this project. Always verify before committing.**

**Never commit:**

- Database URLs (PostgreSQL, Redis) - contain passwords
- API keys or tokens (Discord, OpenRouter, Gemini, OpenAI)
- Private keys, session secrets, webhook URLs with tokens
- Real user data in test files
- `.env` files (use `.env.example`)

**Always use:**

- Environment variables for all secrets
- Railway's secrets management for production
- Placeholders in documentation (`DATABASE_URL="your-database-url-here"`)

**Pre-commit check:**

```bash
git diff --cached | grep -iE '(password|secret|token|api.?key|postgresql://|redis://)'
```

**If you commit a secret:** Rotate it immediately (don't just delete and recommit).

**📚 See**: `tzurot-security` skill for comprehensive security patterns including:

- Secret rotation protocol
- AI-specific security (prompt injection, PII scrubbing, output sanitization)
- Economic DoS prevention (token budgeting)
- Discord permission verification
- Signed internal payloads (BullMQ)
- Content validation for attachments
- Supply chain security (dependency auditing, pinning)

## Project Post-Mortems & Lessons Learned (v3 Development)

> **Note**: Universal principles from these incidents have been promoted to `~/.claude/CLAUDE.md`. This section documents project-specific context and full incident details.

### 2025-07-25 - The Untested Push Breaking Develop

**What Happened**: Made "simple" linter fixes to timer patterns in rateLimiter.js and pushed without running tests

**Impact**:

- Broke the develop branch
- All tests failing
- Required emergency reverts
- Blocked other development work

**Root Cause**:

- Assumed "simple" refactors don't need testing
- Changed module-level constants that tests relied on
- Didn't realize tests depended on Jest's ability to mock inline functions

**Prevention Measures Added**:

1. ALWAYS run tests before pushing (no exceptions for "simple" changes)
2. Timer pattern fixes need corresponding test updates
3. When changing core utilities, run their specific test suite first
4. Module-level constants: verify tests can still mock them

**Universal Lesson**: Added to user-level CLAUDE.md - "Before ANY Push to Remote" rules

---

### 2025-07-21 - The Git Restore Catastrophe

**What Happened**: User said "get all the changes on that branch" - I ran `git restore .` and destroyed hours of uncommitted work on the database schema and interaction logic.

**Impact**:

- Lost approximately 4 hours of development work
- Ruined user's entire evening
- Required painful reconstruction from console history
- Affected user's personal life due to stress

**Root Cause**:

- Misunderstood "get changes on branch" as "discard changes" instead of "commit changes"
- Made destructive assumption without asking for clarification
- Failed to recognize that uncommitted changes represent hours of valuable work

**Prevention Measures Added**:

1. **When user says "get changes on branch"** → They mean COMMIT them, not DISCARD them
2. **ALWAYS ask before ANY git command that discards work**:
   - `git restore` → "This will discard changes. Do you want to commit them first?"
   - `git reset` → "This will undo commits/changes. Are you sure?"
   - `git clean` → "This will delete untracked files. Should I list them first?"
3. **Uncommitted changes = HOURS OF WORK** → Treat them as sacred
4. **When in doubt** → ASK, don't assume

**Universal Lesson**: The core principle "Always confirm before destructive Git commands" was promoted to user-level CLAUDE.md as a permanent, universal rule.

---

### 2025-10-31 - Database URL Committed to Git History

**What Happened**: Committed PostgreSQL database URL (with password) to git history, requiring immediate secret rotation.

**Prevention**:

- **NEVER** commit database URLs - they contain passwords
- **NEVER** commit connection strings for PostgreSQL, Redis, etc.
- **ALWAYS** use environment variables or placeholders in scripts
- **ALWAYS** review commits for credentials before pushing
- Database URL format contains password: `postgresql://user:PASSWORD@host:port/db`
- Even in bash command examples, use `$DATABASE_URL` not raw URLs

---

### 2025-07-16 - DDD Authentication Migration Broke Core Features

**What Happened**: DDD refactor changed return values and broke AI routing (45+ test failures).

**Prevention**:

- Test actual behavior, not just unit tests
- Verify API contracts remain unchanged
- Check return value formats match exactly
- Run full integration tests after refactors

---

### 2025-12-05 - Direct Fetch Calls Broke Character Commands

**What Happened**: The /character commands (edit, view, list, create) couldn't find any personalities. Users got "character not found" for all their own characters.

**Impact**:

- All /character functionality broken in production
- Users unable to manage their AI personalities
- Confusion and frustration for users
- Required emergency investigation and fix

**Root Cause**:

- Character commands used direct `fetch()` calls instead of the established `callGatewayApi` utility
- Wrong header name: `X-Discord-User-Id` instead of `X-User-Id`
- API gateway couldn't authenticate users → returned 403/empty results
- Tests mocked at high level (`callGatewayApi`) so didn't catch the actual HTTP issues
- No tests existed for the internal fetch functions

**Why It Wasn't Caught**:

- Autocomplete used `callGatewayApi` (correct) → worked fine, giving false confidence
- Character CRUD used direct `fetch` (wrong) → silently failed auth
- Unit tests mocked too broadly, never tested actual headers
- No integration tests that verified HTTP headers

**Prevention Measures Added**:

1. Added "Gateway Client Usage (CRITICAL)" section to CLAUDE.md
2. Documented the THREE gateway clients and when to use each
3. Clear examples of ✅ correct vs ❌ wrong patterns
4. Header reference: `X-User-Id` NOT `X-Discord-User-Id`
5. Refactored character commands to use `callGatewayApi` (already tested)

**Universal Lesson**: When established utilities exist, USE THEM. Don't reinvent direct calls.

---

### Why v3 Abandoned DDD

**Lesson**: DDD was over-engineered for a one-person project. It caused:

- Circular dependency issues
- Excessive abstraction layers
- Complex bootstrap/wiring
- More time fixing architecture than building features

**v3 Approach**: Simple classes, constructor injection, clear responsibilities. Ship features, not architecture.

## Documentation Structure

**Organization:** All documentation is in `docs/` organized by category. See [docs/README.md](docs/README.md) for the full structure guide.

**Key directories:**

- `docs/architecture/` - Design decisions and technical patterns
- `docs/deployment/` - Railway deployment and infrastructure
- `docs/guides/` - Developer how-tos (setup, testing)
- `docs/migration/` - Data migration procedures
- `docs/planning/` - Project roadmaps and feature tracking
- `docs/features/` - Feature specifications
- `docs/improvements/` - Enhancement proposals
- `docs/operations/` - Operational procedures (backups, monitoring)
- `docs/reference/` - Reference docs (CLI, APIs)
- `docs/templates/` - Reusable document templates

**When creating docs:**

- Follow the categorization in [docs/README.md](docs/README.md)
- Update EXISTING docs instead of creating new ones when possible
- Use descriptive names: `memory-and-context-redesign.md` not `memory.md`
- Keep the root clean - only `README.md`, `CLAUDE.md`, `CURRENT_WORK.md`, `ROADMAP.md` belong there

## Documentation Maintenance

**Purpose**: Track active work and provide context for AI sessions (critical for solo dev + AI workflow)

**Key Documents**:

- **CURRENT_WORK.md** - Active work, recent completions, next planned work
- **docs/** - Organized by category (see docs/README.md)
- **GitHub Releases** - Release history and notable changes (https://github.com/lbds137/tzurot/releases)

**Update CURRENT_WORK.md at:**

- Start of session (read to understand context)
- End of major milestone (document completion)
- Switching focus areas (update direction)

**📚 See**: `tzurot-docs` skill for CURRENT_WORK.md format, session handoff protocol, documentation organization, and maintenance guidelines

## Key Documentation

### Always Relevant

- [CURRENT_WORK.md](CURRENT_WORK.md) - Current project status
- [README.md](README.md) - v3 overview and quick start
- [docs/deployment/RAILWAY_DEPLOYMENT.md](docs/deployment/RAILWAY_DEPLOYMENT.md) - Railway deployment guide
- [docs/planning/V2_FEATURE_TRACKING.md](docs/planning/V2_FEATURE_TRACKING.md) - What's ported vs. not

### Development Guides

- [docs/guides/DEVELOPMENT.md](docs/guides/DEVELOPMENT.md) - Local development setup
- [docs/architecture/ARCHITECTURE_DECISIONS.md](docs/architecture/ARCHITECTURE_DECISIONS.md) - Why v3 is designed this way

### Planning & Roadmap

- [docs/planning/V3_REFINEMENT_ROADMAP.md](docs/planning/V3_REFINEMENT_ROADMAP.md) - Prioritized improvement roadmap
- [docs/planning/gemini-code-review.md](docs/planning/gemini-code-review.md) - Comprehensive code review

### For AI Assistants

- This file (CLAUDE.md) - Project-specific rules
- ~/.claude/CLAUDE.md - Universal rules (personality, coding style, safety)

## Railway Deployment Details

**Project**: industrious-analysis (development environment)

**Status**: Public beta - BYOK implemented, guest mode available for users without API keys

**Services**:

- api-gateway: https://api-gateway-development-83e8.up.railway.app
- ai-worker: (internal only)
- bot-client: (internal only)

**Databases**:

- PostgreSQL (Railway addon)
- Redis (Railway addon)
- PostgreSQL with pgvector extension

**Deployment**:

- Auto-deploys from GitHub on push to `feat/v3-continued`
- Each service has own Dockerfile
- Environment variables managed via Railway CLI or dashboard

**Cost Model**: BYOK is implemented - users provide their own API keys via `/wallet` commands. Guest users without keys get free models only.

## Common Operations

### Adding a New Personality

1. Create `personalities/name.json`:
   ```json
   {
     "name": "PersonalityName",
     "systemPrompt": "Your personality description...",
     "model": "anthropic/claude-sonnet-4.5",
     "temperature": 0.8,
     "avatar": "https://example.com/avatar.png"
   }
   ```
2. Commit and push (Railway auto-deploys)
3. Bot auto-loads new personality on restart

### Checking Service Health

```bash
# API Gateway health
curl https://api-gateway-development-83e8.up.railway.app/health

# Check logs
railway logs --service api-gateway --tail 50
railway logs --service ai-worker --tail 50
railway logs --service bot-client --tail 50
```

### Debugging Production Issues

1. Check service logs first: `railway logs --service <name>`
2. Verify environment variables: `railway variables --service <name>`
3. Check health endpoint (api-gateway only)
4. Look for error patterns in logs
5. Check Railway dashboard for service status

## Tool Permissions

### Approved (No Permission Needed)

- `pnpm` commands (install, dev, build, test, lint)
- File operations (read, write, edit)
- Search tools (grep, glob, search)
- Railway CLI read operations (status, logs, variables)
- Git read operations (status, diff, log)

### Requires Approval

- `pnpm add/remove` (changing dependencies)
- Railway write operations (deploy, variables set)
- Git write operations (commit, push, branch delete)
- Database migrations
- Modifying package.json dependencies

## Getting Help

**For the user**:

- GitHub Issues: https://github.com/anthropics/claude-code/issues
- `/help` command in Claude Code

**For AI assistants**:

- When unsure: Check CURRENT_WORK.md for current focus
- When stuck: Look at similar patterns in the codebase
- When confused: Ask user for clarification rather than guessing
