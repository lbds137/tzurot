---
name: tzurot-architecture
description: Microservices architecture for Tzurot v3 - Service boundaries, responsibilities, dependency rules, and anti-patterns from v2. Use when deciding where code belongs or designing new features.
lastUpdated: '2025-12-08'
---

# Tzurot v3 Architecture

**Use this skill when:** Adding new features, deciding where code belongs, designing system interactions, or refactoring service boundaries.

## Architecture Overview

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

## Core Principles

1. **Simple, clean classes** - No DDD over-engineering (learned from v2)
2. **Clear service boundaries** - Each service has single responsibility
3. **No circular dependencies** - Services can't import from each other
4. **Shared code in common-types** - Cross-service types, utils, services
5. **Constructor injection** - Simple dependency passing, no DI containers

## Three Microservices

### bot-client (Discord Interface)

**Responsibility:** Handle ALL Discord interactions, manage webhooks

**What it does:**

- Listen to Discord events (messages, interactions, commands)
- Register slash commands
- Create and manage webhooks (unique avatar/name per personality)
- Send HTTP requests to api-gateway
- Receive responses and send to Discord
- Format messages (chunking, embeds, typing indicators)
- Cache webhook instances

**What it does NOT do:**

- ❌ Business logic (personality selection, memory retrieval)
- ❌ AI API calls
- ❌ Database writes (except via api-gateway)
- ❌ Job queue operations (only triggers them)

**Key files:**

```
services/bot-client/src/
├── index.ts               # Discord client setup
├── handlers/              # Event handlers
│   ├── messageCreate.ts
│   └── interactionCreate.ts
├── commands/              # Slash command definitions
├── webhooks/              # Webhook management
└── redis.ts               # Webhook message tracking
```

**Dependencies:**

- Discord.js 14
- Redis (for webhook message tracking)
- HTTP client (for api-gateway calls)

### api-gateway (HTTP API + Job Queue)

**Responsibility:** HTTP endpoints, job queue orchestration, request validation

**What it does:**

- Expose HTTP endpoints (`/ai/generate`, `/health`, `/metrics`)
- Validate incoming requests
- Create BullMQ jobs
- Wait for job completion
- Return results to bot-client
- Serve personality avatars
- Manage request deduplication
- Handle cache invalidation subscriptions

**What it does NOT do:**

- ❌ AI processing (that's ai-worker's job)
- ❌ Discord interactions (that's bot-client's job)
- ❌ Long-running AI calls directly (uses queue)

**Key files:**

```
services/api-gateway/src/
├── index.ts               # Express app
├── routes/
│   ├── ai.ts             # POST /ai/generate
│   └── admin.ts          # Admin endpoints
├── queue.ts              # BullMQ queue setup
├── services/             # Business logic services
└── utils/                # Request deduplication, etc.
```

**Dependencies:**

- Express
- BullMQ (queue client)
- Redis
- Prisma (database)
- Common-types

### ai-worker (AI Processing + Memory)

**Responsibility:** Process AI jobs, manage vector memory, call AI APIs

**What it does:**

- Listen to BullMQ queue
- Retrieve personality configurations
- Search pgvector for relevant memories
- Build conversation context
- Call AI providers (OpenRouter, Gemini)
- Generate embeddings
- Store new memories
- Handle preprocessing (image description, audio transcription)
- Job timeout and retry management

**What it does NOT do:**

- ❌ HTTP requests from external clients (queue-based only)
- ❌ Discord interactions
- ❌ Direct webhook replies (goes through api-gateway)

**Key files:**

```
services/ai-worker/src/
├── index.ts               # BullMQ worker setup
├── jobs/                  # Job processors
│   ├── LLMGenerationJob.ts
│   ├── AudioTranscriptionJob.ts
│   └── ImageDescriptionJob.ts
├── providers/             # AI provider clients
│   ├── OpenRouterClient.ts
│   └── GeminiClient.ts
└── services/              # Memory, embeddings, etc.
```

**Dependencies:**

- BullMQ (worker)
- Redis
- Prisma (database + pgvector)
- OpenRouter/Gemini SDKs
- Common-types

## Shared Code (common-types)

**Responsibility:** Types, interfaces, utilities, services used across multiple microservices

**What belongs here:**

```
packages/common-types/src/
├── types/                 # TypeScript interfaces
│   ├── discord-types.ts  # Discord-specific types
│   ├── ai-types.ts       # AI request/response types
│   └── queue-types.ts    # BullMQ job types
├── constants/             # All application constants
│   ├── timing.ts
│   ├── queue.ts
│   └── discord.ts
├── services/              # Shared service classes
│   ├── PersonalityService.ts
│   ├── ConversationHistoryService.ts
│   └── CacheInvalidationService.ts
├── utils/                 # Utility functions
│   ├── retry.ts
│   ├── logger.ts
│   └── redis.ts
└── errors/                # Custom error classes
    └── RetryError.ts
```

