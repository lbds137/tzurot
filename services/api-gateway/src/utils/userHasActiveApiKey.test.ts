import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { userHasActiveApiKey } from './userHasActiveApiKey.js';

const mockFindFirst = vi.fn();
const mockPrisma = {
  userApiKey: { findFirst: mockFindFirst },
} as unknown as PrismaClient;

describe('userHasActiveApiKey', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns true when an active key row exists', async () => {
    mockFindFirst.mockResolvedValue({ id: 'key-1' });

    const result = await userHasActiveApiKey(mockPrisma, 'user-uuid', AIProvider.ZaiCoding);

    expect(result).toBe(true);
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { userId: 'user-uuid', provider: AIProvider.ZaiCoding, isActive: true },
      select: { id: true },
    });
  });

  it('returns false when no active key row exists', async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await userHasActiveApiKey(mockPrisma, 'user-uuid', AIProvider.ZaiCoding);

    expect(result).toBe(false);
  });

  it('filters on isActive: true (an inactive-only key reads as absent)', async () => {
    // The query itself encodes the isActive filter; this asserts the where
    // clause so a future refactor that drops the filter is caught.
    mockFindFirst.mockResolvedValue(null);

    await userHasActiveApiKey(mockPrisma, 'user-uuid', AIProvider.OpenRouter);

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      })
    );
  });
});
