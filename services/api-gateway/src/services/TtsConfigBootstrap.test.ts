/**
 * Unit tests for the extracted TtsConfig bootstrap helper. The end-to-end
 * bootstrap flow (triggered by `list(GLOBAL)` returning empty) is covered by
 * `TtsConfigService.test.ts`; these tests focus on the helper's contract:
 * superuser gating, deterministic UUID seeding, and createMany shape.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';

import { bootstrapTtsSystemGlobalsIfNeeded } from './TtsConfigBootstrap.js';

interface MockPrisma {
  user: { findFirst: ReturnType<typeof vi.fn> };
  ttsConfig: { createMany: ReturnType<typeof vi.fn> };
}

function makePrisma(): MockPrisma {
  return {
    user: { findFirst: vi.fn() },
    ttsConfig: { createMany: vi.fn() },
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
  });

  it('seeds 3 system globals owned by the oldest superuser', async () => {
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

    // kyutai-self-hosted is both the system default AND the free-tier default.
    const kyutai = data.find(d => d.name === 'kyutai-self-hosted');
    expect(kyutai?.isDefault).toBe(true);
    expect(kyutai?.isFreeDefault).toBe(true);

    // The other two seeds are neither default nor free-default.
    expect(data.find(d => d.name === 'elevenlabs-multilingual-v2')?.isDefault).toBe(false);
    expect(data.find(d => d.name === 'mistral-voxtral-mini')?.isDefault).toBe(false);

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
    expect(data.find(d => d.name === 'kyutai-self-hosted')?.id).toBe(
      '50411d3c-cc98-5f39-839e-abd4fb84b0c8'
    );
  });

  it('treats createMany resolving with count: 0 as a no-op (race winner already seeded)', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'superuser-id' });
    prisma.ttsConfig.createMany.mockResolvedValue({ count: 0 });

    await expect(
      bootstrapTtsSystemGlobalsIfNeeded(prisma as unknown as PrismaClient)
    ).resolves.toBeUndefined();

    expect(prisma.ttsConfig.createMany).toHaveBeenCalledTimes(1);
  });
});
