/**
 * Integration Test: LlmConfigService
 *
 * Tests the LlmConfigService against a real database:
 * - CRUD operations work with actual Prisma queries
 * - Scope-based access control (GLOBAL vs USER)
 * - Name uniqueness validation
 * - Delete constraint checking
 *
 * Uses PGLite for fast, isolated database tests.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  PrismaClient,
  generateUserUuid,
  generateLlmConfigUuid,
  generatePersonalityUuid,
  generateUserPersonalityConfigUuid,
} from '@tzurot/common-types';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { setupTestEnvironment, loadPGliteSchema, type TestEnvironment } from '@tzurot/test-utils';
import { LlmConfigService, type LlmConfigScope } from './LlmConfigService.js';

describe('LlmConfigService Integration', () => {
  let testEnv: TestEnvironment;
  let pglite: PGlite;
  let prisma: PrismaClient;
  let service: LlmConfigService;
  let testUserId: string;
  let adminUserId: string;

  const TEST_DISCORD_ID = '12345678901234567890';
  const ADMIN_DISCORD_ID = '98765432109876543210';

  beforeAll(async () => {
    testEnv = await setupTestEnvironment();

    // Set up PGLite with Prisma
    pglite = new PGlite({ extensions: { vector } });
    await pglite.exec(loadPGliteSchema());
    const adapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter }) as PrismaClient;

    // Create service (no cache for integration tests)
    service = new LlmConfigService(prisma);
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    // Clean up test data - order matters due to foreign keys
    await prisma.userPersonalityConfig.deleteMany({});
    await prisma.personalityDefaultConfig.deleteMany({});
    await prisma.llmConfig.deleteMany({});
    await prisma.personality.deleteMany({});
    await prisma.user.deleteMany({});

    // Create test users
    testUserId = generateUserUuid(TEST_DISCORD_ID);
    adminUserId = generateUserUuid(ADMIN_DISCORD_ID);

    await prisma.user.createMany({
      data: [
        { id: testUserId, discordId: TEST_DISCORD_ID, username: 'test-user' },
        { id: adminUserId, discordId: ADMIN_DISCORD_ID, username: 'admin-user' },
      ],
    });
  });

  describe('create', () => {
    it('should create a global config with GLOBAL scope', async () => {
      const scope: LlmConfigScope = { type: 'GLOBAL' };
      const data = {
        name: 'Global Preset',
        model: 'anthropic/claude-sonnet-4',
        description: 'A global preset',
        memoryScoreThreshold: 0.75,
        memoryLimit: 50,
        contextWindowTokens: 100000,
      };

      const config = await service.create(scope, data, adminUserId);

      expect(config.name).toBe('Global Preset');
      expect(config.model).toBe('anthropic/claude-sonnet-4');
      expect(config.isGlobal).toBe(true);
      expect(config.ownerId).toBe(adminUserId);
    });

    it('should create a user config with USER scope', async () => {
      const scope: LlmConfigScope = {
        type: 'USER',
        userId: testUserId,
        discordId: TEST_DISCORD_ID,
      };
      const data = {
        name: 'My Preset',
        model: 'openai/gpt-4o',
      };

      const config = await service.create(scope, data, testUserId);

      expect(config.name).toBe('My Preset');
      expect(config.isGlobal).toBe(false);
      expect(config.ownerId).toBe(testUserId);
    });

    it('should apply default values for optional fields', async () => {
      const scope: LlmConfigScope = {
        type: 'USER',
        userId: testUserId,
        discordId: TEST_DISCORD_ID,
      };
      const data = {
        name: 'Minimal Preset',
        model: 'test-model',
      };

      const config = await service.create(scope, data, testUserId);

      // Check defaults are applied
      expect(config.provider).toBe('openrouter');
      expect(config.maxReferencedMessages).toBeGreaterThan(0);
      expect(config.maxMessages).toBeGreaterThan(0);
      expect(config.maxImages).toBeGreaterThan(0);
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      // Create a mix of global and user configs
      await prisma.llmConfig.createMany({
        data: [
          {
            id: generateLlmConfigUuid('global-1'),
            name: 'Global Default',
            model: 'model-1',
            provider: 'openrouter',
            isGlobal: true,
            isDefault: true,
            ownerId: adminUserId,
            maxReferencedMessages: 10,
            contextWindowTokens: 100000,
            maxMessages: 25,
            maxImages: 5,
          },
          {
            id: generateLlmConfigUuid('global-2'),
            name: 'Global Alt',
            model: 'model-2',
            provider: 'openrouter',
            isGlobal: true,
            isDefault: false,
            ownerId: adminUserId,
            maxReferencedMessages: 10,
            contextWindowTokens: 100000,
            maxMessages: 25,
            maxImages: 5,
          },
          {
            id: generateLlmConfigUuid('user-1'),
            name: 'User Preset',
            model: 'model-3',
            provider: 'openrouter',
            isGlobal: false,
            isDefault: false,
            ownerId: testUserId,
            maxReferencedMessages: 10,
            contextWindowTokens: 100000,
            maxMessages: 25,
            maxImages: 5,
          },
        ],
      });
    });

    it('should list all configs with GLOBAL scope', async () => {
      const scope: LlmConfigScope = { type: 'GLOBAL' };

      const configs = await service.list(scope);

      expect(configs).toHaveLength(3);
      expect(configs.map(c => c.name)).toContain('Global Default');
      expect(configs.map(c => c.name)).toContain('Global Alt');
      expect(configs.map(c => c.name)).toContain('User Preset');
    });

    it('should list global configs + user configs with USER scope', async () => {
      const scope: LlmConfigScope = {
        type: 'USER',
        userId: testUserId,
        discordId: TEST_DISCORD_ID,
      };

      const configs = await service.list(scope);

      expect(configs).toHaveLength(3);
      // Should include global configs
      expect(configs.some(c => c.name === 'Global Default')).toBe(true);
      expect(configs.some(c => c.name === 'Global Alt')).toBe(true);
      // Should include user's own config
      expect(configs.some(c => c.name === 'User Preset')).toBe(true);
    });

    it('should not include other users configs in USER scope', async () => {
      // Create another user's config
      const otherUserId = generateUserUuid('other-user');
      await prisma.user.create({
        data: { id: otherUserId, discordId: 'other-discord-id', username: 'other' },
      });
      await prisma.llmConfig.create({
        data: {
          id: generateLlmConfigUuid('other-user-config'),
          name: 'Other User Preset',
          model: 'model-x',
          provider: 'openrouter',
          isGlobal: false,
          ownerId: otherUserId,
          maxReferencedMessages: 10,
          contextWindowTokens: 100000,
          maxMessages: 25,
          maxImages: 5,
        },
      });

      const scope: LlmConfigScope = {
        type: 'USER',
        userId: testUserId,
        discordId: TEST_DISCORD_ID,
      };
      const configs = await service.list(scope);

      // Should not include other user's private config
      expect(configs.some(c => c.name === 'Other User Preset')).toBe(false);
    });
  });

  describe('update', () => {
    let configId: string;

    beforeEach(async () => {
      configId = generateLlmConfigUuid('update-test');
      await prisma.llmConfig.create({
        data: {
          id: configId,
          name: 'Original Name',
          model: 'original-model',
          provider: 'openrouter',
          isGlobal: false,
          ownerId: testUserId,
          maxReferencedMessages: 10,
          contextWindowTokens: 100000,
          maxMessages: 25,
          maxImages: 5,
        },
      });
    });

    it('should update config fields', async () => {
      const updated = await service.update(configId, {
        name: 'Updated Name',
        model: 'new-model',
        memoryScoreThreshold: 0.9,
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.model).toBe('new-model');
      expect(updated.memoryScoreThreshold?.toNumber()).toBe(0.9);
    });

    it('should only update provided fields', async () => {
      const original = await service.getById(configId);

      await service.update(configId, { name: 'Only Name Changed' });

      const updated = await service.getById(configId);
      expect(updated?.name).toBe('Only Name Changed');
      expect(updated?.model).toBe(original?.model);
    });
  });

  describe('delete', () => {
    it('should delete a config', async () => {
      const configId = generateLlmConfigUuid('delete-test');
      await prisma.llmConfig.create({
        data: {
          id: configId,
          name: 'To Delete',
          model: 'model',
          provider: 'openrouter',
          isGlobal: false,
          ownerId: testUserId,
          maxReferencedMessages: 10,
          contextWindowTokens: 100000,
          maxMessages: 25,
          maxImages: 5,
        },
      });

      await service.delete(configId);

      const config = await service.getById(configId);
      expect(config).toBeNull();
    });
  });

  describe('checkNameExists', () => {
    beforeEach(async () => {
      await prisma.llmConfig.create({
        data: {
          id: generateLlmConfigUuid('existing-global'),
          name: 'Existing Global',
          model: 'model',
          provider: 'openrouter',
          isGlobal: true,
          ownerId: adminUserId,
          maxReferencedMessages: 10,
          contextWindowTokens: 100000,
          maxMessages: 25,
          maxImages: 5,
        },
      });
      await prisma.llmConfig.create({
        data: {
          id: generateLlmConfigUuid('existing-user'),
          name: 'Existing User',
          model: 'model',
          provider: 'openrouter',
          isGlobal: false,
          ownerId: testUserId,
          maxReferencedMessages: 10,
          contextWindowTokens: 100000,
          maxMessages: 25,
          maxImages: 5,
        },
      });
    });

    it('should detect existing global name in GLOBAL scope', async () => {
      const scope: LlmConfigScope = { type: 'GLOBAL' };

      const result = await service.checkNameExists('Existing Global', scope);

      expect(result.exists).toBe(true);
    });

    it('should not detect user name in GLOBAL scope', async () => {
      const scope: LlmConfigScope = { type: 'GLOBAL' };

      const result = await service.checkNameExists('Existing User', scope);

      expect(result.exists).toBe(false);
    });

    it('should detect existing user name in USER scope', async () => {
      const scope: LlmConfigScope = {
        type: 'USER',
        userId: testUserId,
        discordId: TEST_DISCORD_ID,
      };

      const result = await service.checkNameExists('Existing User', scope);

      expect(result.exists).toBe(true);
    });

    it('should allow same name for different users', async () => {
      // User B tries to use same name as User A
      const scope: LlmConfigScope = {
        type: 'USER',
        userId: adminUserId,
        discordId: ADMIN_DISCORD_ID,
      };

      const result = await service.checkNameExists('Existing User', scope);

      expect(result.exists).toBe(false);
    });

    it('should exclude specified ID from check (for updates)', async () => {
      const existingId = generateLlmConfigUuid('existing-global');
      const scope: LlmConfigScope = { type: 'GLOBAL' };

      const result = await service.checkNameExists('Existing Global', scope, existingId);

      expect(result.exists).toBe(false);
    });
  });

  describe('checkDeleteConstraints', () => {
    it('should allow deletion when config has no references', async () => {
      const configId = generateLlmConfigUuid('deletable');
      await prisma.llmConfig.create({
        data: {
          id: configId,
          name: 'Deletable',
          model: 'model',
          provider: 'openrouter',
          isGlobal: false,
          ownerId: testUserId,
          maxReferencedMessages: 10,
          contextWindowTokens: 100000,
          maxMessages: 25,
          maxImages: 5,
        },
      });

      const constraint = await service.checkDeleteConstraints(configId);

      expect(constraint).toBeNull();
    });

    it('should block deletion when config is used by personality default', async () => {
      const configId = generateLlmConfigUuid('used-by-personality');
      await prisma.llmConfig.create({
        data: {
          id: configId,
          name: 'Used Config',
          model: 'model',
          provider: 'openrouter',
          isGlobal: true,
          ownerId: adminUserId,
          maxReferencedMessages: 10,
          contextWindowTokens: 100000,
          maxMessages: 25,
          maxImages: 5,
        },
      });

      // Create personality that references this config
      const personalityId = generatePersonalityUuid('test-personality');
      await prisma.personality.create({
        data: {
          id: personalityId,
          name: 'test-personality',
          slug: 'test-personality',
          displayName: 'Test',
          characterInfo: 'Test character info',
          personalityTraits: 'Test traits',
          ownerId: adminUserId,
        },
      });

      // Link config to personality
      await prisma.personalityDefaultConfig.create({
        data: {
          personalityId,
          llmConfigId: configId,
        },
      });

      const constraint = await service.checkDeleteConstraints(configId);

      expect(constraint).toMatch(/personality/i);
    });

    it('should block deletion when config is used by user override', async () => {
      const configId = generateLlmConfigUuid('used-by-user');
      await prisma.llmConfig.create({
        data: {
          id: configId,
          name: 'User Override Config',
          model: 'model',
          provider: 'openrouter',
          isGlobal: true,
          ownerId: adminUserId,
          maxReferencedMessages: 10,
          contextWindowTokens: 100000,
          maxMessages: 25,
          maxImages: 5,
        },
      });

      // Create personality for user override
      const personalityId = generatePersonalityUuid('for-override');
      await prisma.personality.create({
        data: {
          id: personalityId,
          name: 'for-override',
          slug: 'for-override',
          displayName: 'For Override',
          characterInfo: 'Character info',
          personalityTraits: 'Traits',
          ownerId: adminUserId,
        },
      });

      // Create user override referencing this config
      await prisma.userPersonalityConfig.create({
        data: {
          id: generateUserPersonalityConfigUuid(testUserId, personalityId),
          userId: testUserId,
          personalityId,
          llmConfigId: configId,
        },
      });

      const constraint = await service.checkDeleteConstraints(configId);

      expect(constraint).toMatch(/user override/i);
    });
  });

  describe('setAsDefault', () => {
    it('should set config as system default and clear previous default', async () => {
      // Create two global configs
      const oldDefaultId = generateLlmConfigUuid('old-default');
      const newDefaultId = generateLlmConfigUuid('new-default');

      await prisma.llmConfig.createMany({
        data: [
          {
            id: oldDefaultId,
            name: 'Old Default',
            model: 'model',
            provider: 'openrouter',
            isGlobal: true,
            isDefault: true, // Current default
            ownerId: adminUserId,
            maxReferencedMessages: 10,
            contextWindowTokens: 100000,
            maxMessages: 25,
            maxImages: 5,
          },
          {
            id: newDefaultId,
            name: 'New Default',
            model: 'model',
            provider: 'openrouter',
            isGlobal: true,
            isDefault: false,
            ownerId: adminUserId,
            maxReferencedMessages: 10,
            contextWindowTokens: 100000,
            maxMessages: 25,
            maxImages: 5,
          },
        ],
      });

      await service.setAsDefault(newDefaultId);

      const oldConfig = await service.getById(oldDefaultId);
      const newConfig = await service.getById(newDefaultId);

      expect(oldConfig?.isDefault).toBe(false);
      expect(newConfig?.isDefault).toBe(true);
    });
  });

  describe('formatConfigDetail', () => {
    it('should format raw config for API response', async () => {
      const configId = generateLlmConfigUuid('format-test');
      await prisma.llmConfig.create({
        data: {
          id: configId,
          name: 'Format Test',
          description: 'Test description',
          model: 'test-model',
          provider: 'openrouter',
          visionModel: 'vision-model',
          isGlobal: true,
          isDefault: false,
          ownerId: adminUserId,
          maxReferencedMessages: 15,
          memoryScoreThreshold: 0.8,
          memoryLimit: 100,
          contextWindowTokens: 128000,
          maxMessages: 50,
          maxAge: 3600,
          maxImages: 10,
          advancedParameters: { temperature: 0.7 },
        },
      });

      const raw = await service.getById(configId);
      const formatted = service.formatConfigDetail(raw!);

      expect(formatted).toEqual({
        id: configId,
        name: 'Format Test',
        description: 'Test description',
        provider: 'openrouter',
        model: 'test-model',
        visionModel: 'vision-model',
        isGlobal: true,
        isDefault: false,
        isFreeDefault: false,
        maxReferencedMessages: 15,
        memoryScoreThreshold: 0.8,
        memoryLimit: 100,
        contextWindowTokens: 128000,
        maxMessages: 50,
        maxAge: 3600,
        maxImages: 10,
        params: { temperature: 0.7 },
      });
    });
  });
});