**Dependency rule:** Services CAN import from common-types. Common-types CANNOT import from services.

## Service Boundaries

### Data Flow: Discord Message → AI Response

```
1. User sends Discord message
   ↓
2. bot-client receives messageCreate event
   ↓
3. bot-client sends POST to api-gateway/ai/generate
   ↓
4. api-gateway validates request
   ↓
5. api-gateway creates BullMQ job
   ↓
6. api-gateway waits for job completion
   ↓
7. ai-worker picks up job from queue
   ↓
8. ai-worker retrieves personality + memories
   ↓
9. ai-worker calls OpenRouter/Gemini API
   ↓
10. ai-worker stores new memory
    ↓
11. ai-worker completes job with response
    ↓
12. api-gateway receives completion
    ↓
13. api-gateway returns response to bot-client
    ↓
14. bot-client sends message to Discord via webhook
```

### Where to Put New Code

**Discord-related code:**

- Webhook management → bot-client
- Message formatting → bot-client
- Slash command handlers → bot-client
- Discord type guards → common-types

**HTTP/API code:**

- New endpoints → api-gateway/routes/
- Request validation → api-gateway
- Job creation → api-gateway/queue.ts

**AI/Memory code:**

- AI provider clients → ai-worker/providers/
- Memory retrieval → ai-worker/services/
- Embedding generation → ai-worker/services/
- Job processors → ai-worker/jobs/

**Shared utilities:**

- Retry logic → common-types/utils/
- Type guards → common-types/types/
- Error classes → common-types/errors/
- Constants → common-types/constants/

**Services used by multiple microservices:**

- PersonalityService → common-types/services/
- ConversationHistoryService → common-types/services/
- Logger → common-types/utils/

## Dependency Injection Pattern

**Simple constructor injection** - No DI containers!

```typescript
// ✅ GOOD - Simple, explicit
class MyService {
  constructor(
    private prisma: PrismaClient,
    private redis: Redis
  ) {}

  async doSomething(): Promise<void> {
    await this.prisma.user.findMany();
    await this.redis.get('key');
  }
}

// Usage
const prisma = getPrismaClient();
const redis = getRedisClient();
const service = new MyService(prisma, redis);
```

```typescript
// ❌ BAD - DI container (v2 over-engineering)
@injectable()
class MyService {
  constructor(
    @inject('PrismaClient') private prisma: PrismaClient,
    @inject('Redis') private redis: Redis
  ) {}
}
```

## Anti-Patterns from v2

**Why v3 abandoned DDD:** V2's Domain-Driven Design was over-engineered for a one-person project.

### ❌ Don't Create These v2 Patterns:

**1. Generic Repository Interfaces**

```typescript
// ❌ v2 pattern - Too abstract
interface IRepository<T> {
  findById(id: string): Promise<T>;
  findAll(): Promise<T[]>;
  save(entity: T): Promise<T>;
}

// ✅ v3 pattern - Concrete, simple
class PersonalityService {
  async getPersonality(id: string): Promise<Personality | null> {
    return this.prisma.personality.findUnique({ where: { id } });
  }
}
```

**2. Dependency Injection Containers**

```typescript
// ❌ v2 pattern - Container hell
container.bind('PersonalityService').to(PersonalityService);
const service = container.get('PersonalityService');

// ✅ v3 pattern - Direct instantiation
const service = new PersonalityService(prisma);
```

**3. Excessive Abstraction Layers**

```typescript
// ❌ v2 pattern - Too many layers
Controller → UseCase → Service → Repository → ORM

// ✅ v3 pattern - Direct access
Route Handler → Service → Prisma
```

**4. Complex Domain Events**

```typescript
// ❌ v2 pattern - Event bus complexity
eventBus.emit('personality.updated', { id });

// ✅ v3 pattern - Redis pub/sub for cross-service only
cacheInvalidationService.invalidatePersonality(id);
```

**5. Value Objects Everywhere**

```typescript
// ❌ v2 pattern - Value object overhead
class PersonalityName {
  constructor(private value: string) {
    if (!this.validate()) throw new Error('Invalid');
  }
  validate() {
    /* complex validation */
  }
}

// ✅ v3 pattern - Simple validation
function validatePersonalityName(name: string): boolean {
  return name.length > 0 && name.length <= 100;
}
```

## When to Extract a Service

**Extract to a new service class when:**

1. **Shared across multiple microservices** - Belongs in common-types
2. **Complex business logic** - Deserves its own class
3. **Stateful operations** - Needs to maintain state
4. **Testability** - Easier to mock as a class

**Keep inline when:**

1. **Used in one place only** - Simple function is fine
2. **Stateless utility** - Pure function, no dependencies
3. **Very simple logic** - Extracting adds complexity

```typescript
// ✅ Extract - Complex, shared, stateful
class ConversationHistoryService {
  constructor(private prisma: PrismaClient) {}

  async addMessage(/* ... */): Promise<void> {
    // Complex logic with database interactions
  }

  async getHistory(/* ... */): Promise<Message[]> {
    // Pagination, filtering, etc.
  }
}

// ✅ Keep inline - Simple, one-off
function formatUsername(username: string): string {
  return `@${username}`;
}
```

