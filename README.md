# Tzurot v3

> **🔨 Status**: Active development deployment (private testing only)

A modern, scalable Discord bot with customizable AI personalities, powered by microservices architecture with long-term memory.

## Why v3?

Shapes.inc (v2's AI provider) killed their API to force users to their website only, forcing a complete rewrite. v3 is better in every way:

- **Vendor Independence**: Clean abstraction for AI providers - never locked in again
- **TypeScript Throughout**: Full type safety and better IDE support
- **True Microservices**: Each service has a single, clear responsibility
- **Long-term Memory**: pgvector for personality memory across conversations
- **Multiple Providers**: OpenRouter (400+ models) + direct Gemini support
- **Clean Architecture**: No over-engineered DDD - just simple, maintainable code

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│  Discord    │────▶│  Bot Client  │────▶│    API     │
│   Users     │◀────│   Service    │◀────│  Gateway   │
└─────────────┘     └──────────────┘     └────────────┘
                                               │
                                               ▼
                                         ┌────────────┐
                                         │   Queue    │
                                         │  (BullMQ)  │
                                         └────────────┘
                                               │
                                               ▼
                                         ┌────────────┐
                                         │ AI Worker  │
                                         │  Service   │
                                         └────────────┘
                                               │
                                               ▼
                                         ┌────────────┐
                                         │ OpenRouter │
                                         │    API     │
                                         └────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
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
   # Required: AI provider keys (OpenRouter or Gemini), OPENAI_API_KEY (for embeddings)
   # Optional: REDIS_URL (Railway provides this automatically)
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
  - `bot-client/` - Discord bot interface
  - `api-gateway/` - HTTP API and request routing
  - `ai-worker/` - Background AI processing
- **`packages/`** - Shared code
  - `common-types/` - TypeScript types and schemas
  - `api-clients/` - External API client libraries

- **`personalities/`** - Personality configurations (JSON)
- **`tzurot-legacy/`** - Archived v2 codebase

## AI Provider System

The system is designed to be vendor-agnostic:

```typescript
// Easy to switch providers
const provider = AIProviderFactory.create('openrouter', {
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Or use a different provider
const provider = AIProviderFactory.create('openai', {
  apiKey: process.env.OPENAI_API_KEY,
});
```

### Currently Supported

- ✅ OpenRouter (400+ models via one API)
- ✅ Gemini (direct API integration)

### Planned Support

- ⏳ Direct Anthropic Claude
- ⏳ Direct OpenAI
- ⏳ Local models (Ollama)
- ⏳ Custom endpoints

## Features

### ✅ Working in Production

- **Multiple Personalities**: @mention different personalities (@lilith, @default, @sarcastic)
- **Reply Detection**: Reply to bot messages to continue conversations
- **Long-term Memory**: pgvector stores personality memories across sessions
- **Conversation History**: Contextual responses using recent message history
- **Webhook Avatars**: Each personality has unique name and avatar
- **Image Support**: Send images to personalities for analysis
- **Voice Support**: Send voice messages for transcription
- **Message Chunking**: Automatically handles Discord's 2000 character limit
- **Model Indicators**: Shows which AI model generated each response
- **Slash Commands**: Basic commands (/ping, /help)

### 📋 Planned Features

- Auto-response in activated channels
- Full slash command suite (/personality add/remove/list)
- Rate limiting per user/channel
- NSFW verification system

### 🚧 Required for Public Launch

- **BYOK (Bring Your Own Key)**: Users provide their own OpenRouter/Gemini keys
- **Admin Commands**: Bot owner slash commands
  - `/admin servers` - List all servers bot is in
  - `/admin kick <server_id>` - Remove bot from a server
  - `/admin usage` - View API usage/costs
- **Cost Protection**: Prevent unauthorized API usage

## Development

### Build all services:

```bash
pnpm build
```

### Run tests:

```bash
pnpm test
```

### Type checking:

```bash
pnpm typecheck
```

### Formatting:

```bash
pnpm format
```

## Deployment

### Development Deployment (Railway)

**Current Status**: Running in Railway's "development" environment for private testing

- **API Gateway**: https://api-gateway-development-83e8.up.railway.app
- **Health Check**: https://api-gateway-development-83e8.up.railway.app/health

**Note**: Not open to public yet - requires BYOK implementation to prevent unexpected API costs.

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment guide.

```bash
# Deploy updates (auto-deploys on push)
git push origin feat/v3-continued

# View logs
railway logs --service api-gateway
railway logs --service ai-worker
railway logs --service bot-client

# Check status
railway status
```

### Local Development with Docker

Local development uses Docker Compose for Redis:

```bash
docker-compose up -d
pnpm dev
```

## Documentation

### Project Status & Planning

- **[CURRENT_WORK.md](CURRENT_WORK.md)** - Current project status and what's being worked on
- **[GitHub Releases](https://github.com/lbds137/tzurot/releases)** - Version history and changelogs
- **[V2 Feature Tracking](docs/planning/V2_FEATURE_TRACKING.md)** - What's been ported from v2

### Architecture & Design

- **[Architecture Decisions](docs/architecture/ARCHITECTURE_DECISIONS.md)** - Why v3 is designed this way
- **[Timeout Allocation Guide](docs/architecture/TIMEOUT_ALLOCATION.md)** - Railway timeout budget management
- **[CLAUDE.md](CLAUDE.md)** - Project configuration for AI assistants

### Development Guides

- **[Development Guide](docs/guides/DEVELOPMENT.md)** - Local development setup
- **[Testing Guide](docs/guides/TESTING.md)** - Testing philosophy and patterns
- **[Deployment Guide](docs/deployment/DEPLOYMENT.md)** - Railway deployment guide

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
