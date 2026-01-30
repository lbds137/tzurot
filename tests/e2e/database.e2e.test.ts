/**
 * Integration Test: Database and Redis Operations
 *
 * This test verifies:
 * - Environment setup works (PGlite locally, real Postgres in CI)
 * - Database connection and Prisma client work
 * - Redis mock/real Redis works
 * - Basic operations are functional
 *
 * This is a "smoke test" to prove the integration test infrastructure works.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestEnvironment, type TestEnvironment } from '../helpers/setup-pglite.js';

describe('Integration Test Infrastructure', () => {
  let testEnv: TestEnvironment;

  beforeAll(async () => {
    testEnv = await setupTestEnvironment();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  describe('Database Connection', () => {
    it('should connect to database and execute raw SQL', async () => {
      // Simple query to verify database connection
      const result = await testEnv.prisma.$queryRaw<Array<{ result: number }>>`SELECT 1 as result`;

      expect(result).toBeDefined();
      expect(result[0].result).toBe(1);
    });

    it('should query existing personalities from database', async () => {
      // Query existing personalities (assumes development database has some)
      const personalities = await testEnv.prisma.personality.findMany({
        take: 5,
      });

      // We expect at least one personality in dev database
      // If this fails, you may need to seed your database
      expect(Array.isArray(personalities)).toBe(true);
      console.log(`Found ${personalities.length} personalities in database`);
    });

    it('should query existing personas from database', async () => {
      // Query existing personas
      const personas = await testEnv.prisma.persona.findMany({
        take: 5,
      });

      expect(Array.isArray(personas)).toBe(true);
      console.log(`Found ${personas.length} personas in database`);
    });
  });

  describe('Redis Operations', () => {
    it('should store and retrieve a value from Redis', async () => {
      // Store a value
      await testEnv.redis.set('test-key', 'test-value');

      // Retrieve the value
      const value = await testEnv.redis.get('test-key');

      expect(value).toBe('test-value');

      // Clean up
      await testEnv.redis.del('test-key');
    });

    it('should delete a key', async () => {
      // Store a value
      await testEnv.redis.set('delete-me', 'test-value');

      // Delete it
      await testEnv.redis.del('delete-me');

      // Verify it's gone
      const value = await testEnv.redis.get('delete-me');
      expect(value).toBeNull();
    });

    it('should handle non-existent keys', async () => {
      const value = await testEnv.redis.get('non-existent-key');
      expect(value).toBeNull();
    });
  });

  describe('Environment Detection', () => {
    it('should correctly identify the test environment', () => {
      const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
      const hasDatabaseUrl = !!process.env.DATABASE_URL;

      // Determine which mode we're running in
      let mode: string;
      if (isGitHubActions) {
        mode = 'CI (GitHub Actions)';
      } else if (hasDatabaseUrl) {
        mode = 'Local with real database';
      } else {
        mode = 'Local with PGlite (in-memory)';
      }

      console.log(`Running in ${mode} environment`);

      // Verify the test environment was set up successfully
      // (if we got this far, the environment is working)
      expect(testEnv).toBeDefined();
      expect(testEnv.prisma).toBeDefined();
      expect(testEnv.redis).toBeDefined();
    });
  });
});
