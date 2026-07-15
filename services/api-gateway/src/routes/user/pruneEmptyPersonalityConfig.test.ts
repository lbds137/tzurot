import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { pruneEmptyPersonalityConfig } from './pruneEmptyPersonalityConfig.js';

const findUnique = vi.fn();
const del = vi.fn();
const prisma = {
  userPersonalityConfig: { findUnique, delete: del },
} as unknown as PrismaClient;

const ALL_NULL = {
  personaId: null,
  llmConfigId: null,
  visionConfigId: null,
  ttsConfigId: null,
  configOverrides: null,
};

describe('pruneEmptyPersonalityConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    del.mockResolvedValue({});
  });

  it('deletes the row when every slice is null', async () => {
    findUnique.mockResolvedValue(ALL_NULL);

    const pruned = await pruneEmptyPersonalityConfig(prisma, 'row-1');

    expect(pruned).toBe(true);
    expect(del).toHaveBeenCalledWith({ where: { id: 'row-1' } });
  });

  it('keeps the row when any slice is still set', async () => {
    findUnique.mockResolvedValue({ ...ALL_NULL, ttsConfigId: 'tts-1' });

    const pruned = await pruneEmptyPersonalityConfig(prisma, 'row-1');

    expect(pruned).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it('is a no-op when the row is already gone', async () => {
    findUnique.mockResolvedValue(null);

    const pruned = await pruneEmptyPersonalityConfig(prisma, 'row-1');

    expect(pruned).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });
});
