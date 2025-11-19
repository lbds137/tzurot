---
name: tzurot-db-vector
description: PostgreSQL and pgvector patterns for Tzurot v3 - Connection management, vector operations, migrations, and Railway-specific considerations. Use when working with database or memory retrieval.
---

# Tzurot v3 Database & Vector Memory

**Use this skill when:** Working with database queries, pgvector similarity search, migrations, or connection pool management.

## Database Stack

- **PostgreSQL 14+** (Railway managed)
- **Prisma ORM** (type-safe database access)
- **pgvector extension** (vector similarity search for personality memories)

## Core Principles

1. **Connection pooling** - Essential for Railway/containerized environments
2. **Typed queries** - Use Prisma, avoid raw SQL where possible
3. **Migration-first** - Schema changes via Prisma migrations
4. **Vector indexing** - Use ivfflat for fast similarity search
5. **Cleanup policies** - TTLs on conversation history, memory limits

## Connection Management

### Railway/Serverless Considerations

**Problem:** Railway containers restart frequently. Connection pools must handle:
- Cold starts
- Connection limits (Railway shared DB: 100 connections)
- Reconnection after network issues

### Prisma Client Singleton

```typescript
// packages/common-types/src/utils/prisma.ts
import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | undefined;

/**
 * Get Prisma client singleton
 * Reuses connection across requests
 */
export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: ['error', 'warn'],
      // Connection pool configuration
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    // Graceful disconnect on process exit
    process.on('beforeExit', async () => {
      await prisma?.$disconnect();
    });
  }

  return prisma;
}
```

### Connection Pool Size

```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")

  // Connection pool settings for Railway
  // Railway shared DB limit: 100 connections
  // Allocate: 20 per service (3 services = 60 total, leave headroom)
  connectionLimit = 20
}
```

### Usage in Services

```typescript
// ✅ GOOD - Reuse singleton
import { getPrismaClient } from '@tzurot/common-types';

class PersonalityService {
  constructor(private prisma: PrismaClient = getPrismaClient()) {}

  async getPersonality(id: string): Promise<Personality | null> {
    return this.prisma.personality.findUnique({ where: { id } });
  }
}

// ❌ BAD - Creates new connection every time
class PersonalityService {
  async getPersonality(id: string): Promise<Personality | null> {
    const prisma = new PrismaClient(); // New connection!
    const result = await prisma.personality.findUnique({ where: { id } });
    await prisma.$disconnect();
    return result;
  }
}
```

## pgvector Extension

### Schema Setup

```prisma
// prisma/schema.prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector]
}

model Memory {
  id            String   @id @default(uuid())
  personalityId String
  channelId     String
  content       String
  embedding     Unsupported("vector(1536)")?  // OpenAI embedding dimension
  metadata      Json?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  personality Personality @relation(fields: [personalityId], references: [id], onDelete: Cascade)

  @@index([personalityId, channelId])
  @@index([embedding(ops: VectorCosineOps)], type: Ivfflat)
  @@map("memories")
}
```

### Vector Index Creation

```sql
-- Migration: Add ivfflat index for fast similarity search
-- ivfflat: Inverted file with flat compression
-- lists: Number of clusters (rule of thumb: rows / 1000)

CREATE INDEX memories_embedding_idx
ON memories
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);  -- Adjust based on data size
```

## Vector Operations

### Storing Embeddings

```typescript
// ai-worker/services/MemoryService.ts
import { getPrismaClient } from '@tzurot/common-types';

class MemoryService {
  constructor(private prisma: PrismaClient = getPrismaClient()) {}

  async storeMemory(data: {
    personalityId: string;
    channelId: string;
    content: string;
    embedding: number[];
  }): Promise<void> {
    // pgvector expects embedding as string "[0.1,0.2,...]"
    const embeddingStr = `[${data.embedding.join(',')}]`;

    await this.prisma.$executeRaw`
      INSERT INTO memories (id, "personalityId", "channelId", content, embedding, "createdAt", "updatedAt")
      VALUES (
        gen_random_uuid(),
        ${data.personalityId}::uuid,
        ${data.channelId},
        ${data.content},
        ${embeddingStr}::vector,
        NOW(),
        NOW()
      )
    `;
  }
}
```

### Similarity Search

