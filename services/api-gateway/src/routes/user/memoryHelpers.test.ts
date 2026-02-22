/**
 * Tests for shared memory route helpers
 *
 * Tests getUserByDiscordId, getDefaultPersonaId, getPersonalityById, and parseTimeframeFilter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { PrismaClient } from '@tzurot/common-types';

import {
  getUserByDiscordId,
  getDefaultPersonaId,
  getPersonalityById,
  parseTimeframeFilter,
} from './memoryHelpers.js';

// Mock Prisma
const mockPrisma = {
  user: {
    findUnique: vi.fn(),
  },
  personality: {
    findUnique: vi.fn(),
  },
} as unknown as PrismaClient;

function createMockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('memoryHelpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUserByDiscordId', () => {
    it('should return user when found', async () => {
      (mockPrisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'user-uuid',
      });
      const res = createMockRes();

      const result = await getUserByDiscordId(mockPrisma, 'discord-123', res);

      expect(result).toEqual({ id: 'user-uuid' });
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { discordId: 'discord-123' },
        select: { id: true },
      });
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return null and send 404 when user not found', async () => {
      (mockPrisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = createMockRes();

      const result = await getUserByDiscordId(mockPrisma, 'discord-unknown', res);

      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'NOT_FOUND',
          message: 'User not found',
        })
      );
    });
  });

  describe('getDefaultPersonaId', () => {
    it('should return persona ID when user has one', async () => {
      (mockPrisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        defaultPersonaId: 'persona-uuid',
      });

      const result = await getDefaultPersonaId(mockPrisma, 'user-uuid');

      expect(result).toBe('persona-uuid');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-uuid' },
        select: { defaultPersonaId: true },
      });
    });

    it('should return null when user has no default persona', async () => {
      (mockPrisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        defaultPersonaId: null,
      });

      const result = await getDefaultPersonaId(mockPrisma, 'user-uuid');

      expect(result).toBeNull();
    });

    it('should return null when user not found', async () => {
      (mockPrisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await getDefaultPersonaId(mockPrisma, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getPersonalityById', () => {
    it('should return personality when found', async () => {
      (mockPrisma.personality.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'pers-uuid',
        name: 'test-personality',
      });
      const res = createMockRes();

      const result = await getPersonalityById(mockPrisma, 'pers-uuid', res);

      expect(result).toEqual({ id: 'pers-uuid', name: 'test-personality' });
      expect(mockPrisma.personality.findUnique).toHaveBeenCalledWith({
        where: { id: 'pers-uuid' },
        select: { id: true, name: true },
      });
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return null and send 404 when personality not found', async () => {
      (mockPrisma.personality.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = createMockRes();

      const result = await getPersonalityById(mockPrisma, 'unknown', res);

      expect(result).toBeNull();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'NOT_FOUND',
          message: 'Personality not found',
        })
      );
    });
  });

  describe('parseTimeframeFilter', () => {
    it('should return null filter for undefined timeframe', () => {
      const result = parseTimeframeFilter(undefined);
      expect(result).toEqual({ filter: null });
    });

    it('should return null filter for empty string', () => {
      const result = parseTimeframeFilter('');
      expect(result).toEqual({ filter: null });
    });

    it('should return gte date filter for valid timeframe', () => {
      const before = Date.now();
      const result = parseTimeframeFilter('1h');
      const after = Date.now();

      expect(result.error).toBeUndefined();
      expect(result.filter).not.toBeNull();
      // The cutoff date should be approximately 1 hour ago
      const cutoff = result.filter!.gte.getTime();
      const oneHourMs = 60 * 60 * 1000;
      expect(cutoff).toBeGreaterThanOrEqual(before - oneHourMs - 100);
      expect(cutoff).toBeLessThanOrEqual(after - oneHourMs + 100);
    });

    it('should return error for invalid timeframe format', () => {
      const result = parseTimeframeFilter('invalid');

      expect(result.filter).toBeNull();
      expect(result.error).toContain('Invalid timeframe format');
    });
  });
});
