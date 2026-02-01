/**
 * Component Test: PgvectorMemoryAdapter
 *
 * Tests pgvector operations with REAL database (PGlite in-memory PostgreSQL with pgvector).
 *
 * WHY THIS IS CRITICAL:
 * - PgvectorMemoryAdapter is the core of long-term memory storage
 * - Vector similarity search is complex and easy to break with SQL changes
 * - These tests catch issues that unit tests with mocked Prisma would miss
 * - Ensures INSERT with vectors and similarity search actually work
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@tzurot/common-types';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { loadPGliteSchema } from '@tzurot/test-utils';
import { PgvectorMemoryAdapter, type MemoryMetadata } from './PgvectorMemoryAdapter.js';
import type { IEmbeddingService } from '@tzurot/embeddings';

/**
 * Create a deterministic mock embedding service for testing.
 * Returns consistent 384-dimensional embeddings based on text content.
 * Similar texts produce similar embeddings for testing similarity search.
 */
function createDeterministicEmbeddingService(): IEmbeddingService {
  return {
    initialize: async () => true,
    getEmbedding: async (text: string) => {
      // Create deterministic embedding based on text content
      // Use simple hash-based approach for test consistency
      const embedding = new Float32Array(384);
      for (let i = 0; i < 384; i++) {
        // Generate value based on text characters and position
        const charSum = text.split('').reduce((sum, char, idx) => {
          return sum + char.charCodeAt(0) * ((idx % 10) + 1);
        }, 0);
        embedding[i] = Math.sin((charSum + i) * 0.01) * 0.5 + 0.5;
      }
      // Normalize to unit vector for cosine similarity
      const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
      for (let i = 0; i < 384; i++) {
        embedding[i] /= magnitude;
      }
      return embedding;
    },
    getDimensions: () => 384,
    isServiceReady: () => true,
    shutdown: async () => undefined,
  };
}

