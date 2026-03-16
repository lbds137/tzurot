# Tzurot v3

[![codecov](https://codecov.io/gh/lbds137/tzurot/branch/develop/graph/badge.svg)](https://codecov.io/gh/lbds137/tzurot)
[![CI](https://github.com/lbds137/tzurot/workflows/CI/badge.svg)](https://github.com/lbds137/tzurot/actions)

> **🚀 Status**: Public beta - BYOK (Bring Your Own Key) enabled

A modern, scalable Discord bot with customizable AI personalities, powered by microservices architecture with long-term memory.

## Why v3?

Shapes.inc (v2's AI provider) killed their API to force users to their website only, forcing a complete rewrite. v3 is better in every way:

- **Vendor Independence**: Clean abstraction for AI providers (OpenRouter primary)
- **TypeScript + Python**: Full type safety, with a Python FastAPI voice engine
- **True Microservices**: Each service has a single, clear responsibility
- **Long-term Memory**: pgvector for personality memory across conversations
- **Multiple Providers**: OpenRouter (400+ models including free tier), ElevenLabs TTS, local voice engine
- **Clean Architecture**: No over-engineered DDD - just simple, maintainable code

## Architecture

```
+-------------+     +--------------+     +------------+
|  Discord    |---->|  Bot Client  |---->|    API     |
|   Users     |<----|   Service    |<----|  Gateway   |
+-------------+     +--------------+     +-----+------+
                                               |
                                               v
                                         +------------+
                                         |   Queue    |
                                         |  (Redis    |
                                         |  +BullMQ)  |
                                         +-----+------+
                                               |
                                               v
                    +--------------------------+-------------------------+
                    |                                                    |
                    v                                                    v
              +------------+                                      +------------+
              | AI Worker  |------------------------------------->| PostgreSQL |
              |  Service   |                                      | (pgvector) |
              +-----+------+                                      +------------+
                    |
                    +----------+-----------+----------+
                    |          |           |
                    v          v           v
              +----------+ +----------+ +----------+
              | Open     | | Eleven   | |  Voice   |
              | Router   | |  Labs    | |  Engine  |
              | (400+    | |  (TTS)   | | (Python) |
              |  models) | |          | |          |
              +----------+ +----------+ +----------+
```

**Services:**

- **bot-client**: Discord.js interface, webhook management, slash commands
- **api-gateway**: HTTP API, request routing, job queue management
- **ai-worker**: AI processing, memory retrieval, prompt building, response generation
- **voice-engine**: Python FastAPI service for local STT (Parakeet) and TTS (PocketTTS)

**Data Stores:**

- **PostgreSQL + pgvector**: User data, personalities, conversation history, vector embeddings for long-term memory
- **Redis**: BullMQ job queue for async processing, ioredis client

**External APIs:**

- **OpenRouter**: 400+ AI models via unified API (primary provider, includes free models)
- **ElevenLabs**: Text-to-speech with voice cloning (primary TTS provider)
- **Local Embeddings**: Xenova/bge-small-en-v1.5 (384-dim vectors, no API needed)
- **Voice Engine**: Local STT/TTS fallback (NVIDIA Parakeet + PocketTTS, no external API needed)

## Quick Start

### Prerequisites

- Node.js 25+
- pnpm 10+
- Redis (for BullMQ)
- Discord Bot Token
- OpenRouter API Key

### Setup

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Configure environment:**

   ```bash
   cp .env.example .env
   # Edit .env with your tokens and keys
   # Required: DISCORD_TOKEN, DATABASE_URL (PostgreSQL with pgvector)
   # Required: OPENROUTER_API_KEY (for AI responses)
   # Optional: REDIS_URL (Railway provides this automatically)
   # Note: Embeddings use local model (Xenova/bge-small-en-v1.5), no API key needed
   ```

3. **Start services:**

   ```bash
   # Development mode (all services)
   pnpm dev

   # Or start individually:
   pnpm --filter @tzurot/bot-client dev
   pnpm --filter @tzurot/api-gateway dev
   pnpm --filter @tzurot/ai-worker dev
   ```

## Project Structure

- **`services/`** - Microservices
  - `bot-client/` - Discord bot interface (TypeScript)
  - `api-gateway/` - HTTP API and request routing (TypeScript)
  - `ai-worker/` - Background AI processing (TypeScript)
  - `voice-engine/` - Local STT/TTS service (Python FastAPI)
- **`packages/`** - Shared code
  - `common-types/` - TypeScript types, schemas, and shared utilities
  - `embeddings/` - Local embedding model (BGE-small-en-v1.5)
  - `test-utils/` - Shared test helpers and PGLite integration
  - `tooling/` - Ops CLI (`pnpm ops`) and codebase analysis
- **`prisma/`** - Database schema and migrations
- **`scripts/`** - Analysis, debug, and data migration utilities
- **`tzurot-legacy/`** - Archived v2 codebase (for reference)

## AI Provider System

All AI model access goes through OpenRouter's unified API, with model selection configured per-personality via `ModelFactory`. This provides access to 400+ models (including free tier) through a single API key. ElevenLabs provides text-to-speech with voice cloning. A local Python voice engine (Parakeet + PocketTTS) serves as a fallback for STT/TTS without external API dependencies.

## Features

### ✅ Working in Production

- **Multiple Personalities**: @mention different personalities (@lilith, @default, @sarcastic)
- **Reply Detection**: Reply to bot messages to continue conversations
- **Message References**: Reference other messages via Discord links or replies
- **Long-term Memory**: pgvector stores personality memories across sessions
- **Conversation History**: Contextual responses using recent message history
- **Webhook Avatars**: Each personality has unique name and avatar
- **Image Support**: Send images to personalities for analysis
- **Voice Support**: Send voice messages for transcription, text-to-speech with voice cloning
- **Message Chunking**: Automatically handles Discord's 2000 character limit
- **Model Indicators**: Shows which AI model generated each response
- **BYOK (Bring Your Own Key)**: Users provide their own OpenRouter API keys
- **Guest Mode**: Free model access for users without API keys
- **Channel Activation**: Personalities can auto-respond to all messages in a channel
- **NSFW Verification**: Age verification via Discord's native age-gated channels
- **DM Chat**: Chat with personalities in DMs by replying to bot messages
- **Slash Commands** (see details below)

### Slash Commands

**Characters & Personas**

| Command | Subcommands | Purpose |
| --- | --- | --- |
| `/character` | `create` `edit` `view` `browse` | Manage AI characters |
| | `import` `export` `template` | Character portability (JSON) |
| | `chat` `avatar` `voice` `voice-clear` | Interaction and media |
| | `settings` `overrides` | Per-character config and personal overrides |
| `/persona` | `view` `edit` `create` `browse` `default` | User persona management |
| | `override set` `override clear` | Per-character persona overrides |

**Presets & Channels**

| Command | Subcommands | Purpose |
| --- | --- | --- |
| `/preset` | `create` `edit` `browse` | Custom LLM presets (model + parameters) |
| | `export` `import` `template` | Preset portability (JSON) |
| | `global default` `global free-default` | System-wide defaults (owner only) |
| `/channel` | `activate` `deactivate` `browse` `settings` | Channel auto-response management |

**Memory & History**

| Command | Subcommands | Purpose |
| --- | --- | --- |
| `/memory` | `browse` `search` `stats` | Browse and search long-term memories |
| | `delete` `purge` | Memory management operations |
| | `focus enable/disable/status` | Temporarily disable LTM retrieval |
| | `incognito enable/disable/status/forget` | Privacy mode (no LTM writes) |
| `/history` | `clear` `stats` `undo` `hard-delete` | Conversation history management |

**Settings & Tools**

| Command | Subcommands | Purpose |
| --- | --- | --- |
| `/settings` | `timezone set/get` | Timezone for timestamps |
| | `apikey set/browse/remove/test` | BYOK API key management |
| | `preset browse/set/reset/default/clear-default` | Per-character preset overrides |
| | `defaults edit` | User default settings dashboard |
| | `voices browse/delete/clear/model` | ElevenLabs voice management |
| `/shapes` | `auth` `logout` `browse` `import` `export` `status` | Shapes.inc character migration |
| `/inspect` | _(browse or identifier)_ | Diagnostic log browser and message inspector |
| `/help` | _(optional command)_ | Show available commands |

**Administration (owner only)**

| Command | Subcommands | Purpose |
| --- | --- | --- |
| `/admin` | `ping` `health` `servers` `kick` `usage` | Monitoring and management |
| | `cleanup` `db-sync` `settings` `presence` `stop-sequences` | Maintenance and configuration |
| `/deny` | `add` `remove` `browse` `view` | User and guild denial management |

### 📋 Planned Features

- Multi-personality per channel (multiple bots responding naturally)
- Advanced memory features (LTM summarization, OpenMemory integration)
- Lorebooks / sticky context (keyword-triggered lore injection)
- Chatterbox TTS evaluation (next-gen local voice cloning)

## Development

```bash
pnpm build            # Build all services
pnpm test             # Run unit tests
pnpm test:int         # Run integration tests
pnpm quality          # Lint + CPD + depcruise + typecheck
pnpm format           # Format code
pnpm ops --help       # CLI tooling reference
```

## Deployment

### Railway Deployment

**Current Status**: Public beta running on Railway

- **API Gateway**: https://api-gateway-development-83e8.up.railway.app
- **Health Check**: https://api-gateway-development-83e8.up.railway.app/health

**BYOK Enabled**: Users can bring their own API keys via `/settings apikey` commands. Guest users without keys get access to free models only.

See [Railway Operations Guide](docs/reference/deployment/RAILWAY_OPERATIONS.md) for detailed deployment guide.

```bash
# Deploy updates (auto-deploys on push to develop)
git push origin develop

# View logs
railway logs --service api-gateway
railway logs --service ai-worker
railway logs --service bot-client

# Check status
railway status
```

### Local Development

Local development requires PostgreSQL (with pgvector) and Redis. Start them before running services:

```bash
# Using Podman (SteamOS/Distrobox) or Docker
podman start tzurot-redis tzurot-postgres
pnpm dev
```

## Documentation

### Project Status & Planning

- **[CURRENT.md](CURRENT.md)** - Current session status and active work
- **[BACKLOG.md](BACKLOG.md)** - Project backlog and priorities
- **[GitHub Releases](https://github.com/lbds137/tzurot/releases)** - Version history and changelogs

### Architecture & Design

- **[Architecture Decisions](docs/reference/architecture/ARCHITECTURE_DECISIONS.md)** - Why v3 is designed this way
- **[Caching Audit](docs/reference/architecture/CACHING_AUDIT.md)** - Cache implementations and patterns
- **[CLAUDE.md](CLAUDE.md)** - Project configuration for AI assistants

### Development Guides

- **[Development Guide](docs/reference/guides/DEVELOPMENT.md)** - Local development setup
- **[Testing Guide](docs/reference/guides/TESTING.md)** - Testing philosophy and patterns
- **[Operations Guide](docs/reference/deployment/RAILWAY_OPERATIONS.md)** - Railway deployment and operations
- **[OPS CLI Reference](docs/reference/tooling/OPS_CLI_REFERENCE.md)** - CLI tooling reference

## Project History

**v2** (archived in `tzurot-legacy/`): JavaScript, DDD architecture, Shapes.inc AI provider

- API Shutdown: Shapes.inc killed their API to force users to their website, forcing migration
- Lessons: Over-engineered architecture, vendor lock-in

**v3** (current): TypeScript, microservices, vendor-agnostic

- Complete rewrite with modern patterns
- Production deployment: 2025-10
- Focus: Simple, maintainable, scalable

## License

MIT License - See [LICENSE](LICENSE) file for details

## Maintainer

Single-developer project by Vladlena Costescu
