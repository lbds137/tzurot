# Shapes.inc Migration & Implementation Guide

## Overview

This guide outlines the strategy and implementation details for migrating from Shapes.inc API dependency to a fully local, self-hosted implementation. The goal is to achieve feature parity while adding custom capabilities.

## Migration Strategy

### Current State
- **Public API Access**: Limited to profile data only
- **Private API Access**: One-time backup via session cookies
- **Bot Dependency**: Currently relies on shapes.inc for AI responses

### Target State
- **Local Data Storage**: All personality data stored locally
- **Custom Implementation**: Self-hosted AI, voice, and memory systems
- **BYOK Architecture**: Users provide their own API keys
- **Enhanced Features**: Capabilities beyond shapes.inc limitations

## Phase 1: Domain Model Extension

### Extended Personality Profile
```javascript
class ExtendedPersonalityProfile extends PersonalityProfile {
  // Existing fields plus:
  - userId: string[]
  - userPrompt: string (AI instructions)
  - jailbreakPrompt: string
  - voiceConfig: {
      model, id, stability, similarity, style
    }
  - imageConfig: {
      size, jailbreak
    }
  - moderationFlags: {
      isHighRisk, isSensitive
    }
  - dataFiles: {
      knowledge, memories, userPersonalization
    }
}
```

### Storage Architecture
```
data/
├── ddd_personalities.json          # Core configs
└── ddd_personality_data/
    └── {personality-id}/
        ├── knowledge.json          # RAG data
        ├── memories.json           # Conversations
        └── user_personalization.json
```

## Phase 2: Memory Systems Implementation

### Short-term Memory (Redis)
```javascript
// Session context management
const contextCache = new LRU({
  max: 1000,
  ttl: 1000 * 60 * 30, // 30 minutes
  updateAgeOnGet: true
});

// Redis for distributed caching
async function storeContext(userId, channelId, context) {
  const key = `context:${userId}:${channelId}`;
  await redis.setex(key, 1800, JSON.stringify(context));
  contextCache.set(key, context);
}
```

### Short-Term Memory (STM) Implementation
Based on shapes.inc's rolling context window approach:

```javascript
// STM Configuration per personality
const STM_LIMIT = 50; // Maximum messages in context window

// Message schema matching shapes.inc
const messageSchema = {
  id: 'uuid',
  reply: 'AI response or null',
  message: 'User message or null', 
  ts: Date.now() / 1000,
  voice_reply_url: 'URL or null',
  attachment_url: 'URL or null',
  attachment_type: 'MIME type or null',
  regenerated_replies: [],
  fallback_model_used: false
};

// Maintain rolling window in Redis for active conversations
async function addToSTM(personalityId, userId, message) {
  const key = `stm:${personalityId}:${userId}`;
  
  // Add to list
  await redis.lpush(key, JSON.stringify(message));
  
  // Trim to maintain window size
  await redis.ltrim(key, 0, STM_LIMIT - 1);
  
  // Set expiry for inactive conversations
  await redis.expire(key, 3600); // 1 hour
}

// Retrieve current context window
async function getSTM(personalityId, userId, limit = 50, beforeTimestamp = null) {
  const key = `stm:${personalityId}:${userId}`;
  
  if (beforeTimestamp) {
    // For historical access, query from PostgreSQL archive
    const result = await db.query(`
      SELECT * FROM message_archive
      WHERE personality_id = $1 
        AND user_id = $2
        AND ts < $3
      ORDER BY ts DESC
      LIMIT $4
    `, [personalityId, userId, beforeTimestamp, limit]);
    
    return result.rows;
  } else {
    // For active conversations, use Redis
    const messages = await redis.lrange(key, 0, limit - 1);
    return messages.map(m => JSON.parse(m)).reverse();
  }
}

// For long-term storage, save to PostgreSQL separately
async function archiveMessage(personalityId, userId, message) {
  await db.query(`
    INSERT INTO message_archive 
    (id, personality_id, user_id, message, reply, ts, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    message.id,
    personalityId,
    userId,
    message.message,
    message.reply,
    message.ts,
    JSON.stringify({
      voice_reply_url: message.voice_reply_url,
      attachment_url: message.attachment_url,
      attachment_type: message.attachment_type,
      regenerated_replies: message.regenerated_replies
    })
  ]);
}
```

### Long-term Memory (Vector Store)
```javascript
// Redis Vector Search configuration
await client.ft.create('knowledge-idx', {
  '$.embedding': {
    type: SchemaFieldTypes.VECTOR,
    algorithm: VectorAlgorithms.HNSW,
    attributes: {
      TYPE: 'FLOAT32',
      DIM: 1536, // OpenAI embeddings
      DISTANCE_METRIC: 'COSINE'
    }
  },
  '$.content': SchemaFieldTypes.TEXT,
  '$.metadata': SchemaFieldTypes.TAG
});
```

### Memory Retrieval Pipeline
1. Check LRU cache for recent context
2. Query Redis for session data
3. Vector search for relevant memories
4. Combine and rank results
5. Format for AI context

## Phase 3: Voice Synthesis Integration

### ElevenLabs WebSocket Implementation
```javascript
function streamTTS(text, voiceId) {
  const ws = new WebSocket(
    `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_turbo_v2`,
    { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } }
  );
  
  ws.on('open', () => {
    ws.send(JSON.stringify({
      text: " ",
      voice_settings: { 
        stability: 0.8, 
        similarity_boost: 0.8 
      }
    }));
    
    ws.send(JSON.stringify({
      text: text + " ",
      flush: true
    }));
  });
  
  // Handle audio chunks for Discord
  ws.on('message', (data) => {
    const response = JSON.parse(data);
    if (response.audio) {
      const audioChunk = Buffer.from(response.audio, 'base64');
      // Convert to Opus for Discord
    }
  });
}
```

### Voice Activity Detection
```javascript
const receiver = connection.receiver;
const audioStream = receiver.subscribe(userId, {
  end: { 
    behavior: EndBehaviorType.AfterSilence, 
    duration: 1000 
  }
});

