# Tzurot v3 - Project Configuration

@~/.claude/CLAUDE.md

> **📍 ALWAYS CHECK FIRST**: Read [CURRENT_WORK.md](CURRENT_WORK.md) to understand what's actively being worked on and which documentation is currently relevant.

> **🚂 RAILWAY CLI REFERENCE**: Before running ANY `railway` command, consult [docs/reference/RAILWAY_CLI_REFERENCE.md](docs/reference/RAILWAY_CLI_REFERENCE.md) to avoid errors from outdated AI training data. This reference has accurate, tested commands for Railway CLI 4.5.3.

> **⚠️ IMPORTANT**: v3 is deployed on Railway in a development environment for private testing. NOT open to public yet - requires BYOK implementation to prevent unexpected API costs.

## Project Overview

Tzurot is a Discord bot with multiple AI personalities powered by a microservices architecture. Users interact with different personalities through @mentions, and each personality maintains long-term memory via vector database.

**Project Context**: This is a **one-person project** developed and maintained by a single developer with AI assistance. Avoid team-oriented language and assumptions.

**Why v3 Exists**: Shapes.inc (the AI API provider for v2) shut down, forcing a complete rewrite. v3 is vendor-agnostic and uses modern patterns.

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

## Project Structure

```
tzurot/
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
# Run migrations
railway run npx prisma migrate dev

# Generate Prisma client
railway run npx prisma generate

# View database
railway run psql
```

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
- (Future: BYOK credential management)

**ai-worker**:
- Job processing from queue
- pgvector memory retrieval
- AI provider integration (OpenRouter/Gemini)
- Conversation history management
- Response generation

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

### 🚧 Required for Public Production Launch
**Critical blockers**:
- **BYOK (Bring Your Own Key)**: User-provided API keys to prevent bot owner paying all costs
- **Admin Commands**: Bot owner needs ability to manage servers
  - `/admin servers` - List all servers bot is in
  - `/admin kick <server_id>` - Remove bot from servers
  - `/admin usage` - Monitor API costs
- Without these, random users can rack up expensive API bills

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
- Never log secrets/tokens
- See privacy logging guide for user data

## Git Workflow

### 🚨 CRITICAL: Rebase-Only Workflow

**THIS PROJECT USES REBASE-ONLY. NO SQUASH. NO MERGE. ONLY REBASE.**

GitHub repository settings enforce this:
- ✅ **Rebase and merge** - ONLY option enabled
- ❌ **Squash and merge** - DISABLED
- ❌ **Create a merge commit** - DISABLED

**Why this matters**: Squash/merge creates duplicate commits with different hashes, causing rebase conflicts and confusion.

### 🚨 CRITICAL: Always Target `develop` for PRs

**NEVER create PRs directly to `main`!**

- ✅ **Feature PRs → `develop`** (v3 is still in testing)
- ❌ **Feature PRs → `main`** (only for releases)

**Example PR creation**:
```bash
# ✅ CORRECT - Always target develop
gh pr create --base develop --title "feat: your feature"

# ❌ WRONG - Don't target main for features!
gh pr create --base main --title "feat: your feature"
```

### Branch Strategy
- `main` - Production releases only (v3 not ready yet)
- `develop` - Active development branch (current v3 work)
- Feature branches from `develop`

