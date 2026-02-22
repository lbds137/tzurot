/**
 * Tests for /user/memory/:id single memory operations
 *
 * Tests CRUD operations for individual memories:
 * - GET /:id - Get a single memory
 * - PATCH /:id - Update memory content
 * - POST /:id/lock - Toggle lock status
 * - DELETE /:id - Soft delete memory
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

// Mock memory helpers
vi.mock('./memoryHelpers.js', () => ({
  getUserByDiscordId: vi.fn(),
  getDefaultPersonaId: vi.fn(),
}));

import {
  handleGetMemory,
  handleUpdateMemory,
  handleToggleLock,
  handleDeleteMemory,
} from './memorySingle.js';
import { getUserByDiscordId, getDefaultPersonaId } from './memoryHelpers.js';

// Test constants
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_PERSONA_ID = '00000000-0000-0000-0000-000000000002';
const TEST_PERSONALITY_ID = '00000000-0000-0000-0000-000000000003';
const TEST_MEMORY_ID = '00000000-0000-0000-0000-000000000004';
const TEST_DISCORD_USER_ID = 'discord-user-123';

// Mock Prisma
const mockPrisma = {
  memory: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

const mockGetUserByDiscordId = vi.mocked(getUserByDiscordId);
const mockGetDefaultPersonaId = vi.mocked(getDefaultPersonaId);

// Helper to create mock request/response
function createMockReqRes(params: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  const req = {
    userId: TEST_DISCORD_USER_ID,
    params,
    body,
  } as unknown as AuthenticatedRequest;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

// Default memory fixture
const defaultMemory = {
  id: TEST_MEMORY_ID,
  content: 'Test memory content',
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  personalityId: TEST_PERSONALITY_ID,
  isLocked: false,
  personality: { name: 'test', displayName: 'Test Personality' },
};

describe('memorySingle handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default successful mocks
    mockGetUserByDiscordId.mockResolvedValue({ id: TEST_USER_ID });
    mockGetDefaultPersonaId.mockResolvedValue(TEST_PERSONA_ID);
    mockPrisma.memory.findFirst.mockResolvedValue(defaultMemory);
    mockPrisma.memory.update.mockResolvedValue(defaultMemory);
  });

  describe('handleGetMemory', () => {
    it('should reject missing memoryId', async () => {
      const { req, res } = createMockReqRes({ id: '' });

      await handleGetMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('Memory ID'),
        })
      );
    });

    it('should reject undefined memoryId', async () => {
      const { req, res } = createMockReqRes({});

      await handleGetMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return early when user not found', async () => {
      mockGetUserByDiscordId.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleGetMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(mockGetDefaultPersonaId).not.toHaveBeenCalled();
    });

    it('should return 404 when user has no persona', async () => {
      mockGetDefaultPersonaId.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleGetMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'NOT_FOUND',
        })
      );
    });

    it('should return 404 when memory not found', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleGetMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockPrisma.memory.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: TEST_MEMORY_ID,
            personaId: TEST_PERSONA_ID,
            visibility: 'normal',
          },
        })
      );
    });

    it('should return memory successfully', async () => {
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleGetMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          memory: expect.objectContaining({
            id: TEST_MEMORY_ID,
            content: 'Test memory content',
            personalityId: TEST_PERSONALITY_ID,
            personalityName: 'Test Personality',
            isLocked: false,
          }),
        })
      );
    });

    it('should use personality name when displayName is null', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue({
        ...defaultMemory,
        personality: { name: 'fallback-name', displayName: null },
      });
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleGetMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          memory: expect.objectContaining({
            personalityName: 'fallback-name',
          }),
        })
      );
    });

    it('should include formatted dates in response', async () => {
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleGetMemory(mockPrisma as unknown as PrismaClient, req, res);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.memory.createdAt).toBe('2025-01-01T00:00:00.000Z');
      expect(response.memory.updatedAt).toBe('2025-01-01T00:00:00.000Z');
    });
  });

  describe('handleUpdateMemory', () => {
    it('should reject missing memoryId', async () => {
      const { req, res } = createMockReqRes({ id: '' }, { content: 'new content' });

      await handleUpdateMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Memory ID'),
        })
      );
    });

    it('should reject missing content', async () => {
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, {});

      await handleUpdateMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('content'),
        })
      );
    });

    it('should reject empty content (whitespace only)', async () => {
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { content: '   ' });

      await handleUpdateMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject content exceeding max length', async () => {
      const longContent = 'a'.repeat(2001);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { content: longContent });

      await handleUpdateMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('maximum length'),
        })
      );
    });

    it('should accept content at exactly max length', async () => {
      const maxContent = 'a'.repeat(2000);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { content: maxContent });

      await handleUpdateMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return early when user not found', async () => {
      mockGetUserByDiscordId.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { content: 'new content' });

      await handleUpdateMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(mockGetDefaultPersonaId).not.toHaveBeenCalled();
    });

    it('should return 404 when user has no persona', async () => {
      mockGetDefaultPersonaId.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { content: 'new content' });

      await handleUpdateMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when memory not found (ownership check)', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { content: 'new content' });

      await handleUpdateMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockPrisma.memory.update).not.toHaveBeenCalled();
    });

    it('should update memory successfully', async () => {
      const updatedMemory = {
        ...defaultMemory,
        content: 'Updated content',
        updatedAt: new Date('2025-06-15'),
      };
      mockPrisma.memory.update.mockResolvedValue(updatedMemory);

      const { req, res } = createMockReqRes(
        { id: TEST_MEMORY_ID },
        { content: '  Updated content  ' }
      );

      await handleUpdateMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(mockPrisma.memory.update).toHaveBeenCalledWith({
        where: { id: TEST_MEMORY_ID },
        data: expect.objectContaining({
          content: 'Updated content', // Should be trimmed
        }),
        include: {
          personality: {
            select: { name: true, displayName: true },
          },
        },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          memory: expect.objectContaining({
            content: 'Updated content',
          }),
        })
      );
    });

    it('should update the updatedAt timestamp', async () => {
      const beforeUpdate = Date.now();
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { content: 'new content' });

      await handleUpdateMemory(mockPrisma as unknown as PrismaClient, req, res);

      const updateCall = mockPrisma.memory.update.mock.calls[0][0];
      const updatedAtDate = updateCall.data.updatedAt as Date;
      expect(updatedAtDate.getTime()).toBeGreaterThanOrEqual(beforeUpdate);
    });

    it('should reject editing a locked memory', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue({ ...defaultMemory, isLocked: true });
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { content: 'new content' });

      await handleUpdateMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('locked'),
        })
      );
      expect(mockPrisma.memory.update).not.toHaveBeenCalled();
    });
  });

  describe('handleToggleLock', () => {
    it('should reject missing memoryId', async () => {
      const { req, res } = createMockReqRes({ id: '' });

      await handleToggleLock(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Memory ID'),
        })
      );
    });

    it('should return early when user not found', async () => {
      mockGetUserByDiscordId.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleToggleLock(mockPrisma as unknown as PrismaClient, req, res);

      expect(mockGetDefaultPersonaId).not.toHaveBeenCalled();
    });

    it('should return 404 when user has no persona', async () => {
      mockGetDefaultPersonaId.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleToggleLock(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when memory not found', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleToggleLock(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockPrisma.memory.update).not.toHaveBeenCalled();
    });

    it('should lock an unlocked memory', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue({
        ...defaultMemory,
        isLocked: false,
      });
      mockPrisma.memory.update.mockResolvedValue({
        ...defaultMemory,
        isLocked: true,
      });

      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleToggleLock(mockPrisma as unknown as PrismaClient, req, res);

      expect(mockPrisma.memory.update).toHaveBeenCalledWith({
        where: { id: TEST_MEMORY_ID },
        data: expect.objectContaining({
          isLocked: true,
        }),
        include: {
          personality: {
            select: { name: true, displayName: true },
          },
        },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          memory: expect.objectContaining({
            isLocked: true,
          }),
        })
      );
    });

    it('should unlock a locked memory', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue({
        ...defaultMemory,
        isLocked: true,
      });
      mockPrisma.memory.update.mockResolvedValue({
        ...defaultMemory,
        isLocked: false,
      });

      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleToggleLock(mockPrisma as unknown as PrismaClient, req, res);

      expect(mockPrisma.memory.update).toHaveBeenCalledWith({
        where: { id: TEST_MEMORY_ID },
        data: expect.objectContaining({
          isLocked: false,
        }),
        include: expect.anything(),
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          memory: expect.objectContaining({
            isLocked: false,
          }),
        })
      );
    });

    it('should update the updatedAt timestamp when toggling', async () => {
      const beforeToggle = Date.now();
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleToggleLock(mockPrisma as unknown as PrismaClient, req, res);

      const updateCall = mockPrisma.memory.update.mock.calls[0][0];
      const updatedAtDate = updateCall.data.updatedAt as Date;
      expect(updatedAtDate.getTime()).toBeGreaterThanOrEqual(beforeToggle);
    });
  });

  describe('handleDeleteMemory', () => {
    it('should reject missing memoryId', async () => {
      const { req, res } = createMockReqRes({ id: '' });

      await handleDeleteMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Memory ID'),
        })
      );
    });

    it('should return early when user not found', async () => {
      mockGetUserByDiscordId.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleDeleteMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(mockGetDefaultPersonaId).not.toHaveBeenCalled();
    });

    it('should return 404 when user has no persona', async () => {
      mockGetDefaultPersonaId.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleDeleteMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when memory not found', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleDeleteMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockPrisma.memory.update).not.toHaveBeenCalled();
    });

    it('should soft delete memory by setting visibility', async () => {
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleDeleteMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(mockPrisma.memory.update).toHaveBeenCalledWith({
        where: { id: TEST_MEMORY_ID },
        data: expect.objectContaining({
          visibility: 'deleted',
        }),
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });

    it('should update the updatedAt timestamp when deleting', async () => {
      const beforeDelete = Date.now();
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleDeleteMemory(mockPrisma as unknown as PrismaClient, req, res);

      const updateCall = mockPrisma.memory.update.mock.calls[0][0];
      const updatedAtDate = updateCall.data.updatedAt as Date;
      expect(updatedAtDate.getTime()).toBeGreaterThanOrEqual(beforeDelete);
    });

    it('should verify ownership before delete', async () => {
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleDeleteMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(mockPrisma.memory.findFirst).toHaveBeenCalledWith({
        where: {
          id: TEST_MEMORY_ID,
          personaId: TEST_PERSONA_ID,
          visibility: 'normal',
        },
      });
    });

    it('should reject deleting a locked memory', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue({ ...defaultMemory, isLocked: true });
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleDeleteMemory(mockPrisma as unknown as PrismaClient, req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('locked'),
        })
      );
      expect(mockPrisma.memory.update).not.toHaveBeenCalled();
    });
  });
});