// Process audio for STT
audioStream
  .pipe(opusDecoder)
  .pipe(pcmConverter)
  .pipe(whisperSTT);
```

## Phase 4: Knowledge & RAG System

### Knowledge Ingestion
```javascript
async function ingestKnowledge(personalityId, documents) {
  for (const doc of documents) {
    // Generate embeddings
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: doc.content
    });
    
    // Store in vector database
    await redis.json.set(
      `knowledge:${personalityId}:${doc.id}`,
      '$',
      {
        content: doc.content,
        embedding: embedding.data[0].embedding,
        metadata: doc.metadata
      }
    );
  }
}
```

### Semantic Search
```javascript
async function searchKnowledge(personalityId, query, limit = 5) {
  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);
  
  // Vector similarity search
  const results = await redis.ft.search(
    'knowledge-idx',
    `*=>[KNN ${limit} @embedding $vec AS score]`,
    {
      PARAMS: {
        vec: Buffer.from(queryEmbedding)
      },
      SORTBY: 'score',
      DIALECT: 2
    }
  );
  
  return results.documents;
}
```

## Phase 5: BYOK Architecture

### Provider Abstraction
```javascript
interface IPersonalityProvider {
  generateResponse(prompt, context);
  generateImage(prompt, settings);
  synthesizeVoice(text, voiceId);
  transcribeAudio(audioBuffer);
}

class OpenAIProvider implements IPersonalityProvider {
  constructor(apiKey) {
    this.client = new OpenAI({ apiKey });
  }
  
  async generateResponse(prompt, context) {
    return await this.client.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: prompt },
        ...context
      ]
    });
  }
}
```

### Configuration Management
```javascript
class PersonalityConfiguration {
  constructor(personality) {
    this.providers = {
      text: this.getTextProvider(personality),
      voice: this.getVoiceProvider(personality),
      image: this.getImageProvider(personality)
    };
  }
  
  getTextProvider(personality) {
    if (personality.useLocalModel) {
      return new OllamaProvider();
    }
    return new OpenAIProvider(process.env.OPENAI_API_KEY);
  }
}
```

## Infrastructure & Deployment

### Railway-Optimized Stack
```yaml
services:
  bot:
    environment:
      - REDIS_URL=${{Redis.REDIS_URL}}
      - DATABASE_URL=${{Postgres.DATABASE_URL}}
    
  redis:
    image: redis/redis-stack
    volumes:
      - redis_data:/data
    
  postgres:
    image: postgres:15
    volumes:
      - postgres_data:/var/lib/postgresql/data
```

### Performance Optimizations

#### Connection Pooling
```javascript
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const redisPool = createPool({
  url: process.env.REDIS_URL,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});
```

#### Caching Strategy
1. **L1 Cache**: In-memory LRU (ultra-fast)
2. **L2 Cache**: Redis (distributed)
3. **L3 Cache**: PostgreSQL (persistent)

#### Cost Optimization
- Semantic caching reduces LLM calls by 30-40%
- Batch operations for embeddings
- Progressive enhancement (basic → premium features)
- Usage-based feature gating

## Migration Timeline

### Week 1: Data Migration
- Import personality backups
- Extend domain models
- Create data repositories

### Week 2: Core Features
- Implement text generation
- Basic memory system
- Session management

### Week 3: Advanced Features
- Voice synthesis integration
- Knowledge/RAG system
- Image generation

### Week 4: Production Ready
- Performance optimization
- Monitoring and logging
- Documentation and testing

## Monitoring & Analytics

```javascript
// Track feature usage
class FeatureAnalytics {
  async trackUsage(feature, userId, metadata) {
    await redis.hincrby(`analytics:${feature}`, 'total', 1);
    await redis.hincrby(`analytics:${feature}`, userId, 1);
    
    // Store detailed event
    await redis.lpush(
      `events:${feature}`,
      JSON.stringify({
        userId,
        timestamp: Date.now(),
        ...metadata
      })
    );
  }
}
```

## Enabling Enhanced Context

The system now includes automatic personality data migration that loads backup data when available. This enhanced context is controlled by a feature flag to prevent duplicating data that shapes.inc already provides.

### When to Enable

Enable the `features.enhanced-context` flag when:
1. Switching to a non-shapes.inc AI service (OpenAI, Claude, etc.)
2. Testing the migration locally
3. Running in a staging environment

### How to Enable

```javascript
// In your environment configuration or startup code
const { getFeatureFlags } = require('./src/application/services/FeatureFlags');
const flags = getFeatureFlags();

// Enable enhanced context
flags.enable('features.enhanced-context');
```

Or via environment variable:
```bash
FEATURE_FLAG_FEATURES_ENHANCED_CONTEXT=true npm start
```

### What It Does

When enabled, the AI service will:
1. Automatically detect and load backup data from `data/personalities/`
2. Include recent chat history (up to 10 messages) in the context
3. Add relevant memories and knowledge to the system prompt
4. Use full personality prompts and jailbreak instructions from backups

## Success Metrics

1. **Feature Parity**: All shapes.inc features working locally
2. **Performance**: <100ms response time for cached queries
3. **Cost Efficiency**: 40% reduction in API costs via caching
4. **Reliability**: 99.9% uptime with automatic failover
5. **User Experience**: Seamless migration with no feature loss