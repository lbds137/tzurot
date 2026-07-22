# Tzurot v3

[![codecov](https://codecov.io/gh/lbds137/tzurot/branch/develop/graph/badge.svg)](https://codecov.io/gh/lbds137/tzurot)
[![CI](https://github.com/lbds137/tzurot/workflows/CI/badge.svg)](https://github.com/lbds137/tzurot/actions)

> **🚀 Status**: Public beta — BYOK (Bring Your Own Key) enabled

A modern, scalable Discord bot with customizable AI characters, powered by a microservices architecture with long-term memory, voice in/out, and BYOK-first provider routing.

**Website**: [tzurot.org](https://tzurot.org) — [Terms of Service](https://tzurot.org/terms) · [Privacy Policy](https://tzurot.org/privacy)

## Highlights

- **Multi-provider, vendor-flexible**: Default routing through OpenRouter (400+ models, free tier included). Voice via Mistral (BYOK), ElevenLabs (BYOK), or self-hosted (no key needed). All provider boundaries are clean abstractions — no lock-in.
- **BYOK by default**: Users supply their own LLM + voice provider keys via `/settings apikey` and pay their own usage. Free-model + self-hosted-voice guest mode available for users without keys.
- **Privacy-respecting LTM**: pgvector with locally-computed embeddings — no third-party API call for memory operations.
- **Voice in + out with attribution**: STT for incoming voice messages, TTS for outgoing replies, with bot-owner-visible attribution telling you which provider actually ran (catches silent fallbacks).
- **Per-character config cascade**: User-default → per-character → per-user-per-character override. Surfaces resolved state via `/voice view <character>`, `/inspect`, and dedicated dashboards.
- **Clean microservice boundaries**: 4 services (3 TypeScript + 1 Python) with explicit, pragmatic responsibilities.

## Quick Start

### Prerequisites

- Node.js 25+
- pnpm 10+
- PostgreSQL 16+ with pgvector extension
- Redis 7+ (for BullMQ)
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
   # Note: Embeddings run locally (Xenova/bge-small-en-v1.5), no API key needed
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
                    +--------------------------+--------------------------+
                    |                                                     |
                    v                                                     v
              +------------+                                       +------------+
              | AI Worker  |-------------------------------------->| PostgreSQL |
              |  Service   |                                       | (pgvector) |
              +-----+------+                                       +------------+
                    |
        +-----------+-----------+----------+----------+
        |           |           |          |          |
        v           v           v          v          v
  +----------+ +----------+ +----------+ +--------+ +----------+
  |   Open   | | Mistral  | |  Eleven  | | Voice  | |  Local   |
  |  Router  | | (BYOK    | |  Labs    | | Engine | |Embeddings|
  | (400+    | |  TTS+STT)| |  (BYOK   | |(Python | |  (BGE,   |
  |  models) | |          | |   TTS)   | | STT/TTS| |  no API) |
  +----------+ +----------+ +----------+ +--------+ +----------+
```

**Services:**

- **bot-client**: Discord.js interface, slash commands, webhooks, voice attachment handling
- **api-gateway**: HTTP API, request validation, BullMQ job dispatch, cascade resolvers
- **ai-worker**: LLM calls, memory retrieval, prompt building, voice synthesis dispatch, diagnostic flight recorder
- **voice-engine**: Python FastAPI service for self-hosted STT (NVIDIA Parakeet TDT) and TTS (Pocket TTS)

**Data Stores:**

- **PostgreSQL + pgvector**: Users, characters, conversation history, vector embeddings for long-term memory
- **Redis**: BullMQ queues + caching layer (TTL caches with pub/sub invalidation)

**Integrations:**

- **OpenRouter** (LLM): 400+ AI models, free tier included. Primary LLM provider.
- **Mistral** (BYOK voice): Voxtral for STT, voice-cloning TTS. Primary BYOK voice provider.
- **ElevenLabs** (BYOK voice): TTS + STT. Alternate BYOK provider.
- **Voice Engine** (self-hosted): Python service running NVIDIA Parakeet TDT for STT and Pocket TTS for TTS. No external API needed; fallback for guest users and BYOK users when their provider fails.
- **Local Embeddings** (no API): Xenova/bge-small-en-v1.5 (384-dim vectors).

## Project Structure

- **`services/`** — Microservices
  - `bot-client/` — Discord bot interface (TypeScript)
  - `api-gateway/` — HTTP API and request routing (TypeScript)
  - `ai-worker/` — Background AI processing (TypeScript)
  - `voice-engine/` — Self-hosted STT/TTS service (Python FastAPI)
  - `website/` — Static site for [tzurot.org](https://tzurot.org): landing page + legal docs (Astro)
- **`packages/`** — Shared code
  - `common-types/` — TypeScript types, schemas, shared utilities
  - `cache-invalidation/` — Redis pub/sub cache invalidation services
  - `clients/` — Typed gateway API clients (generated from the route manifest)
  - `config-resolver/` — LLM/TTS/vision config cascade resolvers
  - `conversation-history/` — Conversation persistence + retention
  - `identity/` — User/personality loading and provisioning
  - `embeddings/` — Local embedding model (BGE-small-en-v1.5)
  - `test-factories/` — Shared mock-data factories
  - `test-utils/` — Shared test helpers and PGLite integration
  - `tooling/` — Ops CLI (`pnpm ops`) and codebase analysis
- **`prisma/`** — Database schema and migrations
- **`scripts/`** — One-off utilities: analysis, debug, data migrations, deployment helpers
- **`tzurot-legacy/`** — Archived v2 codebase (kept for migration reference)

## Features

### ✅ Working in Production

- **Multiple Characters**: `@mention` different characters (e.g. `@lilith`, `@default`) for per-character routing
- **Reply Detection**: Reply to bot messages to continue conversations seamlessly
- **Message References**: Reference other messages via Discord links or replies
- **Long-term Memory**: Characters remember context across sessions and conversations
- **Conversation History**: Contextual responses using recent message history with cross-channel bridging when configured
- **Webhook Avatars**: Each character has unique name and avatar
- **Image Support**: Send images to characters for vision processing
- **Voice In**: Send Discord voice messages — STT via Mistral (BYOK), ElevenLabs (BYOK), or self-hosted Parakeet (free fallback). Transcripts include attribution showing which provider produced them.
- **Voice Out**: TTS replies with voice cloning (Mistral or ElevenLabs BYOK) or self-hosted Pocket TTS (free fallback). Bot-owner-only diagnostic notices surface silent fallbacks (e.g., voice reference exceeded provider limit).
- **Message Chunking**: Automatic handling of Discord's 2000-character limit
- **Model Indicators**: Footer shows which AI model produced each response (toggleable per-user/per-character)
- **BYOK (Bring Your Own Key)**: Users provide their own LLM + voice provider keys via `/settings apikey`
- **Guest Mode**: Free model + self-hosted voice access for users without keys
- **Channel Activation**: Characters can auto-respond to all messages in a channel
- **NSFW Verification**: Age verification via Discord's native age-gated channels
- **DM Chat**: Chat with characters in DMs by replying to bot messages
- **Data Rights**: `/settings data export` (full account export) and `/settings data delete` (account erasure), per the [Privacy Policy](https://tzurot.org/privacy)
- **Release Notifications**: Opt-out DM announcements for new releases, tunable by severity via `/notifications`
- **Diagnostic Surface**: `/inspect` shows the full LLM request flight recorder (memory retrieval, token budget, prompt assembly, response, post-processing) for debugging and transparency

### Slash Commands

Tzurot is fully managed via Discord slash commands. For the complete reference (every subcommand, every argument), see the **[Command Reference](docs/commands.md)**.

- **`/character`** — Create, edit, browse, import/export AI characters; chat with them; manage per-character config + voice cloning enrollment
- **`/persona`** — User personas, defaults, per-character overrides
- **`/voice`** — TTS/STT provider config, cloned-voice library, per-character resolved-state dashboard (`/voice view`)
- **`/preset`** + **`/channel`** — Custom LLM presets, channel auto-response activation
- **`/models`** — Browse and inspect available AI models (capabilities, context window, pricing)
- **`/memory`** + **`/history`** — Long-term memory browse/search/prune, conversation history management, privacy modes (fresh, incognito)
- **`/settings`** — Timezone, BYOK API keys, per-character preset overrides, global default settings dashboard, data export/delete
- **`/notifications`** — Release-notes DM preferences (enable/disable, severity level, DM cleanup)
- **`/feedback`** — Send feedback to the developer from inside Discord
- **`/inspect`** + **`/help`** — Diagnostic log browser (full LLM request flight recorder); list all available commands
- **`/shapes`** — Legacy Shapes.inc character migration
- **`/admin`** + **`/deny`** — Owner-only monitoring, maintenance, denial management

### 📋 Planned

- **TTS Phase 2 — NeuTTS Air**: Self-hosted next-gen voice cloning engine alongside Pocket TTS, for free-tier voice-clone users
- **Multi-character per channel**: Multiple characters responding naturally to the same conversation
- **Lorebooks / sticky context**: Keyword-triggered lore injection
- **Memory enhancements**: LTM summarization, OpenMemory integration

## Development

```bash
pnpm build            # Build all services
pnpm test             # Run unit tests
pnpm test:component   # Run component tests
pnpm quality          # Lint + CPD + depcruise + typecheck
pnpm format           # Format code
pnpm ops --help       # CLI tooling reference
```

## Deployment

The reference deployment runs on **Railway** with auto-deploy from `develop`. Each microservice + the voice engine runs as its own Railway service; PostgreSQL (with pgvector) and Redis are Railway-provided.

**BYOK enabled**: users bring their own LLM + voice provider keys via `/settings apikey`. Guest users get free models + self-hosted voice.

See [Railway Operations Guide](docs/reference/deployment/RAILWAY_OPERATIONS.md) for the full deployment runbook.

```bash
# Auto-deploys on push to develop
git push origin develop

# Logs
railway logs --service api-gateway
railway logs --service ai-worker
railway logs --service bot-client

# Status
railway status
```

### Local Development

Local development requires PostgreSQL (with pgvector) and Redis:

```bash
# Using Podman (SteamOS/Distrobox) or Docker
podman start tzurot-redis tzurot-postgres
pnpm dev
```

**Running tests:** unit tests (`pnpm test`) need no services. **Component tests
(`pnpm test:component`) and the integration + contract tiers (`pnpm test:integration`)
require Redis** — start it first (`podman start tzurot-redis`) or you'll get a clear
"Test Redis is unreachable" error. Tests use in-process PGLite for the database, so no
Postgres is needed.

## Documentation

### Project Status & Planning

- **[CURRENT.md](CURRENT.md)** — Current session status and active work
- **[BACKLOG.md](BACKLOG.md)** — Project backlog and priorities
- **[GitHub Releases](https://github.com/lbds137/tzurot/releases)** — Version history and changelogs

### Architecture & Design

- **[Architecture Decisions](docs/reference/architecture/ARCHITECTURE_DECISIONS.md)** — Why v3 is designed this way
- **[Caching Audit](docs/reference/architecture/CACHING_AUDIT.md)** — Cache implementations and patterns
- **[CLAUDE.md](CLAUDE.md)** — Project configuration for AI assistants

### Development Guides

- **[Testing Guide](docs/reference/guides/TESTING.md)** — Testing philosophy and patterns
- **[Operations Guide](docs/reference/deployment/RAILWAY_OPERATIONS.md)** — Railway deployment and operations
- **[OPS CLI Reference](docs/reference/tooling/OPS_CLI_REFERENCE.md)** — CLI tooling reference

> Local dev setup: see [Quick Start](#quick-start) and [Development](#development) above. Steam Deck specifics: [`docs/steam-deck/`](docs/steam-deck/).

## Project History

**v2** (archived in `tzurot-legacy/`): JavaScript, DDD-style architecture, single AI provider. Vendor lock-in caused the rewrite to v3 in 2025.

**v3** (current): TypeScript microservices, vendor-flexible provider routing, BYOK-first. Production deployment 2025-10. Focus: simple, maintainable, scalable.

## License

MIT License — See [LICENSE](LICENSE) file for details

## Maintainer

Single-developer project by Vladlena Costescu
