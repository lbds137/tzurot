/**
 * Unit tests for the vision-config system-globals bootstrap. Focus on the helper's
 * contract: superuser gating, deterministic-UUID seeding, kind='vision' shape, and the
 * paid/free default flags.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type PrismaClient,
  MODEL_DEFAULTS,
  generateSystemGlobalLlmConfigUuid,
} from '@tzurot/common-types';

import { bootstrapVisionSystemGlobalsIfNeeded } from './VisionConfigBootstrap.js';

interface MockPrisma {
  user: { findFirst: ReturnType<typeof vi.fn> };
  llmConfig: { createMany: ReturnType<typeof vi.fn> };
}

function makePrisma(): MockPrisma {
  return {
    user: { findFirst: vi.fn() },
    llmConfig: { createMany: vi.fn() },
  };
}

describe('bootstrapVisionSystemGlobalsIfNeeded', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
  });

  it('no-ops when no superuser exists', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await bootstrapVisionSystemGlobalsIfNeeded(prisma as unknown as PrismaClient);

    expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.llmConfig.createMany).not.toHaveBeenCalled();
  });

  it('seeds the vision globals owned by the oldest superuser, idempotently', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'superuser-id' });
    prisma.llmConfig.createMany.mockResolvedValue({ count: 2 });

    await bootstrapVisionSystemGlobalsIfNeeded(prisma as unknown as PrismaClient);

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { isSuperuser: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    expect(prisma.llmConfig.createMany).toHaveBeenCalledTimes(1);
    const [{ data, skipDuplicates }] = prisma.llmConfig.createMany.mock.calls[0] as [
      { data: Array<Record<string, unknown>>; skipDuplicates: boolean },
    ];

    // skipDuplicates → INSERT ... ON CONFLICT DO NOTHING (idempotent across boots).
    expect(skipDuplicates).toBe(true);
    expect(data.map(d => d.name)).toEqual(['vision-default', 'vision-free-default']);

    // Every seed is a kind='vision' global owned by the superuser, on openrouter.
    for (const row of data) {
      expect(row.kind).toBe('vision');
      expect(row.isGlobal).toBe(true);
      expect(row.ownerId).toBe('superuser-id');
      expect(row.provider).toBe('openrouter');
    }

    // Deterministic IDs come from the shared generator (so dev/prod align).
    expect(data[0].id).toBe(generateSystemGlobalLlmConfigUuid('vision-default'));
    expect(data[1].id).toBe(generateSystemGlobalLlmConfigUuid('vision-free-default'));

    // Paid default: the fast model, NOT the slow VISION_FALLBACK floor.
    expect(data[0].isDefault).toBe(true);
    expect(data[0].isFreeDefault).toBe(false);
    expect(data[0].model).toBe('qwen/qwen3.7-plus');
    expect(data[0].model).not.toBe(MODEL_DEFAULTS.VISION_FALLBACK);

    // Free default.
    expect(data[1].isDefault).toBe(false);
    expect(data[1].isFreeDefault).toBe(true);
    expect(data[1].model).toBe(MODEL_DEFAULTS.VISION_FALLBACK_FREE);
  });
});
