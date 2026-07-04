/**
 * TtsConfigService Tests
 *
 * Unit tests for the TTS config service layer. Mirrors LlmConfigService.test.ts
 * shape with TTS-specific additions:
 *   - System-globals bootstrap on empty list result (with + without superuser)
 *   - Service-layer isTtsProviderId enforcement on update path
 *
 * Mocks Prisma client and TtsConfigCacheInvalidationService — no DB required.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TtsConfigService,
  TtsAutoSuffixCollisionError,
  TtsCloneNameExhaustedError,
  TtsInvalidProviderError,
  type TtsConfigScope,
} from './TtsConfigService.js';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import type { TtsConfigCacheInvalidationService } from '@tzurot/cache-invalidation';
import { NotFoundError } from '../utils/appErrors.js';

// Mock logger to keep test output clean
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

function createMockPrisma() {
  const ttsConfig = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  };

  const personalityDefaultTtsConfig = {
    count: vi.fn(),
  };

  const userPersonalityConfig = {
    count: vi.fn(),
  };

  const user = {
    findFirst: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
  };

  // Default-pointer reads resolve to "no defaults set"; tests that exercise
  // default-ness override findUnique with a pointer row.
  const adminSettings = {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({}),
  };

  return {
    ttsConfig,
    personalityDefaultTtsConfig,
    userPersonalityConfig,
    user,
    adminSettings,
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      return callback({ ttsConfig });
    }),
  } as unknown as PrismaClient;
}

function createMockCacheInvalidation(): TtsConfigCacheInvalidationService {
  return {
    invalidateAll: vi.fn().mockResolvedValue(undefined),
    invalidateUserTtsConfig: vi.fn().mockResolvedValue(undefined),
    invalidateConfigUsers: vi.fn().mockResolvedValue(undefined),
  } as unknown as TtsConfigCacheInvalidationService;
}

const userScope: TtsConfigScope = {
  type: 'USER',
  userId: 'user-uuid-1',
  discordId: '111111111111111111',
};
const globalScope: TtsConfigScope = { type: 'GLOBAL' };

const sampleConfig = {
  id: 'cfg-uuid-1',
  name: 'My Voice',
  description: null,
  provider: 'elevenlabs',
  modelId: 'eleven_multilingual_v2',
  isGlobal: false,
  isDefault: false,
  isFreeDefault: false,
  ownerId: 'user-uuid-1',
  advancedParameters: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('TtsConfigService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let cache: TtsConfigCacheInvalidationService;
  let service: TtsConfigService;

  beforeEach(() => {
    prisma = createMockPrisma();
    cache = createMockCacheInvalidation();
    service = new TtsConfigService(prisma, cache);
  });

  // ==========================================================================
  // Read operations
  // ==========================================================================

  describe('getById', () => {
    it('returns the config when found', async () => {
      vi.mocked(prisma.ttsConfig.findUnique).mockResolvedValue(sampleConfig);
      const result = await service.getById('cfg-uuid-1');
      expect(result).toEqual(sampleConfig);
      expect(prisma.ttsConfig.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cfg-uuid-1' } })
      );
    });

    it('returns null when not found', async () => {
      vi.mocked(prisma.ttsConfig.findUnique).mockResolvedValue(null);
      const result = await service.getById('missing');
      expect(result).toBeNull();
    });
  });

  describe('list (GLOBAL scope)', () => {
    it('returns globally-visible configs sorted', async () => {
      const configs = [{ ...sampleConfig, isGlobal: true }];
      vi.mocked(prisma.ttsConfig.findMany).mockResolvedValueOnce(configs);
      const result = await service.list(globalScope);
      expect(result).toEqual(configs);
    });

    it('does NOT bootstrap when results are non-empty', async () => {
      const configs = [{ ...sampleConfig, isGlobal: true }];
      vi.mocked(prisma.ttsConfig.findMany).mockResolvedValueOnce(configs);
      await service.list(globalScope);
      expect(prisma.ttsConfig.createMany).not.toHaveBeenCalled();
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('list (USER scope)', () => {
    it('returns globals + user-owned configs', async () => {
      const globals = [{ ...sampleConfig, id: 'g1', isGlobal: true }];
      const userConfigs = [{ ...sampleConfig, id: 'u1' }];
      vi.mocked(prisma.ttsConfig.findMany)
        .mockResolvedValueOnce(globals)
        .mockResolvedValueOnce(userConfigs);

      const result = await service.list(userScope);
      expect(result).toEqual([...globals, ...userConfigs]);
    });
  });

  // ==========================================================================
  // Bootstrap (NEW vs LLM)
  // ==========================================================================

  describe('list — system-globals bootstrap', () => {
    it('seeds 3 globals when GLOBAL list is empty AND a superuser exists', async () => {
      // First findMany: empty (triggers bootstrap)
      // Second findMany: 3 seeded configs
      const kyutaiId = '50411d3c-cc98-5f39-839e-abd4fb84b0c8';
      const seeded = [
        {
          ...sampleConfig,
          id: kyutaiId,
          name: 'kyutai-self-hosted',
          isGlobal: true,
          provider: 'self-hosted',
          modelId: null,
        },
        { ...sampleConfig, id: 's2', name: 'elevenlabs-multilingual-v2', isGlobal: true },
        {
          ...sampleConfig,
          id: 's3',
          name: 'mistral-voxtral-mini',
          isGlobal: true,
          provider: 'mistral',
          modelId: 'voxtral-mini-tts-2603',
        },
      ];
      vi.mocked(prisma.ttsConfig.findMany)
        .mockResolvedValueOnce([]) // first global query — empty
        .mockResolvedValueOnce(seeded); // re-query after bootstrap
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'super-uuid-1' } as never);
      vi.mocked(prisma.ttsConfig.createMany).mockResolvedValue({ count: 3 });
      // Pointer round trip: null on the bootstrap's unset-check (so it seeds
      // the pointers), then the seeded pointer row for list decoration.
      vi.mocked(prisma.adminSettings.findUnique)
        .mockResolvedValueOnce(null)
        .mockResolvedValue({
          globalDefaultTtsConfigId: kyutaiId,
          freeDefaultTtsConfigId: kyutaiId,
        } as never);

      const result = await service.list(globalScope);

      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isSuperuser: true } })
      );
      expect(prisma.ttsConfig.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true })
      );
      // Verify 3 seed entries with the expected names
      const createCall = vi.mocked(prisma.ttsConfig.createMany).mock.calls[0]?.[0];
      expect(createCall).toBeDefined();
      const seedRows = (
        createCall as {
          data: Array<{ id: string; name: string }>;
        }
      ).data;
      expect(seedRows.map(d => d.name)).toEqual([
        'kyutai-self-hosted',
        'elevenlabs-multilingual-v2',
        'mistral-voxtral-mini',
      ]);
      // Seeds no longer write the stale flag columns; default-ness lands on
      // the AdminSettings pointers instead — both pointed at kyutai so a
      // fresh dev DB has working TTS without a manual admin step.
      for (const row of seedRows) {
        expect(row).not.toHaveProperty('isDefault');
        expect(row).not.toHaveProperty('isFreeDefault');
      }
      const kyutaiSeed = seedRows.find(d => d.name === 'kyutai-self-hosted');
      expect(prisma.adminSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: {
            globalDefaultTtsConfigId: kyutaiSeed?.id,
            freeDefaultTtsConfigId: kyutaiSeed?.id,
          },
        })
      );

      // Bootstrap rows use deterministic UUIDs (uuidv5 from name) so dev and
      // prod always assign the same id for the same logical row. Pinned to
      // the documented stable values from deterministicUuid.test.ts.
      expect(kyutaiSeed?.id).toBe('50411d3c-cc98-5f39-839e-abd4fb84b0c8');
      expect(seedRows.find(d => d.name === 'elevenlabs-multilingual-v2')?.id).toBe(
        '845d224f-ad28-5ce1-8b27-f5588d3ae2d1'
      );
      expect(seedRows.find(d => d.name === 'mistral-voxtral-mini')?.id).toBe(
        '8aa02cad-2c39-5b5b-9d37-482aacb7788d'
      );

      // Decoration derives flags from the seeded pointers: kyutai is both
      // defaults and sorts first; the rest follow name-asc with false flags.
      expect(result.map(c => c.name)).toEqual([
        'kyutai-self-hosted',
        'elevenlabs-multilingual-v2',
        'mistral-voxtral-mini',
      ]);
      expect(result[0]).toMatchObject({ isDefault: true, isFreeDefault: true });
      expect(result[1]).toMatchObject({ isDefault: false, isFreeDefault: false });
    });

    it('skips bootstrap and returns empty when no superuser exists', async () => {
      vi.mocked(prisma.ttsConfig.findMany)
        .mockResolvedValueOnce([]) // first query — empty
        .mockResolvedValueOnce([]); // re-query after no-op bootstrap
      vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

      const result = await service.list(globalScope);

      expect(prisma.user.findFirst).toHaveBeenCalled();
      expect(prisma.ttsConfig.createMany).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('bootstrap is race-safe via skipDuplicates: true', async () => {
      // Concurrent first-callers should converge cleanly. We can't easily
      // simulate the race here, but we can assert the skipDuplicates flag
      // is set so Postgres handles ON CONFLICT DO NOTHING.
      vi.mocked(prisma.ttsConfig.findMany).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'super-uuid-1' } as never);
      vi.mocked(prisma.ttsConfig.createMany).mockResolvedValue({ count: 0 }); // races: another caller already inserted

      await service.list(globalScope);

      expect(prisma.ttsConfig.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true })
      );
    });

    it('also bootstraps from USER scope first-call', async () => {
      // User scope hits the same gap — bootstrap should fire here too so a
      // brand-new dev DB sees system globals immediately.
      vi.mocked(prisma.ttsConfig.findMany)
        .mockResolvedValueOnce([]) // global query — empty
        .mockResolvedValueOnce([]) // user query — empty
        .mockResolvedValueOnce([{ ...sampleConfig, isGlobal: true }]); // re-query globals after bootstrap
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'super-uuid-1' } as never);
      vi.mocked(prisma.ttsConfig.createMany).mockResolvedValue({ count: 3 });

      await service.list(userScope);

      expect(prisma.ttsConfig.createMany).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Create
  // ==========================================================================

  describe('create', () => {
    it('creates a USER-scoped config with defaults applied', async () => {
      vi.mocked(prisma.ttsConfig.create).mockResolvedValue(sampleConfig);

      const result = await service.create(
        userScope,
        { name: 'My Voice', provider: 'elevenlabs', modelId: 'eleven_multilingual_v2' },
        'user-uuid-1'
      );

      expect(prisma.ttsConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'My Voice',
            provider: 'elevenlabs',
            modelId: 'eleven_multilingual_v2',
            ownerId: 'user-uuid-1',
            isGlobal: false,
          }),
        })
      );
      // The stale flag columns are not written (schema defaults fill them);
      // the returned shape carries pointer-DERIVED flags (no pointers set here).
      const createData = vi.mocked(prisma.ttsConfig.create).mock.calls[0]?.[0]?.data;
      expect(createData).not.toHaveProperty('isDefault');
      expect(createData).not.toHaveProperty('isFreeDefault');
      expect(result).toEqual({ ...sampleConfig, isDefault: false, isFreeDefault: false });
      expect(cache.invalidateAll).toHaveBeenCalled();
    });

    it('creates a GLOBAL-scoped config with isGlobal: true', async () => {
      vi.mocked(prisma.ttsConfig.create).mockResolvedValue({ ...sampleConfig, isGlobal: true });

      await service.create(
        globalScope,
        { name: 'System Default', provider: 'self-hosted' },
        'admin-uuid-1'
      );

      expect(prisma.ttsConfig.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isGlobal: true }),
        })
      );
    });

    it('throws TtsAutoSuffixCollisionError when concurrent insert races past the SELECT', async () => {
      vi.mocked(prisma.ttsConfig.findMany).mockResolvedValue([]);
      const prismaError = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['owner_id', 'name'] },
      });
      vi.mocked(prisma.ttsConfig.create).mockRejectedValue(prismaError);

      await expect(
        service.create(
          userScope,
          { name: 'Voice', provider: 'elevenlabs', autoSuffixOnCollision: true },
          'user-uuid-1'
        )
      ).rejects.toBeInstanceOf(TtsAutoSuffixCollisionError);
    });

    it('throws TtsCloneNameExhaustedError when 20+ name variants are taken', async () => {
      // generateClonedName walks: 'Voice' → 'Voice (Copy)' → 'Voice (Copy 2)'
      // → ... → 'Voice (Copy N)'. Need exactly the names the walker would
      // try to generate, so the loop hits MAX_CLONE_NAME_ATTEMPTS and throws.
      const taken = [
        'Voice',
        'Voice (Copy)',
        ...Array.from({ length: 20 }, (_, i) => `Voice (Copy ${i + 2})`),
      ];
      vi.mocked(prisma.ttsConfig.findMany).mockResolvedValue(
        taken.map(name => ({ name })) as never
      );

      await expect(
        service.create(
          userScope,
          { name: 'Voice', provider: 'elevenlabs', autoSuffixOnCollision: true },
          'user-uuid-1'
        )
      ).rejects.toBeInstanceOf(TtsCloneNameExhaustedError);
    });
  });

  // ==========================================================================
  // Update — including the NEW isTtsProviderId enforcement
  // ==========================================================================

  describe('update', () => {
    it('updates only provided fields', async () => {
      vi.mocked(prisma.ttsConfig.update).mockResolvedValue({
        ...sampleConfig,
        modelId: 'voxtral-mini-tts-2603',
        provider: 'mistral',
      });

      await service.update('cfg-uuid-1', {
        modelId: 'voxtral-mini-tts-2603',
        provider: 'mistral',
      });

      expect(prisma.ttsConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { modelId: 'voxtral-mini-tts-2603', provider: 'mistral' },
        })
      );
    });

    it('rejects an invalid provider value (typo) before the Prisma write', async () => {
      // Schema accepts any string up to 40 chars; the service rejects.
      await expect(service.update('cfg-uuid-1', { provider: 'mistal' })).rejects.toBeInstanceOf(
        TtsInvalidProviderError
      );
      expect(prisma.ttsConfig.update).not.toHaveBeenCalled();
    });

    it('treats empty-string provider as "preserve existing" — not an invalid-provider error', async () => {
      vi.mocked(prisma.ttsConfig.update).mockResolvedValue(sampleConfig);
      // Empty string is the dashboard's "I didn't change this field" signal.
      await service.update('cfg-uuid-1', { provider: '', modelId: 'eleven_multilingual_v2' });

      // Prisma.update is called WITHOUT provider in updateData
      const call = vi.mocked(prisma.ttsConfig.update).mock.calls[0][0];
      expect(call.data).toEqual({ modelId: 'eleven_multilingual_v2' });
      expect((call.data as Record<string, unknown>).provider).toBeUndefined();
    });

    it('treats empty-string name as "preserve existing" — symmetric with provider guard', async () => {
      vi.mocked(prisma.ttsConfig.update).mockResolvedValue(sampleConfig);
      // Same dashboard convention as provider; without this guard the empty
      // string would reach the DB and break (ownerId, name) uniqueness.
      await service.update('cfg-uuid-1', { name: '', modelId: 'eleven_multilingual_v2' });

      const call = vi.mocked(prisma.ttsConfig.update).mock.calls[0][0];
      expect(call.data).toEqual({ modelId: 'eleven_multilingual_v2' });
      expect((call.data as Record<string, unknown>).name).toBeUndefined();
    });

    it('accepts a valid TtsProviderId on update', async () => {
      vi.mocked(prisma.ttsConfig.update).mockResolvedValue(sampleConfig);
      await service.update('cfg-uuid-1', { provider: 'self-hosted' });
      expect(prisma.ttsConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ provider: 'self-hosted' }),
        })
      );
    });

    it('handles isGlobal toggle', async () => {
      vi.mocked(prisma.ttsConfig.update).mockResolvedValue({ ...sampleConfig, isGlobal: true });
      await service.update('cfg-uuid-1', { isGlobal: true });
      expect(prisma.ttsConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isGlobal: true },
        })
      );
    });
  });

  // ==========================================================================
  // Delete
  // ==========================================================================

  describe('delete', () => {
    it('deletes the config and invalidates cache', async () => {
      vi.mocked(prisma.ttsConfig.delete).mockResolvedValue(sampleConfig);
      await service.delete('cfg-uuid-1');
      expect(prisma.ttsConfig.delete).toHaveBeenCalledWith({ where: { id: 'cfg-uuid-1' } });
      expect(cache.invalidateAll).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Admin-only
  // ==========================================================================

  describe('setAsDefault', () => {
    it('repoints the AdminSettings global-default pointer (no flag flips)', async () => {
      vi.mocked(prisma.ttsConfig.findUnique).mockResolvedValue(sampleConfig);

      await service.setAsDefault('cfg-uuid-1');

      expect(prisma.adminSettings.upsert).toHaveBeenCalledWith({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        create: { id: ADMIN_SETTINGS_SINGLETON_ID, globalDefaultTtsConfigId: 'cfg-uuid-1' },
        update: { globalDefaultTtsConfigId: 'cfg-uuid-1' },
      });
      // The stale flag columns are never touched.
      expect(prisma.ttsConfig.updateMany).not.toHaveBeenCalled();
      expect(prisma.ttsConfig.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the config no longer exists (delete-between-reads race)', async () => {
      vi.mocked(prisma.ttsConfig.findUnique).mockResolvedValue(null);

      const error = await service.setAsDefault('gone').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).resource).toBe('TTS config');
      // A vanished config must never reach the pointer write.
      expect(prisma.adminSettings.upsert).not.toHaveBeenCalled();
    });
  });

  describe('setAsFreeDefault', () => {
    it('repoints the AdminSettings free-default pointer (no flag flips)', async () => {
      vi.mocked(prisma.ttsConfig.findUnique).mockResolvedValue(sampleConfig);

      await service.setAsFreeDefault('cfg-uuid-1');

      expect(prisma.adminSettings.upsert).toHaveBeenCalledWith({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        create: { id: ADMIN_SETTINGS_SINGLETON_ID, freeDefaultTtsConfigId: 'cfg-uuid-1' },
        update: { freeDefaultTtsConfigId: 'cfg-uuid-1' },
      });
      expect(prisma.ttsConfig.updateMany).not.toHaveBeenCalled();
      expect(prisma.ttsConfig.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the config no longer exists (delete-between-reads race)', async () => {
      vi.mocked(prisma.ttsConfig.findUnique).mockResolvedValue(null);

      const error = await service.setAsFreeDefault('gone').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotFoundError);
      expect((error as NotFoundError).resource).toBe('TTS config');
      expect(prisma.adminSettings.upsert).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Validation helpers
  // ==========================================================================

  describe('checkNameExists', () => {
    it('returns exists: true with conflictId on collision', async () => {
      vi.mocked(prisma.ttsConfig.findFirst).mockResolvedValue({ id: 'cfg-existing' } as never);
      const result = await service.checkNameExists('My Voice', userScope);
      expect(result).toEqual({ exists: true, conflictId: 'cfg-existing' });
    });

    it('returns exists: false when no collision', async () => {
      vi.mocked(prisma.ttsConfig.findFirst).mockResolvedValue(null);
      const result = await service.checkNameExists('Unique Name', userScope);
      expect(result.exists).toBe(false);
    });

    it('respects excludeId for update operations', async () => {
      vi.mocked(prisma.ttsConfig.findFirst).mockResolvedValue(null);
      await service.checkNameExists('My Voice', userScope, 'cfg-self');
      expect(prisma.ttsConfig.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'cfg-self' } }),
        })
      );
    });

    it('USER scope with postIsGlobal=true also checks the global namespace', async () => {
      // Cross-user collision case: user Bob promotes their config; the suffixed
      // name (e.g. "MyVoice-bob") matches an existing global. Without this
      // branch, P2002 would surface inside update() as a 500.
      vi.mocked(prisma.ttsConfig.findFirst)
        .mockResolvedValueOnce(null) // own-namespace miss
        .mockResolvedValueOnce({ id: 'someone-elses-global' } as never);

      const result = await service.checkNameExists('MyVoice-bob', userScope, undefined, true);

      expect(result).toEqual({ exists: true, conflictId: 'someone-elses-global' });
      expect(prisma.ttsConfig.findFirst).toHaveBeenCalledTimes(2);
      expect(prisma.ttsConfig.findFirst).toHaveBeenNthCalledWith(2, {
        where: { name: 'MyVoice-bob', isGlobal: true },
        select: { id: true },
      });
    });

    it('USER scope with postIsGlobal=true returns own conflict when both fire', async () => {
      vi.mocked(prisma.ttsConfig.findFirst)
        .mockResolvedValueOnce({ id: 'own-config' } as never)
        .mockResolvedValueOnce({ id: 'someone-elses-global' } as never);

      const result = await service.checkNameExists('Conflict', userScope, undefined, true);
      expect(result).toEqual({ exists: true, conflictId: 'own-config' });
    });

    it('USER scope with postIsGlobal=false skips the global namespace check', async () => {
      vi.mocked(prisma.ttsConfig.findFirst).mockResolvedValue(null);
      await service.checkNameExists('My Voice', userScope);

      expect(prisma.ttsConfig.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkDeleteConstraints', () => {
    it('returns { blocker: null, warning: null } when deletable with no users adopting it', async () => {
      vi.mocked(prisma.personalityDefaultTtsConfig.count).mockResolvedValue(0);
      vi.mocked(prisma.userPersonalityConfig.count).mockResolvedValue(0);
      vi.mocked(prisma.user.count).mockResolvedValue(0);

      const result = await service.checkDeleteConstraints('cfg-uuid-1');
      expect(result).toEqual({ blocker: null, warning: null });
    });

    it('returns blocker when used by personalities', async () => {
      vi.mocked(prisma.personalityDefaultTtsConfig.count).mockResolvedValue(2);
      vi.mocked(prisma.userPersonalityConfig.count).mockResolvedValue(0);
      vi.mocked(prisma.user.count).mockResolvedValue(0);

      const result = await service.checkDeleteConstraints('cfg-uuid-1');
      expect(result.blocker).toContain('2 personality');
      expect(result.warning).toBeNull();
    });

    it('returns blocker when used by user overrides', async () => {
      vi.mocked(prisma.personalityDefaultTtsConfig.count).mockResolvedValue(0);
      vi.mocked(prisma.userPersonalityConfig.count).mockResolvedValue(5);
      vi.mocked(prisma.user.count).mockResolvedValue(0);

      const result = await service.checkDeleteConstraints('cfg-uuid-1');
      expect(result.blocker).toContain('5 user override');
      expect(result.warning).toBeNull();
    });

    it('returns non-blocking warning when N users have it as their personal default', async () => {
      // No personality/override blockers, but 4 users adopted this config
      // as their personal default (`users.default_tts_config_id`). Schema's
      // ON DELETE SET NULL handles deletion gracefully — warning lets the
      // admin confirm before silently nulling those preferences.
      vi.mocked(prisma.personalityDefaultTtsConfig.count).mockResolvedValue(0);
      vi.mocked(prisma.userPersonalityConfig.count).mockResolvedValue(0);
      vi.mocked(prisma.user.count).mockResolvedValue(4);

      const result = await service.checkDeleteConstraints('cfg-uuid-1');
      expect(result.blocker).toBeNull();
      expect(result.warning).toContain('4 user');
    });

    it('returns both blocker and warning when both conditions exist', async () => {
      // Service returns full information when both apply; the route handler
      // is what enforces precedence (drops warning on the 400 error path).
      vi.mocked(prisma.personalityDefaultTtsConfig.count).mockResolvedValue(1);
      vi.mocked(prisma.userPersonalityConfig.count).mockResolvedValue(0);
      vi.mocked(prisma.user.count).mockResolvedValue(4);

      const result = await service.checkDeleteConstraints('cfg-uuid-1');
      expect(result.blocker).toContain('1 personality');
      expect(result.warning).toContain('4 user');
    });
  });

  // ==========================================================================
  // Response formatting
  // ==========================================================================

  describe('formatConfigDetail', () => {
    it('formats a config with empty params when advancedParameters is null', () => {
      const formatted = service.formatConfigDetail({ ...sampleConfig, advancedParameters: null });
      expect(formatted.params).toEqual({});
    });

    it('passes advancedParameters through as a record', () => {
      const formatted = service.formatConfigDetail({
        ...sampleConfig,
        advancedParameters: { stability: 0.5, similarity: 0.7 },
      });
      expect(formatted.params).toEqual({ stability: 0.5, similarity: 0.7 });
    });

    it('coerces non-object values to {} (defensive)', () => {
      const formatted = service.formatConfigDetail({
        ...sampleConfig,
        advancedParameters: 'invalid string' as unknown,
      });
      expect(formatted.params).toEqual({});
    });
  });

  // ==========================================================================
  // Cache invalidation safety
  // ==========================================================================

  describe('cache invalidation', () => {
    it('does not throw when invalidation fails', async () => {
      vi.mocked(cache.invalidateAll).mockRejectedValueOnce(new Error('Redis down'));
      vi.mocked(prisma.ttsConfig.delete).mockResolvedValue(sampleConfig);

      // Delete should still succeed even if cache invalidation fails
      await expect(service.delete('cfg-uuid-1')).resolves.toBeUndefined();
    });

    it('is a no-op when no cache invalidation service is wired', async () => {
      const serviceWithoutCache = new TtsConfigService(prisma);
      vi.mocked(prisma.ttsConfig.delete).mockResolvedValue(sampleConfig);
      await expect(serviceWithoutCache.delete('cfg-uuid-1')).resolves.toBeUndefined();
    });
  });
});
