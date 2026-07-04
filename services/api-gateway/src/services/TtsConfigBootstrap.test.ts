/**
 * Unit tests for the extracted TtsConfig bootstrap helper. The end-to-end
 * bootstrap flow (triggered by `list(GLOBAL)` returning empty) is covered by
 * `TtsConfigService.test.ts`; these tests focus on the helper's contract:
 * superuser gating, deterministic UUID seeding, createMany shape, and the
 * only-when-null AdminSettings default-pointer seeding.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { bootstrapTtsSystemGlobalsIfNeeded } from './TtsConfigBootstrap.js';

const KYUTAI_ID = '50411d3c-cc98-5f39-839e-abd4fb84b0c8';

interface MockPrisma {
  user: { findFirst: ReturnType<typeof vi.fn> };
  ttsConfig: { createMany: ReturnType<typeof vi.fn> };
  adminSettings: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
}

function makePrisma(): MockPrisma {
  return {
    user: { findFirst: vi.fn() },
    ttsConfig: { createMany: vi.fn() },
    adminSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
}

describe('bootstrapTtsSystemGlobalsIfNeeded', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
  });

  it('no-ops when no superuser exists', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await bootstrapTtsSystemGlobalsIfNeeded(prisma as unknown as PrismaClient);

    expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.ttsConfig.createMany).not.toHaveBeenCalled();
    expect(prisma.adminSettings.upsert).not.toHaveBeenCalled();
  });

  it('seeds 3 system globals owned by the oldest superuser (no stale flag writes)', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'superuser-id' });
    prisma.ttsConfig.createMany.mockResolvedValue({ count: 3 });

    await bootstrapTtsSystemGlobalsIfNeeded(prisma as unknown as PrismaClient);

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { isSuperuser: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    expect(prisma.ttsConfig.createMany).toHaveBeenCalledTimes(1);
    const [{ data, skipDuplicates }] = prisma.ttsConfig.createMany.mock.calls[0] as [
      { data: Array<Record<string, unknown>>; skipDuplicates: boolean },
    ];

    expect(skipDuplicates).toBe(true);
    expect(data.map(d => d.name)).toEqual([
      'kyutai-self-hosted',
      'elevenlabs-multilingual-v2',
      'mistral-voxtral-mini',
    ]);

    // Default-ness lands on the AdminSettings pointers, not the stale columns.
    for (const row of data) {
      expect(row).not.toHaveProperty('isDefault');
      expect(row).not.toHaveProperty('isFreeDefault');
    }

    // All seeds owned by the resolved superuser, marked global.
    expect(data.every(d => d.ownerId === 'superuser-id')).toBe(true);
    expect(data.every(d => d.isGlobal === true)).toBe(true);
  });

  it('uses deterministic UUIDs (uuidv5) for seed IDs', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'superuser-id' });
    prisma.ttsConfig.createMany.mockResolvedValue({ count: 3 });

    await bootstrapTtsSystemGlobalsIfNeeded(prisma as unknown as PrismaClient);

    const [{ data }] = prisma.ttsConfig.createMany.mock.calls[0] as [
      { data: Array<Record<string, unknown>> },
    ];

    // Hard-coded expected UUIDs match `generateSystemGlobalTtsConfigUuid(name)`.
    // If these drift, the deterministic-ID contract has been broken.
    expect(data.find(d => d.name === 'kyutai-self-hosted')?.id).toBe(KYUTAI_ID);
  });

  it('treats createMany resolving with count: 0 as a no-op for seeding (race winner already seeded)', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'superuser-id' });
    prisma.ttsConfig.createMany.mockResolvedValue({ count: 0 });

    await expect(
      bootstrapTtsSystemGlobalsIfNeeded(prisma as unknown as PrismaClient)
    ).resolves.toBeUndefined();

    expect(prisma.ttsConfig.createMany).toHaveBeenCalledTimes(1);
  });

  describe('AdminSettings default-pointer seeding', () => {
    beforeEach(() => {
      prisma.user.findFirst.mockResolvedValue({ id: 'superuser-id' });
      prisma.ttsConfig.createMany.mockResolvedValue({ count: 3 });
    });

    it('points BOTH defaults at kyutai when neither pointer is set', async () => {
      prisma.adminSettings.findUnique.mockResolvedValue(null);

      await bootstrapTtsSystemGlobalsIfNeeded(prisma as unknown as PrismaClient);

      expect(prisma.adminSettings.upsert).toHaveBeenCalledWith({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        create: {
          id: ADMIN_SETTINGS_SINGLETON_ID,
          globalDefaultTtsConfigId: KYUTAI_ID,
          freeDefaultTtsConfigId: KYUTAI_ID,
        },
        update: {
          globalDefaultTtsConfigId: KYUTAI_ID,
          freeDefaultTtsConfigId: KYUTAI_ID,
        },
      });
    });

    it('never clobbers an admin-set pointer — seeds only the NULL one', async () => {
      prisma.adminSettings.findUnique.mockResolvedValue({
        globalDefaultTtsConfigId: 'admin-chosen-id',
        freeDefaultTtsConfigId: null,
      });

      await bootstrapTtsSystemGlobalsIfNeeded(prisma as unknown as PrismaClient);

      expect(prisma.adminSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { freeDefaultTtsConfigId: KYUTAI_ID },
        })
      );
    });

    it('skips the upsert entirely when both pointers are already set', async () => {
      prisma.adminSettings.findUnique.mockResolvedValue({
        globalDefaultTtsConfigId: 'a',
        freeDefaultTtsConfigId: 'b',
      });

      await bootstrapTtsSystemGlobalsIfNeeded(prisma as unknown as PrismaClient);

      expect(prisma.adminSettings.upsert).not.toHaveBeenCalled();
    });

    it('still converges the pointers when the configs already existed (count: 0)', async () => {
      // Half-bootstrapped state: rows exist but pointers were never seeded.
      prisma.ttsConfig.createMany.mockResolvedValue({ count: 0 });
      prisma.adminSettings.findUnique.mockResolvedValue(null);

      await bootstrapTtsSystemGlobalsIfNeeded(prisma as unknown as PrismaClient);

      expect(prisma.adminSettings.upsert).toHaveBeenCalledTimes(1);
    });
  });
});
