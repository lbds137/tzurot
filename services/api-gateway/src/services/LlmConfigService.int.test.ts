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
  generatePersonaUuid,
  generateLlmConfigUuid,
  generatePersonalityUuid,
  generateUserPersonalityConfigUuid,
} from '@tzurot/common-types';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import {
  setupTestEnvironment,
  loadPGliteSchema,
  seedUserWithPersona,
  type TestEnvironment,
} from '@tzurot/test-utils';
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
    // Clean up test data - order matters due to foreign keys.
    // Users must be deleted BEFORE personas because Phase 5 made
    // users.default_persona_id FK Restrict (user cascade-deletes its own
    // personas via the reverse owner FK).
    await prisma.userPersonalityConfig.deleteMany({});
    await prisma.personalityDefaultConfig.deleteMany({});
    await prisma.llmConfig.deleteMany({});
    await prisma.personality.deleteMany({});
    await prisma.user.deleteMany({});

    // Create test users. Phase 5b made users.default_persona_id NOT NULL, so
    // each user must be seeded with a matching persona via the CTE helper.
    testUserId = generateUserUuid(TEST_DISCORD_ID);
    adminUserId = generateUserUuid(ADMIN_DISCORD_ID);

    await seedUserWithPersona(prisma, {
      userId: testUserId,
      personaId: generatePersonaUuid('test-user', testUserId),
      discordId: TEST_DISCORD_ID,
      username: 'test-user',
      personaName: 'test-user',
    });
    await seedUserWithPersona(prisma, {
      userId: adminUserId,
      personaId: generatePersonaUuid('admin-user', adminUserId),
      discordId: ADMIN_DISCORD_ID,
      username: 'admin-user',
      personaName: 'admin-user',
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
      await seedUserWithPersona(prisma, {
        userId: otherUserId,
        personaId: generatePersonaUuid('other', otherUserId),
        discordId: 'other-discord-id',
        username: 'other',
        personaName: 'other',
      });
      await prisma.llmConfig.create({
        data: {
          id: generateLlmConfigUuid('other-user-config'),
          name: 'Other User Preset',
          model: 'model-x',
          provider: 'openrouter',
          isGlobal: false,
          ownerId: otherUserId,
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

  /**
   * Regression test for the phantom-PK-collision bug observed 2026-04-19.
   *
   * Before fix: `id: generateLlmConfigUuid(name)` (deterministic UUIDv5 from
   * the user-editable name) meant the flow below hit PK collision on step 4:
   *
   *   1. Create "X"              → id U1
   *   2. Clone "X" → "X (Copy)"  → id U2
   *   3. Rename "X (Copy)" → "Repurposed"  (row is now (id=U2, name="Repurposed"))
   *   4. Clone "X" again → name "X (Copy)" free at name level, BUT id U2
   *      is taken → 500 `Unique constraint failed on the fields: (id)`
   *
   * After fix: new rows get UUIDv7 (no dependency on name), and the
   * @@unique([ownerId, name]) DB constraint enforces uniqueness at the
   * correct level. Step 4 now succeeds with a fresh random id.
   */
  describe('clone-after-rename regression (phantom PK collision)', () => {
    const userScope = (): LlmConfigScope => ({
      type: 'USER',
      userId: testUserId,
      discordId: TEST_DISCORD_ID,
    });

    it('allows re-cloning the original after a prior clone was renamed', async () => {
      // Step 1: create the original
      const original = await service.create(
        userScope(),
        { name: 'X', model: 'anthropic/claude-sonnet-4' },
        testUserId
      );
      expect(original.name).toBe('X');

      // Step 2: first clone — server picks "X (Copy)" via autoSuffixOnCollision
      const firstClone = await service.create(
        userScope(),
        {
          name: 'X (Copy)',
          model: 'anthropic/claude-sonnet-4',
          autoSuffixOnCollision: true,
        },
        testUserId
      );
      expect(firstClone.name).toBe('X (Copy)');
      expect(firstClone.id).not.toBe(original.id);

      // Step 3: rename the clone — row still exists, but "X (Copy)" is
      // now a free name slot at the application level.
      await service.update(firstClone.id, { name: 'Repurposed' });

      // Step 4: the bug scenario. Under the old deterministic-UUID scheme
      // this would fail with "Unique constraint failed on the fields: (id)"
      // because the new row's computed UUID would match the renamed row's PK.
      const secondClone = await service.create(
        userScope(),
        {
          name: 'X (Copy)',
          model: 'anthropic/claude-sonnet-4',
          autoSuffixOnCollision: true,
        },
        testUserId
      );

      expect(secondClone.name).toBe('X (Copy)');
      expect(secondClone.id).not.toBe(original.id);
      expect(secondClone.id).not.toBe(firstClone.id);

      // Sanity: all three rows coexist under distinct ids.
      const allForUser = await prisma.llmConfig.findMany({
        where: { ownerId: testUserId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      expect(allForUser.map(c => c.name)).toEqual(['Repurposed', 'X', 'X (Copy)']);
    });

    it('generates UUIDv7 ids for newly-created configs', async () => {
      const config = await service.create(
        userScope(),
        { name: 'V7 Test', model: 'anthropic/claude-sonnet-4' },
        testUserId
      );
      // UUIDv7: version digit at position 14 (0-indexed) is '7'.
      expect(config.id[14]).toBe('7');
    });

    it('server-side suffix bumping skips existing (Copy N) variants in a single query', async () => {
      // Seed the user's preset slot with a base + two copy variants
      await service.create(
        userScope(),
        { name: 'Seed', model: 'anthropic/claude-sonnet-4' },
        testUserId
      );
      await service.create(
        userScope(),
        {
          name: 'Seed (Copy)',
          model: 'anthropic/claude-sonnet-4',
          autoSuffixOnCollision: true,
        },
        testUserId
      );
      await service.create(
        userScope(),
        {
          name: 'Seed (Copy 5)',
          model: 'anthropic/claude-sonnet-4',
          autoSuffixOnCollision: true,
        },
        testUserId
      );

      // Now request "Seed (Copy)" again — server should find "Seed (Copy)"
      // is taken, bump to "(Copy 2)", see that's free, and use it.
      const result = await service.create(
        userScope(),
        {
          name: 'Seed (Copy)',
          model: 'anthropic/claude-sonnet-4',
          autoSuffixOnCollision: true,
        },
        testUserId
      );

      expect(result.name).toBe('Seed (Copy 2)');
    });

    it('enforces (owner_id, name) uniqueness at the DB level for non-autoSuffix creates', async () => {
      await service.create(
        userScope(),
        { name: 'Strict', model: 'anthropic/claude-sonnet-4' },
        testUserId
      );

      // Regular create (no autoSuffixOnCollision) with a colliding name
      // bypasses the app-level check in this test because we're calling the
      // service directly, not the route. The DB constraint must still bite.
      await expect(
        service.create(
          userScope(),
          { name: 'Strict', model: 'anthropic/claude-sonnet-4' },
          testUserId
        )
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });
});