**Common branch prefixes**:
- `feat/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring

### Commit Messages
```bash
# Format: type: description
feat: add voice transcription support
fix: prevent message chunks exceeding 2000 chars
chore: update dependencies
docs: update deployment guide
```

### Standard PR Workflow

1. **Create feature branch from develop**:
```bash
git checkout develop
git pull origin develop
git checkout -b feat/your-feature
```

2. **Make changes and commit**:
```bash
# Make changes
git add .
git commit -m "feat: your changes"
```

3. **Push and create PR to develop**:
```bash
git push -u origin feat/your-feature
gh pr create --base develop --title "feat: your feature"
```

4. **After PR is merged**:
```bash
git checkout develop
git pull origin develop  # This gets the rebased commits
git branch -d feat/your-feature  # Clean up local branch
```

### Handling Rebase Conflicts

If you need to rebase your feature branch onto latest develop:

```bash
git checkout develop
git pull origin develop
git checkout feat/your-feature
git rebase develop  # May need to resolve conflicts
git push --force-with-lease origin feat/your-feature
```

**Important**: GitHub will automatically update the PR when you force-push.

### Deployment Flow
1. Merge PR to `develop` branch
2. Railway auto-deploys from GitHub
3. Check health endpoint: https://api-gateway-development-83e8.up.railway.app/health
4. Monitor logs via `railway logs`

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

**Current Status**:
- ✅ **368 tests passing** (218 api-gateway + 150 ai-worker)
- ✅ Utility functions fully tested
- ✅ Error handling and retry utilities with 45 tests
- 🚧 Service layer coverage expanding
- 🚧 Integration tests planned

**Key Resources**:
- **[Testing Guide](docs/guides/TESTING.md)** - Comprehensive testing patterns and best practices
- **[Global Testing Philosophy](~/.claude/CLAUDE.md#universal-testing-philosophy)** - Universal testing principles

**Important Patterns**:
- Always run tests before pushing (`pnpm test`)
- Test behavior, not implementation
- Mock all external dependencies
- Use fake timers for time-based code
- See Testing Guide for promise rejection patterns with fake timers

**Next Steps**: Service layer tests, integration tests for service communication

## Security

### 🚨 NEVER COMMIT THESE - CRITICAL SECURITY VIOLATIONS

**Database Connection Strings**:
- **NEVER** commit PostgreSQL URLs (format: `postgresql://user:PASSWORD@host:port/db`)
- **NEVER** commit Redis URLs (format: `redis://user:PASSWORD@host:port`)
- **NEVER** commit PostgreSQL connection strings
- Database URLs contain passwords - committing them = immediate secret rotation required
- **ALWAYS** use environment variables or Railway secrets for connection strings
- **ALWAYS** use placeholders like `DATABASE_URL="your-database-url-here"` in examples

**Other Secrets**:
- API keys or tokens (Discord, OpenRouter, Gemini, OpenAI)
- Real user data in test files
- `.env` files (use `.env.example`)
- Any credential or authentication token

### Always Use
- Environment variables for all secrets
- Railway's secrets management
- Privacy-conscious logging (no PII)
- Placeholders in documentation and examples

## Lessons Learned (v2 → v3)

### 2025-07-25 - The Untested Push Breaking Develop
**What Happened**: Made "simple" linter fixes and pushed without testing, broke the develop branch.

**Prevention**:
- ALWAYS run tests before pushing (even for "simple" changes)
- If tests don't exist, manually test the feature
- Never assume simple refactors don't need testing

### 2025-10-31 - Database URL Committed to Git History
**What Happened**: Committed PostgreSQL database URL (with password) to git history, requiring immediate secret rotation.

**Prevention**:
- **NEVER** commit database URLs - they contain passwords
- **NEVER** commit connection strings for PostgreSQL, Redis, etc.
- **ALWAYS** use environment variables or placeholders in scripts
- **ALWAYS** review commits for credentials before pushing
- Database URL format contains password: `postgresql://user:PASSWORD@host:port/db`
- Even in bash command examples, use `$DATABASE_URL` not raw URLs

### 2025-07-21 - The Git Restore Catastrophe
**What Happened**: Ran `git restore .` thinking it would "get changes from branch" but it DESTROYED hours of uncommitted work.

**Prevention**:
- "Get changes on branch" means COMMIT them, not DISCARD them
- ALWAYS ask before ANY git command that discards work
- Uncommitted changes = HOURS OF WORK - treat them as sacred
- When in doubt, ASK

### 2025-07-16 - DDD Authentication Migration Broke Core Features
**What Happened**: DDD refactor changed return values and broke AI routing (45+ test failures).

**Prevention**:
- Test actual behavior, not just unit tests
- Verify API contracts remain unchanged
- Check return value formats match exactly
- Run full integration tests after refactors

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
- `docs/archive/` - Completed/obsolete documentation

**When creating docs:**
- Follow the categorization in [docs/README.md](docs/README.md)
- Update EXISTING docs instead of creating new ones when possible
- Use descriptive names: `memory-and-context-redesign.md` not `memory.md`
- Keep the root clean - only `README.md`, `CHANGELOG.md`, `CLAUDE.md`, `CURRENT_WORK.md` belong there

## Documentation Maintenance

**Important**: When switching work focus:
1. Update `CURRENT_WORK.md` with new focus
2. Update relevant doc timestamps
3. Archive outdated docs to `docs/archive/`

## Key Documentation

### Always Relevant
- [CURRENT_WORK.md](CURRENT_WORK.md) - Current project status
- [README.md](README.md) - v3 overview and quick start
- [docs/deployment/DEPLOYMENT.md](docs/deployment/DEPLOYMENT.md) - Railway deployment guide
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

**Status**: Private testing only - NOT open to public (no BYOK yet)

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

**Cost Warning**: All API usage currently on bot owner's account. Random users could cause expensive bills without BYOK.

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
