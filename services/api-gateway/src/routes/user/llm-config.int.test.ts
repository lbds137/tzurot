/**
 * Integration Test: LLM Config Resolution
 *
 * Tests the config resolution endpoint with a real database:
 * - Endpoint exists and returns 200
 * - Returns personality defaults when no user override exists
 * - Returns 400 for invalid request body
 *
 * This catches bugs where unit tests pass but runtime flow is broken.
 *
 * Note: User override tests (defaultLlmConfigId, per-personality overrides) require
 * complex database setup with relation queries. Those scenarios are thoroughly
 * covered by unit tests in llm-config.test.ts and the LlmConfigResolver tests.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import {
  PrismaClient,
  generateUserUuid,
  generatePersonaUuid,
  generatePersonalityUuid,
} from '@tzurot/common-types';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { setupTestEnvironment, loadPGliteSchema, type TestEnvironment } from '@tzurot/test-utils';

// Test user Discord ID (must be <= 20 chars for varchar(20))
const TEST_DISCORD_ID = '12345678901234567890';
// Personality ID must be a valid UUID for the database
const TEST_PERSONALITY_ID = generatePersonalityUuid('test-personality');

// Mock the auth middleware to pass through with our test user ID
vi.mock('../../services/AuthMiddleware.js', () => ({
  requireUserAuth: vi.fn(() => (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { userId: string }).userId = TEST_DISCORD_ID;
    next();
  }),
}));

// Import after mocking
const { createLlmConfigRoutes } = await import('./llm-config.js');

describe('LLM Config Resolution Integration', () => {
  let testEnv: TestEnvironment;
  let app: Express;
  let pglite: PGlite;
  let prisma: PrismaClient;
  let testUserId: string;

  beforeAll(async () => {
    testEnv = await setupTestEnvironment();

    // Set up PGLite with Prisma
    pglite = new PGlite({ extensions: { vector } });
    await pglite.exec(loadPGliteSchema());
    const adapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter }) as PrismaClient;

    // Create minimal Express app
    app = express();
    app.use(express.json());

    // Mount LLM config routes (auth is mocked above)
    const router = createLlmConfigRoutes(prisma);
    app.use('/user/llm-config', router);
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    // Clean up test data - order matters due to foreign keys
    await prisma.userPersonalityConfig.deleteMany({});

    // Find and delete user-owned data (configs, personas)
    const testUser = await prisma.user.findFirst({
      where: { discordId: TEST_DISCORD_ID },
    });
    if (testUser) {
      // Clear default persona reference first
      await prisma.user.update({
        where: { id: testUser.id },
        data: { defaultPersonaId: null, defaultLlmConfigId: null },
      });
      await prisma.llmConfig.deleteMany({ where: { ownerId: testUser.id } });
      await prisma.persona.deleteMany({ where: { ownerId: testUser.id } });
    }

    await prisma.user.deleteMany({ where: { discordId: TEST_DISCORD_ID } });

    // Create test user first (persona needs owner)
    const personaId = generatePersonaUuid(TEST_DISCORD_ID);
    testUserId = generateUserUuid(TEST_DISCORD_ID);

    // Create user without persona first
    await prisma.user.create({
      data: {
        id: testUserId,
        discordId: TEST_DISCORD_ID,
        username: 'integration-test-user',
      },
    });

    // Create persona owned by user
    await prisma.persona.create({
      data: {
        id: personaId,
        name: TEST_DISCORD_ID,
        content: '',
        ownerId: testUserId,
      },
    });

    // Link persona as user's default
    await prisma.user.update({
      where: { id: testUserId },
      data: { defaultPersonaId: personaId },
    });
  });

  describe('POST /user/llm-config/resolve', () => {
    const mockPersonality = {
      id: TEST_PERSONALITY_ID,
      name: 'test-personality',
      displayName: 'Test Personality',
      model: 'default-model',
    };

    it('should return personality defaults when no user override exists', async () => {
      const response = await request(app).post('/user/llm-config/resolve').send({
        personalityId: TEST_PERSONALITY_ID,
        personalityConfig: mockPersonality,
      });

      expect(response.status).toBe(200);
      expect(response.body.source).toBe('personality');
      // LlmConfigResolver only resolves LLM fields (model, reasoning, etc.)
      // Context/memory fields (maxMessages, maxAge, maxImages) are resolved via ConfigCascadeResolver
      expect(response.body.config).toEqual(
        expect.objectContaining({
          model: 'default-model',
        })
      );
    });

    it('should return 400 for invalid request body', async () => {
      const response = await request(app).post('/user/llm-config/resolve').send({
        // Missing required fields
      });

      expect(response.status).toBe(400);
    });
  });
});
