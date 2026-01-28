# Tzurot v3 - Development Guide

## What We've Built

Tzurot v3 is a complete rewrite implementing a modern, scalable Discord bot architecture with:

### Core Features ✅

- **LangChain-based RAG** for memory-augmented conversations
- **Multi-layered canon system** (global/personal/session memories)
- **BYOK support** (users can bring their own API keys)
- **Microservices architecture** (bot-client, api-gateway, ai-worker)
- **Vector database** (pgvector in PostgreSQL) for long-term memory
- **BullMQ** job queue for async processing
- **Railway-ready** deployment configuration

### Architecture

```
┌─────────────┐
│   Discord   │
└──────┬──────┘
       │
┌──────▼──────────┐
│   bot-client    │  Discord.js - Receives messages, sends to gateway
└──────┬──────────┘
       │ HTTP
┌──────▼──────────┐
│  api-gateway    │  Express - Creates jobs in Redis queue
└──────┬──────────┘
       │ BullMQ
┌──────▼──────────┐
│   ai-worker     │  LangChain - Processes AI requests with RAG
│                 │
│  ┌───────────┐  │
│  │ pgvector  │  │  Vector memory (global/personal/session canons)
│  └───────────┘  │
└─────────────────┘
```

## Project Structure

```
tzurot-v3/
├── services/
│   ├── bot-client/          # Discord bot
│   │   └── src/
│   │       └── index.ts     # [TODO] Discord message handling
│   │
│   ├── api-gateway/         # HTTP API
│   │   └── src/
│   │       └── index.ts     # [TODO] Express server + BullMQ job creation
│   │
│   └── ai-worker/           # AI processing ✅ COMPLETE
│       ├── src/
│       │   ├── index.ts     # BullMQ worker + health server
│       │   ├── memory/
│       │   │   └── VectorMemoryManager.ts   # Multi-layered canon system
│       │   ├── services/
│       │   │   └── ConversationalRAGService.ts  # LangChain RAG
│       │   ├── jobs/
│       │   │   └── AIJobProcessor.ts        # Job processing logic
│       │   └── config/
│       │       └── PersonalityLoader.ts     # Load personalities
│       └── package.json
│
├── packages/
│   ├── common-types/        # Shared TypeScript types
│   └── api-clients/         # AI provider abstractions
│
├── personalities/           # Personality configs (JSON)
│   └── lilith.json          # Example personality
│
├── docker-compose.yml       # Local dev services (Redis, Postgres with pgvector)
├── railway.json             # Railway deployment config
├── .env.example             # Environment variables template
└── RAILWAY_OPERATIONS.md    # Railway deployment & operations guide
```

## Quick Start

### 1. Prerequisites

- Node.js 20+
- pnpm 8+
- Docker & Docker Compose

### 2. Install Dependencies

```bash
cd tzurot-v3
pnpm install
```

### 3. Set Up Environment

```bash
cp .env.example .env
# Edit .env and add your API keys
```

### 4. Start Local Services

```bash
# Start Redis and PostgreSQL (with pgvector)
docker-compose up -d

# Verify services are running
docker-compose ps
```

### 5. Build All Services

```bash
pnpm run build
```

### 6. Run Services (in separate terminals)

**Terminal 1 - AI Worker:**

```bash
pnpm --filter @tzurot/ai-worker dev
```

**Terminal 2 - API Gateway:**

```bash
pnpm --filter @tzurot/api-gateway dev
```

**Terminal 3 - Bot Client:**

```bash
pnpm --filter @tzurot/bot-client dev
```

## What's Implemented

### ✅ ai-worker Service (Complete)

- BullMQ worker that processes AI generation jobs
- VectorMemoryManager with multi-layered canons
- ConversationalRAGService using LangChain
- PersonalityLoader for JSON-based configs
- Health check HTTP server
- Graceful shutdown handling
- Railway-ready deployment

### 🚧 api-gateway Service (TODO)

**Needs:**

- Express HTTP server
- BullMQ Queue initialization
- POST `/ai/generate` endpoint
- Job creation and response handling
- Authentication middleware (for BYOK)

### 🚧 bot-client Service (TODO)

**Needs:**

- Discord.js client initialization
- Message event handler
- Command registration
- HTTP client to call api-gateway
- Response formatting for Discord

## Development Workflow

### Adding a New Personality

1. Create a JSON file in `personalities/`:

```json
{
  "name": "YourPersonality",
  "systemPrompt": "You are...",
  "model": "anthropic/claude-3-sonnet",
  "temperature": 0.7,
  "memoryEnabled": true
}
```

2. Restart the ai-worker service

### Testing the AI Worker

