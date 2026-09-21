import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { runArchivePromotion, type ArchivePromotionDeps } from './archivePromotion.js';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

const mergeConfigOverridesMock = vi.hoisted(() => vi.fn());

vi.mock('../utils/configOverrideMerge.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/configOverrideMerge.js')>();
  mergeConfigOverridesMock.mockImplementation(actual.mergeConfigOverrides);
  return { mergeConfigOverrides: mergeConfigOverridesMock };
});

const PID_A = '550e8400-e29b-41d4-a716-446655440001';
const PID_B = '550e8400-e29b-41d4-a716-446655440002';
const UPDATED_AT = new Date('2026-01-01T00:00:00.000Z');

interface MockCollection {
  findUnique: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function createMockPrisma(): {
  prisma: PrismaClient;
  adminSettings: MockCollection;
  personality: MockCollection;
  queryRawUnsafe: ReturnType<typeof vi.fn>;
} {
  const adminSettings = {
    findUnique: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findMany: vi.fn(),
    update: vi.fn(),
  };
  const personality = {
    findUnique: vi.fn().mockResolvedValue({ configDefaults: null, updatedAt: UPDATED_AT }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findMany: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  };
  const queryRawUnsafe = vi.fn().mockResolvedValue([]);
  const prisma = {
    adminSettings,
    personality,
    $queryRawUnsafe: queryRawUnsafe,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ adminSettings, personality })
    ),
  };
  return { prisma: prisma as unknown as PrismaClient, adminSettings, personality, queryRawUnsafe };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('runArchivePromotion', () => {
  it('kill switch off → enabled:false, evaluated:0, and the coverage query is never run', async () => {
    const { prisma, adminSettings, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique.mockResolvedValueOnce({
      systemSettings: { archivePromotionEnabled: false },
    });

    const result = await runArchivePromotion({ prisma });

    expect(result).toEqual({
      enabled: false,
      evaluated: 0,
      promoted: [],
      skipped: { notReady: 0, optedOut: 0, alreadyListed: 0, conflicted: 0 },
    });
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('a 47/50 personality (0.94) is NOT promoted — strictly inside the gate', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique.mockResolvedValueOnce({
      systemSettings: { archivePromotionEnabled: true },
    });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 50, done_current: 47 },
    ]);

    const result = await runArchivePromotion({ prisma });

    expect(result.promoted).toHaveLength(0);
    expect(result.skipped).toEqual({ notReady: 1, optedOut: 0, alreadyListed: 0, conflicted: 0 });
    expect(personality.findMany).not.toHaveBeenCalled();
  });

  it('a 95/100 personality (exactly 0.95) IS promoted', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique
      .mockResolvedValueOnce({ systemSettings: { archivePromotionEnabled: true } })
      .mockResolvedValueOnce({ systemSettings: {}, updatedAt: UPDATED_AT });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 95 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'my-persona', configDefaults: null },
    ]);

    const result = await runArchivePromotion({ prisma });

    expect(result.promoted).toHaveLength(1);
    expect(result.promoted[0]).toMatchObject({
      personalityId: PID_A,
      slug: 'my-persona',
      coverage: 0.95,
      writes: { archiveSplitRender: true, recentDaysDigest: true, renderMode: true },
    });
    expect(result.skipped).toEqual({ notReady: 0, optedOut: 0, alreadyListed: 0, conflicted: 0 });
  });

  it('retrieved_in_window: 0 → never promoted (null share)', async () => {
    const { prisma, adminSettings, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique.mockResolvedValueOnce({
      systemSettings: { archivePromotionEnabled: true },
    });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 0, done_current: 0 },
    ]);

    const result = await runArchivePromotion({ prisma });

    expect(result.promoted).toHaveLength(0);
    expect(result.skipped.notReady).toBe(1);
  });

  it('an opted-out slug at 100% coverage is skipped without any write', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique.mockResolvedValueOnce({
      systemSettings: {
        archivePromotionEnabled: true,
        archivePromotionOptOutPersonalities: ['my-persona'],
      },
    });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'my-persona', configDefaults: null },
    ]);

    const result = await runArchivePromotion({ prisma });

    expect(result.promoted).toHaveLength(0);
    expect(result.skipped).toEqual({ notReady: 0, optedOut: 1, alreadyListed: 0, conflicted: 0 });
    expect(adminSettings.updateMany).not.toHaveBeenCalled();
  });

  it('a fully converged slug (both lists + render mode) is skipped without any write', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique.mockResolvedValueOnce({
      systemSettings: {
        archivePromotionEnabled: true,
        archiveSplitRenderPersonalities: ['my-persona'],
        recentDaysDigestPersonalities: ['my-persona'],
      },
    });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      {
        id: PID_A,
        slug: 'my-persona',
        configDefaults: { crossChannelRenderMode: 'user-only' },
      },
    ]);

    const result = await runArchivePromotion({ prisma });

    expect(result.promoted).toHaveLength(0);
    expect(result.skipped).toEqual({ notReady: 0, optedOut: 0, alreadyListed: 1, conflicted: 0 });
    expect(adminSettings.updateMany).not.toHaveBeenCalled();
  });

  it('an explicit creator crossChannelRenderMode of both is left untouched and reported as no render-mode write', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique
      .mockResolvedValueOnce({ systemSettings: { archivePromotionEnabled: true } })
      .mockResolvedValueOnce({ systemSettings: {}, updatedAt: UPDATED_AT });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'my-persona', configDefaults: { crossChannelRenderMode: 'both' } },
    ]);
    personality.findUnique.mockResolvedValueOnce({
      configDefaults: { crossChannelRenderMode: 'both' },
      updatedAt: UPDATED_AT,
    });

    const result = await runArchivePromotion({ prisma });

    expect(result.promoted).toHaveLength(1);
    expect(result.promoted[0]?.writes).toEqual({
      archiveSplitRender: true,
      recentDaysDigest: true,
      renderMode: false,
    });
    // personality.updateMany is never called for this candidate — against a mocked
    // client this is what "configDefaults left untouched" means.
    expect(personality.updateMany).not.toHaveBeenCalled();
    expect(adminSettings.updateMany).toHaveBeenCalled();
  });

  it('a split-listed slug missing the digest listing and render mode is promoted for the missing writes only', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique
      .mockResolvedValueOnce({
        systemSettings: {
          archivePromotionEnabled: true,
          archiveSplitRenderPersonalities: ['my-persona'],
        },
      })
      .mockResolvedValueOnce({
        systemSettings: { archiveSplitRenderPersonalities: ['my-persona'] },
        updatedAt: UPDATED_AT,
      });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'my-persona', configDefaults: null },
    ]);

    const result = await runArchivePromotion({ prisma });

    expect(result.skipped.alreadyListed).toBe(0);
    expect(result.promoted).toHaveLength(1);
    expect(result.promoted[0]?.writes).toEqual({
      archiveSplitRender: false,
      recentDaysDigest: true,
      renderMode: true,
    });
  });

  it('a promoted personality writes the slug into BOTH render lists', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique
      .mockResolvedValueOnce({ systemSettings: { archivePromotionEnabled: true } })
      .mockResolvedValueOnce({ systemSettings: {}, updatedAt: UPDATED_AT });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'my-persona', configDefaults: null },
    ]);

    await runArchivePromotion({ prisma });

    expect(adminSettings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          systemSettings: expect.objectContaining({
            archiveSplitRenderPersonalities: ['my-persona'],
            recentDaysDigestPersonalities: ['my-persona'],
          }),
        }),
      })
    );
  });

  it('a slug already on the digest list but not split-render is promoted without duplicating the digest list', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique
      .mockResolvedValueOnce({ systemSettings: { archivePromotionEnabled: true } })
      .mockResolvedValueOnce({
        systemSettings: { recentDaysDigestPersonalities: ['my-persona'] },
        updatedAt: UPDATED_AT,
      });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'my-persona', configDefaults: null },
    ]);

    const result = await runArchivePromotion({ prisma });

    expect(result.promoted[0]?.writes.recentDaysDigest).toBe(false);
    expect(adminSettings.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          systemSettings: expect.objectContaining({
            recentDaysDigestPersonalities: ['my-persona'],
          }),
        }),
      })
    );
  });

  it('personality.updateMany receives configDefaults with crossChannelRenderMode: user-only under the fresh updatedAt guard', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique
      .mockResolvedValueOnce({ systemSettings: { archivePromotionEnabled: true } })
      .mockResolvedValueOnce({ systemSettings: {}, updatedAt: UPDATED_AT });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'my-persona', configDefaults: null },
    ]);

    await runArchivePromotion({ prisma });

    expect(personality.updateMany).toHaveBeenCalledWith({
      where: { id: PID_A, updatedAt: UPDATED_AT },
      data: { configDefaults: expect.objectContaining({ crossChannelRenderMode: 'user-only' }) },
    });
  });

  it('the fresh personality read decides explicitness: a render mode set after the batch snapshot is respected', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique
      .mockResolvedValueOnce({ systemSettings: { archivePromotionEnabled: true } })
      .mockResolvedValueOnce({ systemSettings: {}, updatedAt: UPDATED_AT });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'my-persona', configDefaults: null },
    ]);
    personality.findUnique.mockResolvedValueOnce({
      configDefaults: { crossChannelRenderMode: 'both' },
      updatedAt: UPDATED_AT,
    });

    const result = await runArchivePromotion({ prisma });

    expect(result.promoted).toHaveLength(1);
    expect(result.promoted[0]?.writes).toEqual({
      archiveSplitRender: true,
      recentDaysDigest: true,
      renderMode: false,
    });
    expect(personality.updateMany).not.toHaveBeenCalled();
  });

  it('a personality row that changed under the promotion (updateMany count 0) is counted under skipped.conflicted', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique
      .mockResolvedValueOnce({ systemSettings: { archivePromotionEnabled: true } })
      .mockResolvedValueOnce({ systemSettings: {}, updatedAt: UPDATED_AT });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'my-persona', configDefaults: null },
    ]);
    personality.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await runArchivePromotion({ prisma });

    expect(result.promoted).toHaveLength(0);
    expect(result.skipped.conflicted).toBe(1);
    expect(result.evaluated).toBe(
      result.promoted.length +
        result.skipped.notReady +
        result.skipped.optedOut +
        result.skipped.alreadyListed +
        result.skipped.conflicted
    );
  });

  it('a personality deleted mid-batch (findUnique null) is counted under skipped.conflicted', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique
      .mockResolvedValueOnce({ systemSettings: { archivePromotionEnabled: true } })
      .mockResolvedValueOnce({ systemSettings: {}, updatedAt: UPDATED_AT });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'my-persona', configDefaults: null },
    ]);
    personality.findUnique.mockResolvedValueOnce(null);

    const result = await runArchivePromotion({ prisma });

    expect(result.promoted).toHaveLength(0);
    expect(result.skipped.conflicted).toBe(1);
    expect(personality.updateMany).not.toHaveBeenCalled();
    expect(result.evaluated).toBe(
      result.promoted.length +
        result.skipped.notReady +
        result.skipped.optedOut +
        result.skipped.alreadyListed +
        result.skipped.conflicted
    );
  });

  it('a concurrent settings write (updateMany count 0) is not promoted and does not throw', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique
      .mockResolvedValueOnce({ systemSettings: { archivePromotionEnabled: true } })
      .mockResolvedValueOnce({ systemSettings: {}, updatedAt: UPDATED_AT });
    adminSettings.updateMany.mockResolvedValueOnce({ count: 0 });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'my-persona', configDefaults: null },
    ]);

    const result = await runArchivePromotion({ prisma });

    expect(result.promoted).toHaveLength(0);
    expect(personality.updateMany).not.toHaveBeenCalled();
    expect(result.skipped.conflicted).toBe(1);
    expect(result.evaluated).toBe(
      result.promoted.length +
        result.skipped.notReady +
        result.skipped.optedOut +
        result.skipped.alreadyListed +
        result.skipped.conflicted
    );
  });

  it('dryRun reports candidates without writing anything', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique.mockResolvedValueOnce({
      systemSettings: { archivePromotionEnabled: true },
    });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'my-persona', configDefaults: null },
    ]);

    const result = await runArchivePromotion({ prisma }, { dryRun: true });

    expect(result.promoted).toHaveLength(1);
    expect(adminSettings.updateMany).not.toHaveBeenCalled();
    expect(personality.updateMany).not.toHaveBeenCalled();
  });

  it('cascadeInvalidation undefined logs one warn per batch, not one per promotion', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique
      .mockResolvedValueOnce({ systemSettings: { archivePromotionEnabled: true } })
      .mockResolvedValueOnce({ systemSettings: {}, updatedAt: UPDATED_AT }) // candidate A's tx read
      .mockResolvedValueOnce({ systemSettings: {}, updatedAt: UPDATED_AT }); // candidate B's tx read
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
      { personality_id: PID_B, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'first-persona', configDefaults: null },
      { id: PID_B, slug: 'second-persona', configDefaults: null },
    ]);

    const deps: ArchivePromotionDeps = { prisma };
    const result = await runArchivePromotion(deps);

    expect(result.promoted).toHaveLength(2);
    const cascadeWarns = mockLogger.warn.mock.calls.filter(
      ([, message]) =>
        typeof message === 'string' && message.includes('Cascade invalidation service unavailable')
    );
    expect(cascadeWarns).toHaveLength(1);
    expect(cascadeWarns[0]?.[0]).toEqual({ promoted: 2 });
  });

  it('invalidates caches for candidates already promoted when a LATER candidate throws mid-batch', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique
      .mockResolvedValueOnce({ systemSettings: { archivePromotionEnabled: true } }) // outer read
      .mockResolvedValueOnce({ systemSettings: {}, updatedAt: UPDATED_AT }) // candidate A's tx read
      .mockResolvedValueOnce({ systemSettings: {}, updatedAt: UPDATED_AT }); // candidate B's tx read
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
      { personality_id: PID_B, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'first-persona', configDefaults: null },
      { id: PID_B, slug: 'second-persona', configDefaults: null },
    ]);
    // A's personality write succeeds (updateMany count 1, not a lost race);
    // B's rejects with a plain (non-sentinel) Error.
    personality.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('personality write boom'));

    const systemSettingsInvalidation = { invalidateKeys: vi.fn().mockResolvedValue(undefined) };
    const cascadeInvalidation = { invalidatePersonality: vi.fn().mockResolvedValue(undefined) };
    const deps: ArchivePromotionDeps = {
      prisma,
      systemSettingsInvalidation:
        systemSettingsInvalidation as unknown as ArchivePromotionDeps['systemSettingsInvalidation'],
      cascadeInvalidation:
        cascadeInvalidation as unknown as ArchivePromotionDeps['cascadeInvalidation'],
    };

    await expect(runArchivePromotion(deps)).rejects.toThrow('personality write boom');

    expect(systemSettingsInvalidation.invalidateKeys).toHaveBeenCalledWith([
      'archiveSplitRenderPersonalities',
      'recentDaysDigestPersonalities',
    ]);
    expect(cascadeInvalidation.invalidatePersonality).toHaveBeenCalledWith(PID_A);
  });

  it('a rejected config-defaults merge is counted under skipped.conflicted and writes no personality row', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique
      .mockResolvedValueOnce({ systemSettings: { archivePromotionEnabled: true } })
      .mockResolvedValueOnce({ systemSettings: {}, updatedAt: UPDATED_AT });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'my-persona', configDefaults: null },
    ]);
    mergeConfigOverridesMock.mockReturnValueOnce('invalid');

    const result = await runArchivePromotion({ prisma });

    expect(result.promoted).toHaveLength(0);
    expect(result.skipped.conflicted).toBe(1);
    expect(personality.updateMany).not.toHaveBeenCalled();
    expect(mergeConfigOverridesMock).toHaveBeenCalledWith(null, {
      crossChannelRenderMode: 'user-only',
    });
    // The settings write happens BEFORE the merge inside the transaction, and the
    // mocked $transaction performs no rollback — this asserts ordering, not
    // persistence (a real Prisma transaction would roll the settings write back
    // too when the merge throws — pinned by MEM-ARCH-035 in the component test).
    expect(adminSettings.updateMany).toHaveBeenCalled();
    expect(result.evaluated).toBe(
      result.promoted.length +
        result.skipped.notReady +
        result.skipped.optedOut +
        result.skipped.alreadyListed +
        result.skipped.conflicted
    );
  });

  it('MEM-ARCH-037: a malformed render list inside the transaction refuses every write and is counted conflicted', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique
      .mockResolvedValueOnce({ systemSettings: { archivePromotionEnabled: true } })
      .mockResolvedValueOnce({
        systemSettings: { archiveSplitRenderPersonalities: ['ok', 42] },
        updatedAt: UPDATED_AT,
      });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'my-persona', configDefaults: null },
    ]);

    const result = await runArchivePromotion({ prisma });

    expect(result.promoted).toHaveLength(0);
    expect(result.skipped.conflicted).toBe(1);
    expect(adminSettings.updateMany).not.toHaveBeenCalled();
    expect(personality.updateMany).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { personalityId: PID_A, key: 'archiveSplitRenderPersonalities' },
      'Archive promotion skipped: settings list is malformed'
    );
    expect(result.evaluated).toBe(
      result.promoted.length +
        result.skipped.notReady +
        result.skipped.optedOut +
        result.skipped.alreadyListed +
        result.skipped.conflicted
    );
  });

  it('a malformed list in the BATCH snapshot warns once and the run proceeds', async () => {
    const { prisma, adminSettings, personality, queryRawUnsafe } = createMockPrisma();
    adminSettings.findUnique
      .mockResolvedValueOnce({
        systemSettings: {
          archivePromotionEnabled: true,
          archivePromotionOptOutPersonalities: ['ok', 42],
        },
      })
      .mockResolvedValueOnce({ systemSettings: {}, updatedAt: UPDATED_AT });
    queryRawUnsafe.mockResolvedValueOnce([
      { personality_id: PID_A, retrieved_in_window: 100, done_current: 100 },
    ]);
    personality.findMany.mockResolvedValueOnce([
      { id: PID_A, slug: 'my-persona', configDefaults: null },
    ]);

    const result = await runArchivePromotion({ prisma });

    expect(result.promoted).toHaveLength(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { key: 'archivePromotionOptOutPersonalities' },
      'Archive promotion: settings list is malformed; classification uses the fallback and no promotion will write'
    );
    expect(
      mockLogger.warn.mock.calls.filter(
        call => (call[0] as { key?: string }).key === 'archivePromotionOptOutPersonalities'
      )
    ).toHaveLength(1);
  });
});