```typescript
// ai-worker/services/MemoryService.ts
interface SimilarMemory {
  id: string;
  content: string;
  similarity: number;  // 1.0 = identical, 0.0 = opposite
  createdAt: Date;
}

class MemoryService {
  async findSimilarMemories(
    personalityId: string,
    queryEmbedding: number[],
    limit: number = 5
  ): Promise<SimilarMemory[]> {
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    // Cosine similarity: 1 - cosine_distance
    // Returns most similar memories first
    const results = await this.prisma.$queryRaw<SimilarMemory[]>`
      SELECT
        id,
        content,
        1 - (embedding <-> ${embeddingStr}::vector) as similarity,
        "createdAt"
      FROM memories
      WHERE "personalityId" = ${personalityId}::uuid
      ORDER BY embedding <-> ${embeddingStr}::vector
      LIMIT ${limit}
    `;

    return results;
  }
}
```

### Distance Functions

pgvector supports three distance metrics:

```sql
-- Cosine distance (most common for embeddings)
-- Range: 0 (identical) to 2 (opposite)
embedding <-> '[0.1,0.2,...]'::vector

-- L2 (Euclidean) distance
embedding <-> '[0.1,0.2,...]'::vector

-- Inner product (dot product, negative)
embedding <#> '[0.1,0.2,...]'::vector
```

**For Tzurot:** Use cosine distance (`<->`) - standard for text embeddings.

## Query Patterns

### Type-Safe Queries with Prisma

```typescript
// ✅ GOOD - Type-safe Prisma query
const personalities = await prisma.personality.findMany({
  where: {
    isActive: true,
  },
  include: {
    llmConfig: true,
  },
  orderBy: {
    name: 'asc',
  },
});

// Prisma infers return type: Personality[]
```

### Raw SQL for Vector Operations

```typescript
// When vector operations are needed, use $queryRaw
const memories = await prisma.$queryRaw<Memory[]>`
  SELECT *
  FROM memories
  WHERE "personalityId" = ${personalityId}::uuid
  AND embedding <-> ${embeddingStr}::vector < 0.5  -- Similarity threshold
  ORDER BY embedding <-> ${embeddingStr}::vector
  LIMIT 10
`;
```

### Transactions

```typescript
// Use transactions for multi-step operations
await prisma.$transaction(async (tx) => {
  // Create personality
  const personality = await tx.personality.create({
    data: {
      name: 'NewPersonality',
      systemPrompt: 'Prompt',
    },
  });

  // Create LLM config
  await tx.llmConfig.create({
    data: {
      personalityId: personality.id,
      model: 'anthropic/claude-sonnet-4.5',
      temperature: 0.8,
    },
  });
});
```

## Migrations

### Creating Migrations

```bash
# Create migration after schema changes
railway run npx prisma migrate dev --name add_memories_table

# Apply migrations in production
railway run npx prisma migrate deploy
```

### Migration Best Practices

**1. Always add migrations, never modify existing ones**
```bash
# ❌ BAD - Modifying existing migration
# Edit: prisma/migrations/20250101_initial/migration.sql

# ✅ GOOD - Create new migration
prisma migrate dev --name add_index_to_memories
```

**2. Test migrations locally first**
```bash
# Test on local database
prisma migrate dev

# If successful, deploy to Railway
railway run prisma migrate deploy
```

**3. Migrations should be idempotent**
```sql
-- ✅ GOOD - Idempotent index creation
CREATE INDEX IF NOT EXISTS memories_embedding_idx
ON memories USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- ❌ BAD - Fails if already exists
CREATE INDEX memories_embedding_idx
ON memories USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

### Running Migrations in Microservices

**Only one service should run migrations** - Avoid race conditions

```typescript
// ✅ GOOD - api-gateway runs migrations on startup
// services/api-gateway/src/index.ts
async function main(): Promise<void> {
  logger.info('[Gateway] Running database migrations...');

  try {
    await prisma.$executeRaw`SELECT 1`; // Connection check
    logger.info('[Gateway] Database connected');
  } catch (error) {
    logger.error({ err: error }, '[Gateway] Database connection failed');
    process.exit(1);
  }

  // Start server...
}

