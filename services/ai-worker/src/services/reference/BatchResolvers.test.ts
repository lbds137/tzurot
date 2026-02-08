import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';
import {
  batchResolveByShapesUserIds,
  batchResolveByDiscordIds,
  batchResolveByUsernames,
} from './BatchResolvers.js';

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  };
});

describe('BatchResolvers', () => {
  let mockPrisma: {
    shapesPersonaMapping: { findMany: ReturnType<typeof vi.fn> };
    user: { findMany: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = {
      shapesPersonaMapping: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    };
  });

  describe('batchResolveByShapesUserIds', () => {
    it('should return empty map for empty input', async () => {
      const result = await batchResolveByShapesUserIds(mockPrisma as unknown as PrismaClient, []);

      expect(result.size).toBe(0);
      expect(mockPrisma.shapesPersonaMapping.findMany).not.toHaveBeenCalled();
    });

    it('should resolve shapes user IDs to personas', async () => {
      const uuid = '98a94b95-cbd0-430b-8be2-602e1c75d8b0';
      mockPrisma.shapesPersonaMapping.findMany.mockResolvedValue([
        {
          shapesUserId: uuid,
          persona: {
            id: 'persona-1',
            name: 'user1',
            preferredName: 'Alice',
            pronouns: 'she/her',
            content: 'A tester',
          },
        },
      ]);

      const result = await batchResolveByShapesUserIds(mockPrisma as unknown as PrismaClient, [
        uuid,
      ]);

      expect(result.size).toBe(1);
      expect(result.get(uuid)?.personaName).toBe('Alice');
    });

    it('should handle database errors gracefully', async () => {
      mockPrisma.shapesPersonaMapping.findMany.mockRejectedValue(new Error('DB error'));

      const result = await batchResolveByShapesUserIds(mockPrisma as unknown as PrismaClient, [
        'some-id',
      ]);

      expect(result.size).toBe(0);
    });
  });

  describe('batchResolveByDiscordIds', () => {
    it('should return empty map for empty input', async () => {
      const result = await batchResolveByDiscordIds(mockPrisma as unknown as PrismaClient, []);

      expect(result.size).toBe(0);
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    });

    it('should resolve Discord IDs to personas', async () => {
      const discordId = '278863839632818186';
      mockPrisma.user.findMany.mockResolvedValue([
        {
          discordId,
          defaultPersona: {
            id: 'persona-1',
            name: 'lbds137',
            preferredName: 'Lila',
            pronouns: 'she/her',
            content: 'A user',
          },
        },
      ]);

      const result = await batchResolveByDiscordIds(mockPrisma as unknown as PrismaClient, [
        discordId,
      ]);

      expect(result.size).toBe(1);
      expect(result.get(discordId)?.personaName).toBe('Lila');
    });
  });

  describe('batchResolveByUsernames', () => {
    it('should return empty map for empty input', async () => {
      const result = await batchResolveByUsernames(mockPrisma as unknown as PrismaClient, []);

      expect(result.size).toBe(0);
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    });

    it('should resolve usernames case-insensitively', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        {
          username: 'Alice',
          defaultPersona: {
            id: 'persona-1',
            name: 'alice',
            preferredName: 'Alice',
            pronouns: null,
            content: '',
          },
        },
      ]);

      const result = await batchResolveByUsernames(mockPrisma as unknown as PrismaClient, [
        'alice',
      ]);

      expect(result.size).toBe(1);
      expect(result.get('alice')?.personaName).toBe('Alice');
    });
  });
});