Once api-gateway and bot-client are implemented, you can test the full flow. For now, you can test the worker directly by adding jobs to Redis:

```javascript
import { Queue } from 'bullmq';

const queue = new Queue('ai-requests', {
  connection: { host: 'localhost', port: 6379 },
});

await queue.add('generate', {
  requestId: 'test-123',
  jobType: 'generate',
  personality: {
    /* your personality config */
  },
  message: 'Hello!',
  context: {
    userId: 'user-123',
    userName: 'TestUser',
  },
});
```

### Adding Memories to pgvector

The ai-worker automatically stores interactions as memories. To pre-seed memories (e.g., from Shapes.inc backup):

```typescript
import { VectorMemoryManager } from './services/ai-worker/src/memory/VectorMemoryManager';

const memoryManager = new VectorMemoryManager();
await memoryManager.initialize();

await memoryManager.addMemory({
  text: "User: I love hiking. Lilith: That's wonderful! Nature is so healing.",
  metadata: {
    personalityId: 'lilith',
    userId: 'user-123',
    canonScope: 'personal',
    timestamp: Date.now(),
  },
});
```

## Environment Variables

See `.env.example` for all available environment variables.

**Critical variables:**

- `DISCORD_TOKEN` - Your Discord bot token
- `OPENROUTER_API_KEY` - For LLM completions
- `OPENAI_API_KEY` - For embeddings
- `REDIS_URL` / `REDIS_HOST` - Redis connection

# No QDRANT_URL needed - pgvector uses DATABASE_URL

# No QDRANT_API_KEY needed - pgvector uses DATABASE_URL

- `DATABASE_URL` - PostgreSQL for BYOK credentials

## Next Steps

### Immediate TODOs

1. **Implement api-gateway** - Create Express server with job queue
2. **Implement bot-client** - Discord message handling
3. **Test end-to-end** - Discord → gateway → worker → response
4. **Add BYOK credential system** - Encrypted user API keys in PostgreSQL
5. **Create data ingestion** - Import Shapes.inc backups (via local JSON files; internal APIs available via appSession cookie for missing data)

### Future Enhancements

6. **LangGraph "Free Will" agent** - Decides when personalities should speak
7. **Relationship dynamics** - Canon reconciliation for evolving relationships
8. **Voice synthesis** - ElevenLabs integration
9. **Image generation** - Flux/DALL-E integration
10. **Web dashboard** - Manage personalities and memories

## Debugging

### Check Service Health

```bash
# ai-worker health
curl http://localhost:3001/health

# Should return:
# {"status":"healthy","chroma":true,"worker":true,"timestamp":"..."}
```

### View Logs

```bash
# Docker services
docker-compose logs -f

# Individual service
pnpm --filter @tzurot/ai-worker dev  # Logs to stdout
```

### Common Issues

**"pgvector Connection Issues"**

- Ensure Docker Compose is running: `docker-compose ps`
- Check PostgreSQL logs: `docker-compose logs postgres`
- Verify DATABASE_URL is set correctly and pgvector extension is enabled

**"No API key available"**

- Set OPENROUTER_API_KEY or OPENAI_API_KEY in .env
- For BYOK, user must provide their own key

**"Worker not processing jobs"**

- Check Redis connection: `docker-compose logs redis`
- Verify REDIS_URL or REDIS_HOST/PORT in .env
- Check worker logs for connection errors

## Contributing

This is a personal project, but the architecture is designed to be:

- **Modular** - Each service can be developed/tested independently
- **Maintainable** - Clear separation of concerns
- **Scalable** - Microservices can scale horizontally
- **Testable** - Mock-friendly dependency injection

When making changes:

1. Follow TypeScript best practices
2. Add JSDoc comments for public APIs
3. Keep services loosely coupled
4. Use dependency injection
5. Add logging for debugging
6. Handle errors gracefully

## Architecture Decisions

### Why Microservices?

- Avoid the monolithic mess of v1/v2
- Independent scaling (worker can have more replicas)
- Clear boundaries between concerns
- Easier to debug and maintain

### Why LangChain?

- Built-in RAG support
- Memory management out of the box
- Tool calling for agentic behavior
- Active community and updates

### Why pgvector?

- PostgreSQL extension - no separate vector database needed
- Production-grade performance and scalability
- Included in Railway's PostgreSQL addon (no extra cost)
- Rich filtering and indexing capabilities
- Simplifies deployment (one less service to manage)

### Why BullMQ?

- Redis-based (Railway has Redis addon)
- Robust job processing
- Good observability
- Retry and failure handling

---

**Last Updated:** 2025-10-02
**Status:** ai-worker complete, gateway and bot-client in progress
