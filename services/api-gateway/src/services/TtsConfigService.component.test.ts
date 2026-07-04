/**
 * Integration Test: TtsConfigService
 *
 * Tests against a real (PGLite) database:
 * - CRUD operations work with actual Prisma queries
 * - System-globals bootstrap fires when GLOBAL list is empty AND a
 *   superuser exists; skips when no superuser yet
 * - Service-layer isTtsProviderId enforcement on update path
 * - Scope-based access control (GLOBAL vs USER)
 * - Name uniqueness via citext
 * - Delete constraints (personality + user override references)
 * - setAsDefault / setAsFreeDefault pointer repointing via AdminSettings
 *
 * Mirrors LlmConfigService.component.test.ts shape.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  generateUserUuid,
  generatePersonaUuid,
  newTtsConfigId,
} from '@tzurot/common-types/utils/deterministicUuid';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import {
  createTestPGlite,
  setupTestEnvironment,
  loadPGliteSchema,
  seedUserWithPersona,
  type TestEnvironment,
} from '@tzurot/test-utils';
import {
  TtsConfigService,
  TtsInvalidProviderError,
  type TtsConfigScope,
} from './TtsConfigService.js';

describe('TtsConfigService Integration', () => {
  let testEnv: TestEnvironment;
  let pglite: PGlite;
  let prisma: PrismaClient;
  let service: TtsConfigService;
  let testUserId: string;
  let adminUserId: string;

  const TEST_DISCORD_ID = '12345678901234567890';
  const ADMIN_DISCORD_ID = '98765432109876543210';

  beforeAll(async () => {
    testEnv = await setupTestEnvironment();
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    const adapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter }) as PrismaClient;
    service = new TtsConfigService(prisma);
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    // Clean order matters — FKs require child rows first
    await prisma.userPersonalityConfig.deleteMany({});
    await prisma.personalityDefaultTtsConfig.deleteMany({});
    await prisma.ttsConfig.deleteMany({});
    await prisma.personality.deleteMany({});
    await prisma.user.deleteMany({});

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
      isSuperuser: true,
    });
  });

  // ============================================================================
  // CRUD basics
  // ============================================================================

  describe('create', () => {
    it('creates a global config with GLOBAL scope', async () => {
      const scope: TtsConfigScope = { type: 'GLOBAL' };
      const config = await service.create(
        scope,
        {
          name: 'Global TTS',
          provider: 'self-hosted',
          modelId: null,
          description: 'A global TTS preset',
        },
        adminUserId
      );

      expect(config.name).toBe('Global TTS');
      expect(config.provider).toBe('self-hosted');
      expect(config.isGlobal).toBe(true);
      expect(config.ownerId).toBe(adminUserId);
    });

    it('creates a user config with USER scope', async () => {
      const scope: TtsConfigScope = {
        type: 'USER',
        userId: testUserId,
        discordId: TEST_DISCORD_ID,
      };
      const config = await service.create(
        scope,
        { name: 'My Voice', provider: 'mistral', modelId: 'voxtral-mini-tts-2603' },
        testUserId
      );

      expect(config.name).toBe('My Voice');
      expect(config.isGlobal).toBe(false);
      expect(config.ownerId).toBe(testUserId);
      expect(config.modelId).toBe('voxtral-mini-tts-2603');
    });

    it('persists advancedParameters as JSONB', async () => {
      const scope: TtsConfigScope = {
        type: 'USER',
        userId: testUserId,
        discordId: TEST_DISCORD_ID,
      };
      const config = await service.create(
        scope,
        {
          name: 'Tuned',
          provider: 'elevenlabs',
          modelId: 'eleven_multilingual_v2',
          advancedParameters: { stability: 0.5, similarity: 0.7 },
        },
        testUserId
      );

      const round = await prisma.ttsConfig.findUnique({ where: { id: config.id } });
      expect(round?.advancedParameters).toEqual({ stability: 0.5, similarity: 0.7 });
    });
  });

  // ============================================================================
  // System-globals bootstrap (TTS-specific, NEW vs LLM)
  // ============================================================================

  describe('list — system-globals bootstrap', () => {
    it('seeds 3 globals when GLOBAL list is empty AND a superuser exists', async () => {
      // beforeEach seeded admin as superuser; tts_configs is empty.
      const result = await service.list({ type: 'GLOBAL' });

      expect(result).toHaveLength(3);
      const names = result.map(c => c.name).sort();
      expect(names).toEqual([
        'elevenlabs-multilingual-v2',
        'kyutai-self-hosted',
        'mistral-voxtral-mini',
      ]);
      // kyutai-self-hosted is BOTH the free-tier default AND the system
      // default — fresh-DB UX works out of the box without manual admin step.
      const kyutai = result.find(c => c.name === 'kyutai-self-hosted');
      expect(kyutai?.isFreeDefault).toBe(true);
      expect(kyutai?.isDefault).toBe(true);
      expect(kyutai?.provider).toBe('self-hosted');

      // The other two globals are not defaults
      const elevenlabs = result.find(c => c.name === 'elevenlabs-multilingual-v2');
      const mistral = result.find(c => c.name === 'mistral-voxtral-mini');
      expect(elevenlabs?.isDefault).toBe(false);
      expect(mistral?.isDefault).toBe(false);
    });

    it('skips bootstrap when no superuser exists', async () => {
      // Wipe the admin so no superuser is present
      await prisma.userPersonalityConfig.deleteMany({});
      await prisma.user.deleteMany({ where: { id: adminUserId } });

      const result = await service.list({ type: 'GLOBAL' });

      expect(result).toEqual([]);
      const dbCount = await prisma.ttsConfig.count();
      expect(dbCount).toBe(0);
    });

    it('does not re-seed when bootstrap already ran', async () => {
      await service.list({ type: 'GLOBAL' });
      const countAfterFirst = await prisma.ttsConfig.count();

      // Second call shouldn't insert again
      await service.list({ type: 'GLOBAL' });
      const countAfterSecond = await prisma.ttsConfig.count();

      expect(countAfterSecond).toBe(countAfterFirst);
      expect(countAfterFirst).toBe(3);
    });

    it('USER scope also triggers bootstrap on first call', async () => {
      const result = await service.list({
        type: 'USER',
        userId: testUserId,
        discordId: TEST_DISCORD_ID,
      });

      // 3 globals + 0 user configs
      expect(result).toHaveLength(3);
      const dbCount = await prisma.ttsConfig.count();
      expect(dbCount).toBe(3);
    });
  });

  // ============================================================================
  // List scope semantics
  // ============================================================================

  describe('list', () => {
    beforeEach(async () => {
      // Seed mixed configs (skip bootstrap — pre-create globals manually)
      await prisma.ttsConfig.createMany({
        data: [
          {
            id: newTtsConfigId(),
            name: 'global-1',
            provider: 'self-hosted',
            ownerId: adminUserId,
            isGlobal: true,
          },
          {
            id: newTtsConfigId(),
            name: 'user-private',
            provider: 'mistral',
            modelId: 'voxtral-mini-tts-2603',
            ownerId: testUserId,
            isGlobal: false,
          },
          {
            id: newTtsConfigId(),
            name: 'other-user-private',
            provider: 'elevenlabs',
            ownerId: adminUserId,
            isGlobal: false,
          },
        ],
      });
    });

    it('GLOBAL scope returns globals only (when bootstrap is satisfied)', async () => {
      const result = await service.list({ type: 'GLOBAL' });
      // GLOBAL scope (admin view) returns ALL configs — both global + user
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some(c => c.name === 'global-1')).toBe(true);
    });

    it('USER scope returns globals + only the requesting user own configs', async () => {
      const result = await service.list({
        type: 'USER',
        userId: testUserId,
        discordId: TEST_DISCORD_ID,
      });
      const names = result.map(c => c.name);
      expect(names).toContain('global-1');
      expect(names).toContain('user-private');
      expect(names).not.toContain('other-user-private');
    });
  });

  // ============================================================================
  // Update — service-layer isTtsProviderId enforcement
  // ============================================================================

  describe('update', () => {
    let configId: string;

    beforeEach(async () => {
      const config = await service.create(
        { type: 'USER', userId: testUserId, discordId: TEST_DISCORD_ID },
        { name: 'Updatable', provider: 'self-hosted' },
        testUserId
      );
      configId = config.id;
    });

    it('updates provided fields', async () => {
      const updated = await service.update(configId, {
        provider: 'mistral',
        modelId: 'voxtral-mini-tts-2603',
      });

      expect(updated.provider).toBe('mistral');
      expect(updated.modelId).toBe('voxtral-mini-tts-2603');
    });

    it('rejects garbage provider value before Prisma write', async () => {
      await expect(service.update(configId, { provider: 'mistal' })).rejects.toBeInstanceOf(
        TtsInvalidProviderError
      );

      // DB should be unchanged
      const row = await prisma.ttsConfig.findUnique({ where: { id: configId } });
      expect(row?.provider).toBe('self-hosted');
    });

    it('treats empty-string provider as "preserve existing"', async () => {
      // Empty string is the dashboard's "I didn't change this field" signal.
      await service.update(configId, { provider: '', modelId: 'eleven_multilingual_v2' });

      const row = await prisma.ttsConfig.findUnique({ where: { id: configId } });
      expect(row?.provider).toBe('self-hosted');
      expect(row?.modelId).toBe('eleven_multilingual_v2');
    });

    it('treats empty-string name as "preserve existing"', async () => {
      // Same dashboard convention as the provider field: empty string means
      // "field unchanged." Without this guard, an empty `name` could reach
      // the DB and break `(ownerId, name)` uniqueness invariants.
      await service.update(configId, { name: '', modelId: 'eleven_multilingual_v2' });

      const row = await prisma.ttsConfig.findUnique({ where: { id: configId } });
      expect(row?.name).toBe('Updatable');
      expect(row?.modelId).toBe('eleven_multilingual_v2');
    });

    it('toggles isGlobal flag', async () => {
      const updated = await service.update(configId, { isGlobal: true });
      expect(updated.isGlobal).toBe(true);
    });
  });

  // ============================================================================
  // Delete + constraints
  // ============================================================================

  describe('delete + constraints', () => {
    it('deletes a config with no references', async () => {
      const config = await service.create(
        { type: 'USER', userId: testUserId, discordId: TEST_DISCORD_ID },
        { name: 'Disposable', provider: 'self-hosted' },
        testUserId
      );

      await service.delete(config.id);

      const row = await prisma.ttsConfig.findUnique({ where: { id: config.id } });
      expect(row).toBeNull();
    });

    it('checkDeleteConstraints reports user override references', async () => {
      const config = await service.create(
        { type: 'GLOBAL' },
        { name: 'Referenced', provider: 'self-hosted' },
        adminUserId
      );

      // Create a personality + a user override pointing at this config
      const personalityId = '22222222-2222-4222-8222-222222222222';
      await prisma.personality.create({
        data: {
          id: personalityId,
          name: 'Test Personality',
          slug: 'test-personality',
          ownerId: testUserId,
          characterInfo: '',
          personalityTraits: '',
        },
      });
      await prisma.userPersonalityConfig.create({
        data: {
          id: '33333333-3333-4333-8333-333333333333',
          userId: testUserId,
          personalityId,
          ttsConfigId: config.id,
        },
      });

      const constraint = await service.checkDeleteConstraints(config.id);
      expect(constraint.blocker).toMatch(/user override/i);
      expect(constraint.warning).toBeNull();
    });

    it('checkDeleteConstraints reports personality default references', async () => {
      const config = await service.create(
        { type: 'GLOBAL' },
        { name: 'PersonalityDefault', provider: 'self-hosted' },
        adminUserId
      );

      const personalityId = '44444444-4444-4444-8444-444444444444';
      await prisma.personality.create({
        data: {
          id: personalityId,
          name: 'Default-Holding Personality',
          slug: 'default-holding-personality',
          ownerId: testUserId,
          characterInfo: '',
          personalityTraits: '',
        },
      });
      await prisma.personalityDefaultTtsConfig.create({
        data: { personalityId, ttsConfigId: config.id },
      });

      const constraint = await service.checkDeleteConstraints(config.id);
      expect(constraint.blocker).toMatch(/personality/i);
      expect(constraint.warning).toBeNull();
    });

    it('reports no blocker and no warning when config is deletable', async () => {
      const config = await service.create(
        { type: 'USER', userId: testUserId, discordId: TEST_DISCORD_ID },
        { name: 'Free-to-Delete', provider: 'self-hosted' },
        testUserId
      );

      const constraint = await service.checkDeleteConstraints(config.id);
      expect(constraint).toEqual({ blocker: null, warning: null });
    });

    it('reports a warning when users have this config as their personal default', async () => {
      const config = await service.create(
        { type: 'GLOBAL' },
        { name: 'PersonalDefaultTarget', provider: 'self-hosted' },
        adminUserId
      );

      // Wire two existing test users to point at this config as their personal default.
      await prisma.user.update({
        where: { id: testUserId },
        data: { defaultTtsConfigId: config.id },
      });
      await prisma.user.update({
        where: { id: adminUserId },
        data: { defaultTtsConfigId: config.id },
      });

      const constraint = await service.checkDeleteConstraints(config.id);

      expect(constraint.blocker).toBeNull();
      expect(constraint.warning).toMatch(/2 user/i);
    });
  });

  // ============================================================================
  // Name uniqueness via citext
  // ============================================================================

  describe('checkNameExists', () => {
    it('detects same-owner duplicates case-insensitively (citext)', async () => {
      await service.create(
        { type: 'USER', userId: testUserId, discordId: TEST_DISCORD_ID },
        { name: 'CaseSensitive', provider: 'self-hosted' },
        testUserId
      );

      const result = await service.checkNameExists('casesensitive', {
        type: 'USER',
        userId: testUserId,
        discordId: TEST_DISCORD_ID,
      });
      expect(result.exists).toBe(true);
    });

    it('returns false when no collision exists', async () => {
      const result = await service.checkNameExists('Unique', {
        type: 'USER',
        userId: testUserId,
        discordId: TEST_DISCORD_ID,
      });
      expect(result.exists).toBe(false);
    });

    it('respects excludeId for update operations', async () => {
      const config = await service.create(
        { type: 'USER', userId: testUserId, discordId: TEST_DISCORD_ID },
        { name: 'Self', provider: 'self-hosted' },
        testUserId
      );

      // Same name + excludeId === self → should NOT report a collision
      const result = await service.checkNameExists(
        'Self',
        { type: 'USER', userId: testUserId, discordId: TEST_DISCORD_ID },
        config.id
      );
      expect(result.exists).toBe(false);
    });
  });

  // ============================================================================
  // Admin defaults — AdminSettings pointer repointing
  // ============================================================================

  describe('setAsDefault', () => {
    it('repointing supersedes the previous default (single-pointer semantics)', async () => {
      const a = await service.create(
        { type: 'GLOBAL' },
        { name: 'A', provider: 'self-hosted' },
        adminUserId
      );
      const b = await service.create(
        { type: 'GLOBAL' },
        { name: 'B', provider: 'self-hosted' },
        adminUserId
      );

      await service.setAsDefault(a.id);
      await service.setAsDefault(b.id);

      // The AdminSettings pointer is the single source of truth — repointing
      // to B implicitly "clears" A (no per-row flags to reconcile).
      const aDetail = await service.getById(a.id);
      const bDetail = await service.getById(b.id);
      expect(aDetail?.isDefault).toBe(false);
      expect(bDetail?.isDefault).toBe(true);

      // The stale column is never touched.
      const bRow = await prisma.ttsConfig.findUnique({ where: { id: b.id } });
      expect(bRow?.isDefault).toBe(false);
    });
  });

  describe('setAsFreeDefault', () => {
    it('repointing supersedes the previous free-default (single-pointer semantics)', async () => {
      const a = await service.create(
        { type: 'GLOBAL' },
        { name: 'A', provider: 'self-hosted' },
        adminUserId
      );
      const b = await service.create(
        { type: 'GLOBAL' },
        { name: 'B', provider: 'self-hosted' },
        adminUserId
      );

      await service.setAsFreeDefault(a.id);
      await service.setAsFreeDefault(b.id);

      const aDetail = await service.getById(a.id);
      const bDetail = await service.getById(b.id);
      expect(aDetail?.isFreeDefault).toBe(false);
      expect(bDetail?.isFreeDefault).toBe(true);

      const bRow = await prisma.ttsConfig.findUnique({ where: { id: b.id } });
      expect(bRow?.isFreeDefault).toBe(false);
    });
  });

  // ============================================================================
  // formatConfigDetail
  // ============================================================================

  describe('formatConfigDetail', () => {
    it('passes advancedParameters through as a record', async () => {
      const config = await service.create(
        { type: 'USER', userId: testUserId, discordId: TEST_DISCORD_ID },
        {
          name: 'Tuned',
          provider: 'elevenlabs',
          modelId: 'eleven_multilingual_v2',
          advancedParameters: { stability: 0.5 },
        },
        testUserId
      );

      const row = await prisma.ttsConfig.findUnique({ where: { id: config.id } });
      expect(row).not.toBeNull();
      const formatted = service.formatConfigDetail({
        ...row!,
        advancedParameters: row!.advancedParameters as never,
      });
      expect(formatted.params).toEqual({ stability: 0.5 });
    });

    it('returns empty params when advancedParameters is null', async () => {
      const config = await service.create(
        { type: 'USER', userId: testUserId, discordId: TEST_DISCORD_ID },
        { name: 'Bare', provider: 'self-hosted' },
        testUserId
      );

      const row = await prisma.ttsConfig.findUnique({ where: { id: config.id } });
      const formatted = service.formatConfigDetail({
        ...row!,
        advancedParameters: row!.advancedParameters as never,
      });
      expect(formatted.params).toEqual({});
    });
  });
});