describe('PgvectorMemoryAdapter Component Test', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;
  let adapter: PgvectorMemoryAdapter;
  let embeddingService: IEmbeddingService;

  // Test fixture IDs
  const testUserId = '00000000-0000-0000-0000-000000000001';
  const testPersonaId = '00000000-0000-0000-0000-000000000002';
  const testPersonalityId = '00000000-0000-0000-0000-000000000003';

  beforeAll(async () => {
    // Set up PGlite with pgvector extension
    pglite = new PGlite({
      extensions: { vector },
    });

    // Load the complete schema from the shared schema file
    // This ensures integration tests stay in sync with migrations
    await pglite.exec(loadPGliteSchema());

    // Create Prisma adapter for PGlite
    const pgliteAdapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter: pgliteAdapter }) as PrismaClient;

    // Seed test data using parameterized queries (not string interpolation)
    const systemPromptId = '00000000-0000-0000-0000-000000000004';

    await prisma.$executeRaw`
      INSERT INTO users (id, discord_id, username, updated_at)
      VALUES (${testUserId}::uuid, '111111111111111111', 'testuser', NOW())
    `;

    await prisma.$executeRaw`
      INSERT INTO personas (id, name, content, preferred_name, owner_id, updated_at)
      VALUES (${testPersonaId}::uuid, 'Test Persona', 'A test persona', 'Tester', ${testUserId}::uuid, NOW())
    `;

    await prisma.$executeRaw`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES (${systemPromptId}::uuid, 'Test Prompt', 'You are a test bot.', NOW())
    `;

    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, display_name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES (${testPersonalityId}::uuid, 'TestBot', 'Test Bot', 'testbot', ${systemPromptId}::uuid, 'Test character', 'Helpful', ${testUserId}::uuid, NOW())
    `;

    // Create embedding service and adapter
    embeddingService = createDeterministicEmbeddingService();
    adapter = new PgvectorMemoryAdapter(prisma, embeddingService);
  }, 60000); // 60 second timeout for PGlite + pgvector WASM initialization

  beforeEach(async () => {
    // Clear memories between tests
    await prisma.$executeRawUnsafe('DELETE FROM memories');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  }, 30000);

  describe('addMemory', () => {
    it('should store a memory with vector embedding', async () => {
      const metadata: MemoryMetadata = {
        personaId: testPersonaId,
        personalityId: testPersonalityId,
        createdAt: Date.now(),
        canonScope: 'personal',
        summaryType: 'conversation',
      };

      await adapter.addMemory({
        text: '{user}: Hello, how are you?\n{assistant}: I am doing well, thank you!',
        metadata,
      });

      // Verify memory was stored
      const result = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM memories
        WHERE persona_id = ${testPersonaId}::uuid
      `;
      expect(Number(result[0].count)).toBe(1);
    });

    it('should store memory with channel context', async () => {
      const metadata: MemoryMetadata = {
        personaId: testPersonaId,
        personalityId: testPersonalityId,
        createdAt: Date.now(),
        canonScope: 'personal',
        summaryType: 'conversation',
        channelId: '123456789012345678',
        guildId: '987654321098765432',
      };

      await adapter.addMemory({
        text: '{user}: What is the weather like?\n{assistant}: It looks sunny today!',
        metadata,
      });

      // Verify channel_id was stored
      const result = await prisma.$queryRaw<{ channel_id: string }[]>`
        SELECT channel_id FROM memories
        WHERE persona_id = ${testPersonaId}::uuid
      `;
      expect(result[0].channel_id).toBe('123456789012345678');
    });

    it('should handle duplicate memory storage (idempotent via ON CONFLICT)', async () => {
      const metadata: MemoryMetadata = {
        personaId: testPersonaId,
        personalityId: testPersonalityId,
        createdAt: Date.now(),
        canonScope: 'personal',
        summaryType: 'conversation',
      };

      const text = '{user}: Duplicate test\n{assistant}: Response';

      // Store same memory twice
      await adapter.addMemory({ text, metadata });
      await adapter.addMemory({ text, metadata });

      // Should only have 1 record (ON CONFLICT DO NOTHING)
      const result = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM memories
        WHERE persona_id = ${testPersonaId}::uuid
      `;
      expect(Number(result[0].count)).toBe(1);
    });
  });

  describe('queryMemories', () => {
    it('should return empty array for empty database', async () => {
      const results = await adapter.queryMemories('test query', {
        personaId: testPersonaId,
        personalityId: testPersonalityId,
        limit: 10,
      });

      expect(results).toEqual([]);
    });

    it('should find semantically similar memories', async () => {
      // Store memories with different content
      const baseMetadata: MemoryMetadata = {
        personaId: testPersonaId,
        personalityId: testPersonalityId,
        createdAt: Date.now(),
        canonScope: 'personal',
        summaryType: 'conversation',
      };

      await adapter.addMemory({
        text: '{user}: I love programming in TypeScript\n{assistant}: TypeScript is great for type safety!',
        metadata: baseMetadata,
      });

      await adapter.addMemory({
        text: '{user}: What is your favorite food?\n{assistant}: I enjoy virtual pizza!',
        metadata: baseMetadata,
      });

      await adapter.addMemory({
        text: '{user}: Tell me about coding\n{assistant}: Coding is writing instructions for computers.',
        metadata: baseMetadata,
      });

      // Query for programming-related content
      // Use low scoreThreshold since our deterministic embeddings aren't semantically meaningful
      // Disable sibling expansion to simplify the test
      const results = await adapter.queryMemories('programming and coding', {
        personaId: testPersonaId,
        personalityId: testPersonalityId,
        limit: 10,
        scoreThreshold: 0.1, // Allow broader matches for test embeddings
        includeSiblings: false, // Skip sibling expansion for simpler test
      });

      // Should return results (with deterministic embeddings)
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('should filter by personaId', async () => {
      // Create a second persona using parameterized query
      const otherPersonaId = '00000000-0000-0000-0000-000000000099';
      await prisma.$executeRaw`
        INSERT INTO personas (id, name, content, preferred_name, owner_id, updated_at)
        VALUES (${otherPersonaId}::uuid, 'Other Persona', 'Another persona', 'Other', ${testUserId}::uuid, NOW())
        ON CONFLICT (id) DO NOTHING
      `;

      const baseMetadata: MemoryMetadata = {
        personaId: testPersonaId,
        personalityId: testPersonalityId,
        createdAt: Date.now(),
        canonScope: 'personal',
        summaryType: 'conversation',
      };

      // Store memory for test persona
      await adapter.addMemory({
        text: '{user}: Memory for test persona\n{assistant}: Acknowledged',
        metadata: baseMetadata,
      });

      // Store memory for other persona
      await adapter.addMemory({
        text: '{user}: Memory for other persona\n{assistant}: Acknowledged',
        metadata: { ...baseMetadata, personaId: otherPersonaId },
      });

      // Verify memories were stored
      const memoryCount = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM memories
      `;
      expect(Number(memoryCount[0].count)).toBe(2);

      // Query for test persona only
      // Use low scoreThreshold since our deterministic embeddings aren't semantically meaningful
      // Disable sibling expansion to simplify the test
      const results = await adapter.queryMemories('Memory persona', {
        personaId: testPersonaId,
        personalityId: testPersonalityId,
        limit: 10,
        scoreThreshold: 0.1, // Allow broader matches for test embeddings
        includeSiblings: false, // Skip sibling expansion for simpler test
      });

      // Should only return memories for test persona
      expect(results.length).toBe(1);
      expect(results[0].metadata?.personaId).toBe(testPersonaId);
    });

    it('should respect limit parameter', async () => {
      const baseMetadata: MemoryMetadata = {
        personaId: testPersonaId,
        personalityId: testPersonalityId,
        createdAt: Date.now(),
        canonScope: 'personal',
        summaryType: 'conversation',
      };

      // Store 5 memories
      for (let i = 0; i < 5; i++) {
        await adapter.addMemory({
          text: `{user}: Test message number ${i}\n{assistant}: Response ${i}`,
          metadata: { ...baseMetadata, createdAt: Date.now() + i },
        });
      }

      // Query with limit 2
      // Use low scoreThreshold since our deterministic embeddings aren't semantically meaningful
      const results = await adapter.queryMemories('test message', {
        personaId: testPersonaId,
        personalityId: testPersonalityId,
        limit: 2,
        scoreThreshold: 0.1, // Allow broader matches for test embeddings
        includeSiblings: false, // Skip sibling expansion for simpler test
      });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should return empty array for empty query', async () => {
      const results = await adapter.queryMemories('', {
        personaId: testPersonaId,
        personalityId: testPersonalityId,
        limit: 10,
      });

      expect(results).toEqual([]);
    });
  });

  describe('queryMemoriesWithChannelScoping', () => {
    it('should prioritize channel-scoped memories in waterfall query', async () => {
      const baseMetadata: MemoryMetadata = {
        personaId: testPersonaId,
        personalityId: testPersonalityId,
        createdAt: Date.now(),
        canonScope: 'personal',
        summaryType: 'conversation',
      };

      const targetChannel = '123456789012345678';
      const otherChannel = '234567890123456789';

      // Store memory in target channel
      await adapter.addMemory({
        text: '{user}: Important discussion in target channel\n{assistant}: Noted',
        metadata: { ...baseMetadata, channelId: targetChannel },
      });

      // Store memory in other channel
      await adapter.addMemory({
        text: '{user}: Discussion in other channel\n{assistant}: Noted',
        metadata: { ...baseMetadata, channelId: otherChannel },
      });

      // Store memory with no channel (global)
      await adapter.addMemory({
        text: '{user}: Global discussion about important topics\n{assistant}: Noted',
        metadata: baseMetadata,
      });

      // Query with channel scoping
      // Use low scoreThreshold since our deterministic embeddings aren't semantically meaningful
      // Disable sibling expansion to simplify the test
      const results = await adapter.queryMemoriesWithChannelScoping('discussion', {
        personaId: testPersonaId,
        personalityId: testPersonalityId,
        channelIds: [targetChannel],
        limit: 10,
        scoreThreshold: 0.1, // Allow broader matches for test embeddings
        includeSiblings: false, // Skip sibling expansion for simpler test
      });

      // Should return results
      expect(results.length).toBeGreaterThan(0);

      // First result should be from target channel (if any channel results exist)
      const channelResults = results.filter(r => r.metadata?.channelId === targetChannel);
      if (channelResults.length > 0) {
        // Channel results should appear first due to waterfall pattern
        const firstChannelIndex = results.findIndex(r => r.metadata?.channelId === targetChannel);
        expect(firstChannelIndex).toBeLessThanOrEqual(results.length / 2);
      }
    });

    it('should fall back to global query when no channelIds provided', async () => {
      const baseMetadata: MemoryMetadata = {
        personaId: testPersonaId,
        personalityId: testPersonalityId,
        createdAt: Date.now(),
        canonScope: 'personal',
        summaryType: 'conversation',
      };

      await adapter.addMemory({
        text: '{user}: Some content\n{assistant}: Response',
        metadata: baseMetadata,
      });

      // Query without channel scoping
      // Use low scoreThreshold since our deterministic embeddings aren't semantically meaningful
      // Disable sibling expansion to simplify the test
      const results = await adapter.queryMemoriesWithChannelScoping('Some content', {
        personaId: testPersonaId,
        personalityId: testPersonalityId,
        limit: 10,
        scoreThreshold: 0.1, // Allow broader matches for test embeddings
        includeSiblings: false, // Skip sibling expansion for simpler test
      });

      expect(results.length).toBe(1);
    });
  });

  describe('healthCheck', () => {
    it('should return true when database is connected', async () => {
      const healthy = await adapter.healthCheck();
      expect(healthy).toBe(true);
    });
  });
});
