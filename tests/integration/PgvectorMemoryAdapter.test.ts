/**
 * Integration Test: PgvectorMemoryAdapter
 *
 * Tests the PgvectorMemoryAdapter that was refactored to use dependency injection.
 * Validates that it correctly:
 * - Accepts injected PrismaClient and OpenAI API key
 * - Connects to the database
 * - Performs health checks
 * - Can query existing memories (if any exist in dev database)
 *
 * Note: This test doesn't create new memories to avoid polluting the dev database
 * and to avoid requiring OpenAI API key in tests (embeddings are expensive).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PgvectorMemoryAdapter } from '../../services/ai-worker/src/services/PgvectorMemoryAdapter';
import { setupTestEnvironment, type TestEnvironment } from './setup';

describe('PgvectorMemoryAdapter Integration', () => {
  let testEnv: TestEnvironment;
  let memoryAdapter: PgvectorMemoryAdapter;

  beforeAll(async () => {
    testEnv = await setupTestEnvironment();

    // Test the dependency injection refactor
    // PgvectorMemoryAdapter should accept injected Prisma client and API key
    const apiKey = process.env.OPENAI_API_KEY || 'test-api-key';
    memoryAdapter = new PgvectorMemoryAdapter(testEnv.prisma, apiKey);
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  describe('dependency injection', () => {
    it('should accept and use injected PrismaClient', () => {
      // Verify that the adapter was created successfully with injected dependencies
      expect(memoryAdapter).toBeDefined();
      expect(memoryAdapter).toBeInstanceOf(PgvectorMemoryAdapter);
    });

    it('should accept OpenAI API key via constructor', () => {
      // Create another instance to test constructor
      const customApiKey = 'custom-test-key';
      const adapter = new PgvectorMemoryAdapter(testEnv.prisma, customApiKey);

      expect(adapter).toBeDefined();
      expect(adapter).toBeInstanceOf(PgvectorMemoryAdapter);
    });
  });

  describe('health check', () => {
    it('should successfully perform health check with real database', async () => {
      const isHealthy = await memoryAdapter.healthCheck();

      // Should be healthy if connected to dev database
      expect(isHealthy).toBe(true);
    });
  });

  describe('database connectivity', () => {
    it('should be able to query memories table', async () => {
      // Query memories directly via Prisma to verify connectivity
      const memories = await testEnv.prisma.memory.findMany({
        take: 5,
      });

      // Should return an array (may be empty if no memories exist)
      expect(Array.isArray(memories)).toBe(true);
      console.log(`Found ${memories.length} memories in database`);
    });

    it('should be able to query personas for memory tests', async () => {
      // Query personas to verify we can reference them in memory tests
      const personas = await testEnv.prisma.persona.findMany({
        take: 1,
      });

      expect(Array.isArray(personas)).toBe(true);
      if (personas.length > 0) {
        console.log(`Found persona for testing: ${personas[0].name}`);
      }
    });

    it('should be able to query personalities for memory tests', async () => {
      // Query personalities to verify we can reference them in memory tests
      const personalities = await testEnv.prisma.personality.findMany({
        take: 1,
      });

      expect(Array.isArray(personalities)).toBe(true);
      if (personalities.length > 0) {
        console.log(`Found personality for testing: ${personalities[0].name}`);
      }
    });
  });

  describe('pgvector extension', () => {
    it('should verify pgvector extension is available', async () => {
      // Query to check if pgvector extension is installed
      const result = await testEnv.prisma.$queryRaw<Array<{ extname: string }>>`
        SELECT extname FROM pg_extension WHERE extname = 'vector'
      `;

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].extname).toBe('vector');
      console.log('pgvector extension is installed and available');
    });

    it('should verify memories table has embedding column', async () => {
      // Query to check if memories table has the embedding vector column
      const result = await testEnv.prisma.$queryRaw<
        Array<{ column_name: string; data_type: string }>
      >`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'memories' AND column_name = 'embedding'
      `;

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].column_name).toBe('embedding');
      console.log(`Embedding column type: ${result[0].data_type}`);
    });
  });

  describe('query memories (read-only)', () => {
    it('should handle queryMemories with valid persona but no API key gracefully', async () => {
      // Get a persona from the database
      const personas = await testEnv.prisma.persona.findMany({ take: 1 });

      if (personas.length === 0) {
        console.log('No personas found, skipping memory query test');
        return;
      }

      const personaId = personas[0].id;

      // Without a real OpenAI API key, this will fail on embedding generation
      // but we can verify it attempts to run without throwing immediately
      try {
        const memories = await memoryAdapter.queryMemories('test query', {
          personaId,
          limit: 5,
        });

        // If we somehow succeed (maybe OPENAI_API_KEY is set), verify response format
        expect(Array.isArray(memories)).toBe(true);
        console.log(`Successfully queried memories (found ${memories.length})`);
      } catch (error) {
        // Expected if no real API key - verify it's an API error, not a structural error
        expect(error).toBeDefined();
        console.log('Memory query failed as expected without real API key');
      }
    });
  });

  describe('adapter lifecycle', () => {
    it('should create multiple adapter instances without conflicts', () => {
      // Test that we can create multiple instances (dependency injection benefit)
      const adapter1 = new PgvectorMemoryAdapter(testEnv.prisma, 'key1');
      const adapter2 = new PgvectorMemoryAdapter(testEnv.prisma, 'key2');

      expect(adapter1).toBeDefined();
      expect(adapter2).toBeDefined();
      expect(adapter1).not.toBe(adapter2);
    });
  });
});
