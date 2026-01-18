/**
 * Tests for /user/memory batch operations
 *
 * Tests batch delete and purge operations:
 * - GET /delete/preview - Preview batch deletion
 * - POST /delete - Batch delete with filters
 * - POST /purge - Purge all memories (requires confirmation)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { PrismaClient } from '@tzurot/common-types';
import type { AuthenticatedRequest } from '../../types.js';

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

import { handleBatchDelete, handleBatchDeletePreview, handlePurge } from './memoryBatch.js';

// Test constants
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_PERSONA_ID = '00000000-0000-0000-0000-000000000002';
const TEST_PERSONALITY_ID = '00000000-0000-0000-0000-000000000003';
const TEST_DISCORD_USER_ID = 'discord-user-123';

// Mock Prisma
const mockPrisma = {
  memory: {
    count: vi.fn(),
    updateMany: vi.fn(),
  },
  personality: {
    findUnique: vi.fn(),
  },
  persona: {
    findUnique: vi.fn(),
  },
};

// Mock dependencies
const mockGetUserByDiscordId = vi.fn();
const mockGetDefaultPersonaId = vi.fn();

// Helper to create mock request with body
function createMockBodyReq(body: Record<string, unknown> = {}) {
  const req = {
    userId: TEST_DISCORD_USER_ID,
    body,
    params: {},
    query: {},
  } as unknown as AuthenticatedRequest;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

// Helper to create mock request with query params
function createMockQueryReq(query: Record<string, string> = {}) {
  const req = {
    userId: TEST_DISCORD_USER_ID,
    body: {},
    params: {},
    query,
  } as unknown as AuthenticatedRequest;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

// Default personality fixture
const defaultPersonality = {
  id: TEST_PERSONALITY_ID,
  name: 'test-personality',
};

// Default persona fixture
const defaultPersona = {
  id: TEST_PERSONA_ID,
  ownerId: TEST_USER_ID,
};

describe('memoryBatch handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default successful mocks
    mockGetUserByDiscordId.mockResolvedValue({ id: TEST_USER_ID });
    mockGetDefaultPersonaId.mockResolvedValue(TEST_PERSONA_ID);
    mockPrisma.personality.findUnique.mockResolvedValue(defaultPersonality);
    mockPrisma.persona.findUnique.mockResolvedValue(defaultPersona);
    mockPrisma.memory.count.mockResolvedValue(0);
    mockPrisma.memory.updateMany.mockResolvedValue({ count: 0 });
  });

  describe('handleBatchDeletePreview', () => {
    it('should reject missing personalityId', async () => {
      const { req, res } = createMockQueryReq({});

      await handleBatchDeletePreview(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('personalityId'),
        })
      );
    });

    it('should reject empty personalityId', async () => {
      const { req, res } = createMockQueryReq({ personalityId: '' });

      await handleBatchDeletePreview(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return early when user not found', async () => {
      mockGetUserByDiscordId.mockResolvedValue(null);
      const { req, res } = createMockQueryReq({ personalityId: TEST_PERSONALITY_ID });

      await handleBatchDeletePreview(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(mockPrisma.personality.findUnique).not.toHaveBeenCalled();
    });

    it('should return 404 when personality not found', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);
      const { req, res } = createMockQueryReq({ personalityId: TEST_PERSONALITY_ID });

      await handleBatchDeletePreview(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'NOT_FOUND',
        })
      );
    });

    it('should return zero counts when user has no persona', async () => {
      mockGetDefaultPersonaId.mockResolvedValue(null);
      const { req, res } = createMockQueryReq({ personalityId: TEST_PERSONALITY_ID });

      await handleBatchDeletePreview(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          wouldDelete: 0,
          lockedWouldSkip: 0,
        })
      );
    });

    it('should reject invalid timeframe format', async () => {
      const { req, res } = createMockQueryReq({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: 'invalid',
      });

      await handleBatchDeletePreview(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Invalid timeframe'),
        })
      );
    });

    it('should return preview counts for valid request', async () => {
      mockPrisma.memory.count
        .mockResolvedValueOnce(10) // wouldDelete
        .mockResolvedValueOnce(2); // lockedWouldSkip

      const { req, res } = createMockQueryReq({ personalityId: TEST_PERSONALITY_ID });

      await handleBatchDeletePreview(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          wouldDelete: 10,
          lockedWouldSkip: 2,
          personalityId: TEST_PERSONALITY_ID,
          personalityName: 'test-personality',
          timeframe: 'all',
        })
      );
    });

    it('should apply timeframe filter when provided (hours)', async () => {
      mockPrisma.memory.count.mockResolvedValue(5);
      const { req, res } = createMockQueryReq({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: '24h',
      });

      await handleBatchDeletePreview(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(mockPrisma.memory.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        })
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ timeframe: '24h' }));
    });

    it('should apply timeframe filter when provided (days)', async () => {
      mockPrisma.memory.count.mockResolvedValue(3);
      const { req, res } = createMockQueryReq({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: '7d',
      });

      await handleBatchDeletePreview(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(mockPrisma.memory.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        })
      );
    });

    it('should apply timeframe filter when provided (years)', async () => {
      mockPrisma.memory.count.mockResolvedValue(100);
      const { req, res } = createMockQueryReq({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: '1y',
      });

      await handleBatchDeletePreview(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should use custom personaId when provided', async () => {
      const customPersonaId = '00000000-0000-0000-0000-000000000099';
      const { req, res } = createMockQueryReq({
        personalityId: TEST_PERSONALITY_ID,
        personaId: customPersonaId,
      });

      await handleBatchDeletePreview(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(mockPrisma.memory.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            personaId: customPersonaId,
          }),
        })
      );
    });
  });

  describe('handleBatchDelete', () => {
    it('should reject missing personalityId', async () => {
      const { req, res } = createMockBodyReq({});

      await handleBatchDelete(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('personalityId'),
        })
      );
    });

    it('should return early when user not found', async () => {
      mockGetUserByDiscordId.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({ personalityId: TEST_PERSONALITY_ID });

      await handleBatchDelete(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(mockPrisma.personality.findUnique).not.toHaveBeenCalled();
    });

    it('should return 404 when personality not found', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({ personalityId: TEST_PERSONALITY_ID });

      await handleBatchDelete(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 when user has no persona', async () => {
      mockGetDefaultPersonaId.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({ personalityId: TEST_PERSONALITY_ID });

      await handleBatchDelete(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('No persona'),
        })
      );
    });

    it('should return 403 when persona does not belong to user', async () => {
      mockPrisma.persona.findUnique.mockResolvedValue({
        id: TEST_PERSONA_ID,
        ownerId: 'different-user-id',
      });
      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        personaId: TEST_PERSONA_ID,
      });

      await handleBatchDelete(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should reject invalid timeframe format', async () => {
      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: 'invalid', // not a valid duration format
      });

      await handleBatchDelete(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Invalid timeframe'),
        })
      );
    });

    it('should return success with zero count when no memories match', async () => {
      mockPrisma.memory.count.mockResolvedValue(0);
      const { req, res } = createMockBodyReq({ personalityId: TEST_PERSONALITY_ID });

      await handleBatchDelete(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deletedCount: 0,
          message: expect.stringContaining('No memories found'),
        })
      );
      expect(mockPrisma.memory.updateMany).not.toHaveBeenCalled();
    });

    it('should delete memories and return counts', async () => {
      mockPrisma.memory.count
        .mockResolvedValueOnce(5) // count to delete
        .mockResolvedValueOnce(2); // locked count
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 5 });

      const { req, res } = createMockBodyReq({ personalityId: TEST_PERSONALITY_ID });

      await handleBatchDelete(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(mockPrisma.memory.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          personaId: TEST_PERSONA_ID,
          personalityId: TEST_PERSONALITY_ID,
          visibility: 'normal',
          isLocked: false,
        }),
        data: expect.objectContaining({
          visibility: 'deleted',
          updatedAt: expect.any(Date),
        }),
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deletedCount: 5,
          skippedLocked: 2,
          personalityId: TEST_PERSONALITY_ID,
          personalityName: 'test-personality',
        })
      );
    });

    it('should include locked message when locked memories exist', async () => {
      mockPrisma.memory.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 3 });

      const { req, res } = createMockBodyReq({ personalityId: TEST_PERSONALITY_ID });

      await handleBatchDelete(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('locked memories were skipped'),
        })
      );
    });

    it('should apply timeframe filter in delete', async () => {
      mockPrisma.memory.count.mockResolvedValue(2);
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 2 });

      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        timeframe: '30d',
      });

      await handleBatchDelete(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(mockPrisma.memory.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        })
      );
    });

    it('should use custom personaId when provided', async () => {
      const customPersonaId = '00000000-0000-0000-0000-000000000099';
      mockPrisma.persona.findUnique.mockResolvedValue({
        id: customPersonaId,
        ownerId: TEST_USER_ID,
      });
      mockPrisma.memory.count.mockResolvedValue(1);
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 1 });

      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        personaId: customPersonaId,
      });

      await handleBatchDelete(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(mockPrisma.memory.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            personaId: customPersonaId,
          }),
        })
      );
    });
  });

  describe('handlePurge', () => {
    it('should reject missing personalityId', async () => {
      const { req, res } = createMockBodyReq({});

      await handlePurge(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('personalityId'),
        })
      );
    });

    it('should return early when user not found', async () => {
      mockGetUserByDiscordId.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({ personalityId: TEST_PERSONALITY_ID });

      await handlePurge(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(mockPrisma.personality.findUnique).not.toHaveBeenCalled();
    });

    it('should return 404 when personality not found', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({ personalityId: TEST_PERSONALITY_ID });

      await handlePurge(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should reject missing confirmation phrase', async () => {
      const { req, res } = createMockBodyReq({ personalityId: TEST_PERSONALITY_ID });

      await handlePurge(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Confirmation required'),
        })
      );
    });

    it('should reject incorrect confirmation phrase', async () => {
      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        confirmationPhrase: 'wrong phrase',
      });

      await handlePurge(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('DELETE TEST-PERSONALITY MEMORIES'),
        })
      );
    });

    it('should accept case-insensitive confirmation phrase', async () => {
      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        confirmationPhrase: 'delete test-personality memories', // lowercase - should still work
      });

      await handlePurge(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      // Should succeed with lowercase phrase (case-insensitive for better UX)
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return 400 when user has no persona', async () => {
      mockGetDefaultPersonaId.mockResolvedValue(null);
      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        confirmationPhrase: 'DELETE TEST-PERSONALITY MEMORIES',
      });

      await handlePurge(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('No persona'),
        })
      );
    });

    it('should purge all non-locked memories with correct confirmation', async () => {
      mockPrisma.memory.count
        .mockResolvedValueOnce(10) // total count
        .mockResolvedValueOnce(3); // locked count
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 7 });

      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        confirmationPhrase: 'DELETE TEST-PERSONALITY MEMORIES',
      });

      await handlePurge(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(mockPrisma.memory.updateMany).toHaveBeenCalledWith({
        where: {
          personaId: TEST_PERSONA_ID,
          personalityId: TEST_PERSONALITY_ID,
          visibility: 'normal',
          isLocked: false,
        },
        data: expect.objectContaining({
          visibility: 'deleted',
          updatedAt: expect.any(Date),
        }),
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deletedCount: 7,
          lockedPreserved: 3,
          personalityId: TEST_PERSONALITY_ID,
          personalityName: 'test-personality',
        })
      );
    });

    it('should include locked message when locked memories preserved', async () => {
      mockPrisma.memory.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 3 });

      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        confirmationPhrase: 'DELETE TEST-PERSONALITY MEMORIES',
      });

      await handlePurge(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('locked (core) memories were preserved'),
        })
      );
    });

    it('should include simple message when no locked memories', async () => {
      mockPrisma.memory.count.mockResolvedValueOnce(5).mockResolvedValueOnce(0);
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 5 });

      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        confirmationPhrase: 'DELETE TEST-PERSONALITY MEMORIES',
      });

      await handlePurge(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Purged all 5 memories'),
        })
      );
    });

    it('should handle purge with zero memories gracefully', async () => {
      mockPrisma.memory.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      mockPrisma.memory.updateMany.mockResolvedValue({ count: 0 });

      const { req, res } = createMockBodyReq({
        personalityId: TEST_PERSONALITY_ID,
        confirmationPhrase: 'DELETE TEST-PERSONALITY MEMORIES',
      });

      await handlePurge(
        mockPrisma as unknown as PrismaClient,
        mockGetUserByDiscordId,
        mockGetDefaultPersonaId,
        req,
        res
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          deletedCount: 0,
        })
      );
    });
  });
});
