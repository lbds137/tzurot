# Tzurot v3 - Project Configuration

@~/.claude/CLAUDE.md

> **📍 ALWAYS CHECK FIRST**: Read [CURRENT_WORK.md](CURRENT_WORK.md) to understand what's actively being worked on and which documentation is currently relevant.

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
- **ai-worker**: AI processing + Qdrant vector memory

### Infrastructure
- **Database**: PostgreSQL (user data, conversation history)
- **Vector DB**: Qdrant (long-term personality memory)
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
ai-worker (AI + Qdrant)
    ↓
OpenRouter/Gemini API
```

### Key Design Principles

1. **No DDD** - v2's DDD architecture was over-engineered. v3 uses simple, clean classes.
2. **Vendor Independence** - AI provider abstraction layer prevents vendor lock-in
3. **TypeScript First** - Full type safety across all services
4. **Microservices** - Each service has single responsibility
5. **Long-term Memory** - Qdrant vector DB for personality memory across conversations

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
- Qdrant memory retrieval
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
- Long-term memory (Qdrant vectors)
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

### Branch Strategy
- `main` - Production releases only
- `feat/v3-continued` - Current v3 development branch
- Feature branches from `feat/v3-continued`

### Commit Messages
```bash
# Format: type: description
feat: add voice transcription support
fix: prevent message chunks exceeding 2000 chars
chore: update dependencies
docs: update deployment guide
```

### Deployment Flow
1. Push to `feat/v3-continued` branch
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
- `DATABASE_URL` - PostgreSQL connection
- `QDRANT_URL` - Qdrant cloud URL
- `QDRANT_API_KEY` - Qdrant API key
- `AI_PROVIDER` - "openrouter" or "gemini"
- `OPENROUTER_API_KEY` - OpenRouter key (if using)
- `GEMINI_API_KEY` - Gemini key (if using)
- `OPENAI_API_KEY` - For embeddings

## Testing

**Note**: Testing infrastructure is being rebuilt for v3. v2 had extensive Jest tests, but v3 is using a different approach.

Current status: Manual testing in production + Railway health checks

Planned: Vitest for unit tests, integration tests for service communication

## Security

### Never Commit
- API keys or tokens
- Real user data in test files
- `.env` files (use `.env.example`)

### Always Use
- Environment variables for secrets
- Railway's secrets management
- Privacy-conscious logging (no PII)

## Lessons Learned (v2 → v3)

### 2025-07-25 - The Untested Push Breaking Develop
**What Happened**: Made "simple" linter fixes and pushed without testing, broke the develop branch.

**Prevention**:
- ALWAYS run tests before pushing (even for "simple" changes)
- If tests don't exist, manually test the feature
- Never assume simple refactors don't need testing

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

## Documentation Maintenance

**Important**: When switching work focus:
1. Update `CURRENT_WORK.md` with new focus
2. Update relevant doc timestamps
3. Archive outdated docs to `docs/archive/`

## Key Documentation

### Always Relevant
- [CURRENT_WORK.md](CURRENT_WORK.md) - Current project status
- [README.md](README.md) - v3 overview and quick start
- [DEPLOYMENT.md](DEPLOYMENT.md) - Railway deployment guide
- [V2_FEATURE_TRACKING.md](V2_FEATURE_TRACKING.md) - What's ported vs. not

### Development Guides
- [DEVELOPMENT.md](DEVELOPMENT.md) - Local development setup
- [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) - Why v3 is designed this way

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
- Qdrant (external cloud service)

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
