# Tzurot V3 Implementation Plan

**Status:** Ready to implement API Gateway (CRITICAL PATH)
**Updated:** 2025-10-02

---

## Critical Path to MVP (14-22 hours)

### Phase 1: API Gateway (8-12 hours) 🔴 BLOCKER

The gateway is the missing piece that connects bot-client to ai-worker via BullMQ.

#### What to Build

```
services/api-gateway/src/
├── index.ts              # Express server + BullMQ queue
├── routes/
│   └── ai.ts            # POST /ai/generate endpoint
├── queue.ts             # BullMQ queue setup
└── types.ts             # Request/response types
```

#### Key Patterns from V2

**From v2 bot.js:**

- Discord.js client setup with proper intents ✅
- Message event handlers ✅
- Error handling patterns ✅

**From v2 webhookManager.js:**

- Webhook caching (prevent redundant creations) ⚠️ CRITICAL
- Message deduplication ⚠️ CRITICAL
- Rate limiting and retry logic ✅
- Injectable timers for testing ✅

**From v2 aiService.js:**

- Request deduplication with pendingRequests Map ✅
- Multimodal content handling (text, images, audio) ✅
- Reference message fetching ✅
- Exponential backoff retry logic ✅

**From v2 utils/messageDeduplication.js:**

- Content hashing for duplicate detection ✅
- Time-based cache expiration ✅
- Cleanup of old entries ✅

#### Implementation Steps

1. **Create Express server** (2 hours)

   ```typescript
   // services/api-gateway/src/index.ts
   import express from 'express';
   import { Queue } from 'bullmq';

   const app = express();
   const aiQueue = new Queue('ai-requests', {
     connection: process.env.REDIS_URL,
   });
   ```

2. **Add POST /ai/generate endpoint** (2 hours)

   ```typescript
   // services/api-gateway/src/routes/ai.ts
   router.post('/ai/generate', async (req, res) => {
     const { personality, message, context, userApiKey } = req.body;

     const job = await aiQueue.add('generate', {
       requestId: generateRequestId(),
       jobType: 'generate',
       personality,
       message,
       context,
       userApiKey,
     });

     res.json({ jobId: job.id, requestId: job.data.requestId });
   });
   ```

3. **Add request deduplication** (2 hours)
   - Port `messageDeduplication.js` logic to TypeScript
   - Use Map-based cache with TTL
   - Return cached job ID for duplicate requests

4. **Add health check endpoint** (1 hour)

   ```typescript
   app.get('/health', async (req, res) => {
     const redisHealthy = await checkRedis();
     res.json({ status: redisHealthy ? 'healthy' : 'degraded' });
   });
   ```

5. **Add BYOK credential lookup** (3-5 hours)
   - PostgreSQL table: `user_credentials (user_id, encrypted_key, provider)`
   - Encrypt API keys with `crypto.createCipher()`
   - Fallback to env keys if user has no key

#### Files to Reference

- `/home/deck/WebstormProjects/tzurot/src/bot.js` - Discord setup
- `/home/deck/WebstormProjects/tzurot/src/webhookManager.js` - Caching patterns
- `/home/deck/WebstormProjects/tzurot/src/aiService.js` - Request handling
- `/home/deck/WebstormProjects/tzurot/src/utils/messageDeduplication.js` - Dedup logic

---

### Phase 2: Bot Client Integration (4-6 hours)

Update bot-client to call API gateway instead of AI provider directly.

#### Implementation Steps

1. **Update message handler** (2 hours)

   ```typescript
   // services/bot-client/src/handlers/messageHandler.ts
   async function handleMessage(message: Message) {
     // Replace direct AI call with HTTP request
     const response = await fetch('http://api-gateway:3000/ai/generate', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         personality: selectedPersonality,
         message: message.content,
         context: {
           userId: message.author.id,
           channelId: message.channel.id,
           userName: message.author.username,
         },
       }),
     });

     const { jobId } = await response.json();
     // Poll for result or use webhook callback
   }
   ```

2. **Add webhook management** (3-4 hours)
   - Port webhook caching from v2
   - Create/reuse webhooks per channel
   - Send AI responses via webhooks with personality avatar/name

3. **Add personality selection** (1 hour)
   - Command: `!tz use <personality>`
   - Store active personality per channel/user
   - Load personality configs from shared `personalities/` directory

#### Files to Reference

- `/home/deck/WebstormProjects/tzurot/src/webhookManager.js` - Webhook logic
- `/home/deck/WebstormProjects/tzurot/src/handlers/messageHandler.js` - Message flow
- `/home/deck/WebstormProjects/tzurot/src/utils/webhookCache.js` - Webhook caching