## Database Access Patterns

**Direct Prisma access in services** - No repository pattern

```typescript
// ✅ GOOD - Prisma directly in service
class PersonalityService {
  constructor(private prisma: PrismaClient) {}

  async getPersonality(id: string): Promise<Personality | null> {
    return this.prisma.personality.findUnique({
      where: { id },
      include: { llmConfig: true },
    });
  }
}

// ❌ BAD - Generic repository
interface PersonalityRepository {
  findById(id: string): Promise<Personality>;
}
```

## Error Handling Architecture

**Service-level errors** - Let errors bubble up, handle at boundaries

```typescript
// ✅ GOOD - Service throws, route handles
class PersonalityService {
  async getPersonality(id: string): Promise<Personality> {
    const personality = await this.prisma.personality.findUnique({ where: { id } });
    if (!personality) {
      throw new Error(`Personality not found: ${id}`);
    }
    return personality;
  }
}

// Route handler catches and formats
app.get('/personality/:id', async (req, res) => {
  try {
    const personality = await service.getPersonality(req.params.id);
    res.json(personality);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});
```

## Error Message Patterns

**Gateway (api-gateway)**: Return clean error messages WITHOUT emojis

- Error responses are machine-readable and may be processed by multiple consumers
- Example: `sendError(res, ErrorResponses.notFound('Persona'))`
- Result: `{ "error": "NOT_FOUND", "message": "Persona not found" }`

**Bot client (bot-client)**: ADD emojis to user-facing messages

- Use for errors: `content: '❌ Profile not found.'`
- Use for success: `content: '✅ Profile override set successfully!'`
- Use for warnings: `content: '⚠️ This action cannot be undone.'`

**Why this separation**: Gateway is an API layer used by multiple services. Bot-client is the only service that renders messages to Discord users. Keeping emojis in bot-client allows:

- Consistent emoji usage across all user-facing commands
- Gateway responses remain clean for programmatic use
- Easy to change emoji style without touching API layer

```typescript
// ✅ CORRECT - Gateway returns clean JSON
// api-gateway/routes/persona.ts
sendError(res, ErrorResponses.notFound('Persona'));
// Returns: { "error": "NOT_FOUND", "message": "Persona not found" }

// ✅ CORRECT - Bot adds emoji for user
// bot-client/commands/me/view.ts
await interaction.editReply({ content: '❌ Profile not found.' });

// ❌ WRONG - Gateway with emoji
sendError(res, { message: '❌ Persona not found' });
```

## Configuration Management

**Environment variables for secrets, constants for application config**

```typescript
// ✅ GOOD - Env vars for secrets
const discordToken = process.env.DISCORD_TOKEN;
const databaseUrl = process.env.DATABASE_URL;

// ✅ GOOD - Constants for config
import { TIMEOUTS, RETRY_CONFIG } from '@tzurot/common-types';
const timeout = TIMEOUTS.LLM_INVOCATION;
const maxRetries = RETRY_CONFIG.MAX_ATTEMPTS;

// ❌ BAD - Hardcoded secrets
const discordToken = 'MTIzNDU2Nzg5MA.GhIjKl';

// ❌ BAD - Hardcoded config
const timeout = 480000;
```

## Scaling Considerations

**Current architecture supports:**

- ✅ Horizontal scaling of ai-worker (multiple workers)
- ✅ Horizontal scaling of api-gateway (load balancer)
- ✅ Single bot-client instance (Discord.js limitation)

**Future scaling paths:**

- Add more ai-worker instances for faster job processing
- Add more api-gateway instances behind load balancer
- Shard bot-client if guild count exceeds Discord limits
- Separate read/write database instances

## Testing Architecture

**Each service has its own tests** - No cross-service integration tests yet

```
services/bot-client/src/
├── webhooks/
│   ├── WebhookManager.ts
│   └── WebhookManager.test.ts  # Tests with mocked Discord

services/api-gateway/src/
├── routes/
│   ├── ai.ts
│   └── ai.test.ts              # Tests with mocked queue

services/ai-worker/src/
├── jobs/
│   ├── LLMGenerationJob.ts
│   └── LLMGenerationJob.test.ts  # Tests with mocked AI provider
```

## Related Skills

- **tzurot-async-flow** - Async workflow design patterns
- **tzurot-db-vector** - Database service responsibilities
- **tzurot-shared-types** - Type definitions across services
- **tzurot-gemini-collab** - Consult for major design decisions

## References

- Full architecture: `CLAUDE.md#architecture`
- Service structure: `CLAUDE.md#project-structure`
- Why v3 abandoned DDD: `CLAUDE.md#why-v3-abandoned-ddd`
- Architecture decisions: `docs/architecture/ARCHITECTURE_DECISIONS.md`