// ❌ BAD - All services run migrations
// Causes race conditions and duplicate migrations
```

## Data Cleanup Patterns

### TTL-Based Cleanup

```typescript
// Clean up old conversation history (30 days)
class ConversationHistoryService {
  async cleanupOldMessages(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.prisma.conversationHistory.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    logger.info(
      `Cleaned up ${result.count} old messages (older than ${daysOld} days)`
    );

    return result.count;
  }
}
```

### Memory Limits Per Personality

```typescript
// Keep only N most recent memories per personality/channel
class MemoryService {
  async enforceMemoryLimit(
    personalityId: string,
    channelId: string,
    maxMemories: number = 1000
  ): Promise<void> {
    // Get count of memories
    const count = await this.prisma.memory.count({
      where: { personalityId, channelId },
    });

    if (count <= maxMemories) {
      return; // Within limit
    }

    // Delete oldest memories beyond limit
    const toDelete = count - maxMemories;

    await this.prisma.$executeRaw`
      DELETE FROM memories
      WHERE id IN (
        SELECT id
        FROM memories
        WHERE "personalityId" = ${personalityId}::uuid
          AND "channelId" = ${channelId}
        ORDER BY "createdAt" ASC
        LIMIT ${toDelete}
      )
    `;

    logger.info(`Deleted ${toDelete} old memories for ${personalityId}`);
  }
}
```

## Indexing Strategy

### What to Index

**✅ Always index:**
- Foreign keys
- Frequently filtered columns (WHERE clauses)
- Columns used in ORDER BY
- Vector columns (ivfflat index)

**❌ Don't index:**
- Text/blob columns
- Low cardinality columns (few unique values)
- Rarely queried columns

### Index Examples

```prisma
model ConversationHistory {
  id            String   @id @default(uuid())
  channelId     String
  personalityId String
  userId        String
  role          String   // 'user' | 'assistant'
  content       String
  createdAt     DateTime @default(now())

  // Composite index for common query pattern
  @@index([channelId, personalityId, createdAt])

  // Individual indexes for filtering
  @@index([userId])
  @@index([personalityId])
}
```

## Error Handling

### Connection Errors

```typescript
class DatabaseService {
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxRetries) throw error;

        // Check if error is connection-related
        if (
          error instanceof Error &&
          (error.message.includes('ECONNREFUSED') ||
           error.message.includes('ETIMEDOUT') ||
           error.message.includes('Connection terminated'))
        ) {
          logger.warn(
            `Database connection error (attempt ${attempt}/${maxRetries}), retrying...`
          );
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }

        // Non-connection error, don't retry
        throw error;
      }
    }

    throw new Error('Should not reach here');
  }
}
```

### Unique Constraint Violations

```typescript
async function createPersonality(data: PersonalityData): Promise<Personality> {
  try {
    return await prisma.personality.create({ data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        // Unique constraint violation
        throw new Error(`Personality with name '${data.name}' already exists`);
      }
    }
    throw error;
  }
}
```

## Performance Optimization

### Query Optimization

```typescript
// ❌ BAD - N+1 query problem
const personalities = await prisma.personality.findMany();
for (const personality of personalities) {
  const config = await prisma.llmConfig.findUnique({
    where: { personalityId: personality.id },
  });
}

// ✅ GOOD - Use include to fetch relations
const personalities = await prisma.personality.findMany({
  include: {
    llmConfig: true,
  },
});
```

### Pagination

```typescript
// Use cursor-based pagination for large datasets
async function getConversationHistory(
  channelId: string,
  cursor?: string,
  limit: number = 50
): Promise<{ messages: Message[]; nextCursor?: string }> {
  const messages = await prisma.conversationHistory.findMany({
    where: { channelId },
    take: limit + 1, // Fetch one extra to check if more exist
    ...(cursor && {
      cursor: { id: cursor },
      skip: 1, // Skip the cursor itself
    }),
    orderBy: { createdAt: 'desc' },
  });

  let nextCursor: string | undefined;
  if (messages.length > limit) {
    const nextItem = messages.pop()!;
    nextCursor = nextItem.id;
  }

  return { messages, nextCursor };
}
```

## Testing Database Code

### Use Test Database

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/tzurot_test',
    },
  },
});
```

### Mock Prisma in Unit Tests

```typescript
// Create mock Prisma client
function createMockPrisma(): PrismaClient {
  return {
    personality: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $disconnect: vi.fn(),
  } as unknown as PrismaClient;
}

describe('PersonalityService', () => {
  it('should get personality by ID', async () => {
    const mockPrisma = createMockPrisma();
    vi.mocked(mockPrisma.personality.findUnique).mockResolvedValue({
      id: 'test-id',
      name: 'Test',
      // ...
    });

    const service = new PersonalityService(mockPrisma);
    const result = await service.getPersonality('test-id');

    expect(result).toBeDefined();
    expect(mockPrisma.personality.findUnique).toHaveBeenCalledWith({
      where: { id: 'test-id' },
    });
  });
});
```

## References

- Prisma docs: https://www.prisma.io/docs
- pgvector docs: https://github.com/pgvector/pgvector
- Railway PostgreSQL: https://docs.railway.app/databases/postgresql
- Schema: `prisma/schema.prisma`