---

### Phase 3: Testing & Deployment (2-4 hours)

1. **Local testing** (1-2 hours)

   ```bash
   docker-compose up -d  # Start Redis, ChromaDB, PostgreSQL
   cd services/api-gateway && npm run dev
   cd services/ai-worker && npm run dev
   cd services/bot-client && npm run dev
   ```

2. **End-to-end flow test** (1 hour)
   - Send Discord message
   - Verify: bot → gateway → worker → response

3. **Railway deployment** (1 hour)
   - Deploy all 3 services
   - Add Railway addons: Redis, PostgreSQL
   - Set environment variables

---

## Key Patterns to Port from V2

### ✅ Keep These Patterns

1. **Injectable Timers**

   ```typescript
   // From v2 webhookManager.js
   let delayFn = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
   function setDelayFunction(fn: typeof delayFn) {
     delayFn = fn;
   }
   ```

2. **Webhook Caching**

   ```typescript
   // From v2 webhookCache.js
   const webhookCache = new Map<string, { webhook: Webhook; lastUsed: number }>();
   ```

3. **Message Deduplication**

   ```typescript
   // From v2 messageDeduplication.js
   function hashMessage(content: string, username: string, channelId: string): string {
     const contentHash = content.substring(0, 30) + content.length;
     return `${channelId}_${username}_${contentHash}`;
   }
   ```

4. **Request Deduplication**

   ```typescript
   // From v2 aiService.js
   const pendingRequests = new Map<string, Promise<AIResponse>>();
   ```

5. **Error Handling with Exponential Backoff**
   ```typescript
   // From v2 aiService.js
   async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
     for (let i = 0; i < maxRetries; i++) {
       try {
         return await fn();
       } catch (error) {
         if (i === maxRetries - 1) throw error;
         await delay(Math.pow(2, i) * 1000);
       }
     }
   }
   ```

### ❌ Don't Port These

1. **DDD Architecture** - V2's partial DDD migration caused confusion. V3 uses microservices instead.
2. **PersonalityManager singleton** - Use PersonalityLoader with JSON configs.
3. **ConversationManager** - V3 uses vector memory instead of in-memory history.
4. **Profile fetching** - V3 uses personality JSON files, no external API.

---

## Post-MVP Features (Later)

### BYOK System (6-8 hours)

- PostgreSQL credentials table
- Key encryption/decryption
- User management commands

### Data Ingestion (8-12 hours)

- Import Shapes.inc backups
- Import SpicyChat chat history
- Bootstrap User Relationship Profiles

### Free Will Agent (16-24 hours)

- LangGraph orchestration
- Proactive personality engagement
- Cost-effective triage

### Relationship Graph (12-16 hours)

- Social connections between personalities
- Memory propagation rules
- "Gossip protocol"

---

## Success Criteria

### MVP (This Weekend)

- [ ] API gateway running with BullMQ
- [ ] Bot-client sends messages to gateway
- [ ] AI worker processes jobs
- [ ] Responses sent via Discord webhooks
- [ ] Multiple personalities selectable
- [ ] Memory system works

### V1 (Next Weekend)

- [ ] BYOK system functional
- [ ] Data migration from Shapes.inc
- [ ] 5+ personalities configured
- [ ] Deployed to Railway

---

## Reference Files from V2

### Critical to Review

- `src/bot.js` - Discord client setup
- `src/webhookManager.js` - Webhook management (⚠️ 2800 lines, extract patterns)
- `src/aiService.js` - AI request handling (1700 lines, extract patterns)
- `src/utils/messageDeduplication.js` - Content hashing
- `src/utils/webhookCache.js` - Webhook caching
- `src/handlers/messageHandler.js` - Message routing

### Useful Utilities to Port

- `src/utils/messageFormatter.js` - Discord formatting
- `src/utils/messageSplitting.js` - 2000 char limit handling
- `src/utils/avatarManager.js` - Avatar URL validation
- `src/utils/media/` - Media processing (audio, images)

### Don't Port

- `src/domain/` - DDD models (V3 uses different architecture)
- `src/application/` - DDD services (V3 uses microservices)
- `src/adapters/` - DDD adapters (V3 has simpler HTTP APIs)

---

## Next Steps

**RIGHT NOW:** Start implementing API Gateway (Phase 1)

1. Create `services/api-gateway/src/index.ts`
2. Set up Express + BullMQ
3. Implement `/ai/generate` endpoint
4. Add request deduplication
5. Test with Postman/curl

Once gateway works, move to Phase 2 (bot-client integration).
