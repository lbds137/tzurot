/**
 * Tests for cleanupExpiredExports
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanupExpiredExports } from './cleanupExpiredExports.js';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
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

const mockPrisma = {
  exportJob: {
    deleteMany: vi.fn(),
  },
};

describe('cleanupExpiredExports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should delete expired export jobs', async () => {
    mockPrisma.exportJob.deleteMany.mockResolvedValue({ count: 3 });

    const result = await cleanupExpiredExports(mockPrisma as never);

    expect(result.deleted).toBe(3);
    expect(mockPrisma.exportJob.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lt: expect.any(Date) },
      },
    });
  });

  it('should return 0 when no expired jobs exist', async () => {
    mockPrisma.exportJob.deleteMany.mockResolvedValue({ count: 0 });

    const result = await cleanupExpiredExports(mockPrisma as never);

    expect(result.deleted).toBe(0);
  });

  it('should handle deleteMany errors gracefully', async () => {
    mockPrisma.exportJob.deleteMany.mockRejectedValue(new Error('DB connection lost'));

    await expect(cleanupExpiredExports(mockPrisma as never)).rejects.toThrow('DB connection lost');
  });
});
