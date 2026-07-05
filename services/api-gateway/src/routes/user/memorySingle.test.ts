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
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

// Mock logger
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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
  getDefaultPersonaId: vi.fn(),
}));

// Mock resolveProvisionedUserId
vi.mock('../../utils/resolveProvisionedUserId.js', () => ({
  resolveProvisionedUserId: vi.fn(),
}));

vi.mock('../../services/EmbeddingService.js', () => ({
  isEmbeddingServiceAvailable: vi.fn(),
  generateEmbedding: vi.fn(),
  formatAsVector: (embedding: number[]) => `[${embedding.join(',')}]`,
}));

import {
  handleGetMemory,
  handleUpdateMemory,
  handleSetMemoryLock,
  handleDeleteMemory,
} from './memorySingle.js';
import { getDefaultPersonaId } from './memoryHelpers.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { isEmbeddingServiceAvailable, generateEmbedding } from '../../services/EmbeddingService.js';

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
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
};

const mockIsEmbeddingAvailable = vi.mocked(isEmbeddingServiceAvailable);
const mockGenerateEmbedding = vi.mocked(generateEmbedding);

const mockResolveProvisionedUserId = vi.mocked(resolveProvisionedUserId);
const mockGetDefaultPersonaId = vi.mocked(getDefaultPersonaId);

/** Shared deps for the new (deps) => RequestHandler signature. */
function deps(): RouteDeps {
  return { prisma: mockPrisma as unknown as PrismaClient };
}

// Helper to create mock request/response
function createMockReqRes(params: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  const req = {
    userId: TEST_DISCORD_USER_ID,
    provisionedUserId: TEST_USER_ID,
    provisionedDefaultPersonaId: 'persona-uuid-default',
    params,
    body,
  } as unknown as ProvisionedRequest;

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
    mockResolveProvisionedUserId.mockReturnValue(TEST_USER_ID);
    mockGetDefaultPersonaId.mockResolvedValue(TEST_PERSONA_ID);
    mockPrisma.memory.findFirst.mockResolvedValue(defaultMemory);
    mockPrisma.memory.update.mockResolvedValue(defaultMemory);
    mockPrisma.$executeRaw.mockResolvedValue(1);
    // Array-form $transaction: the operations are already-invoked mock promises.
    mockPrisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
    mockIsEmbeddingAvailable.mockReturnValue(true);
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  describe('handleGetMemory', () => {
    it('should reject missing memoryId', async () => {
      const { req, res } = createMockReqRes({ id: '' });

      await handleGetMemory(deps())(req, res, () => undefined);

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

      await handleGetMemory(deps())(req, res, () => undefined);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 404 when user has no persona', async () => {
      mockGetDefaultPersonaId.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleGetMemory(deps())(req, res, () => undefined);

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

      await handleGetMemory(deps())(req, res, () => undefined);

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

      await handleGetMemory(deps())(req, res, () => undefined);

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

      await handleGetMemory(deps())(req, res, () => undefined);

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

      await handleGetMemory(deps())(req, res, () => undefined);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.memory.createdAt).toBe('2025-01-01T00:00:00.000Z');
      expect(response.memory.updatedAt).toBe('2025-01-01T00:00:00.000Z');
    });
  });

  describe('handleUpdateMemory', () => {
    it('should reject missing memoryId', async () => {
      const { req, res } = createMockReqRes({ id: '' }, { content: 'new content' });

      await handleUpdateMemory(deps())(req, res, () => undefined);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Memory ID'),
        })
      );
    });

    it('should reject missing content', async () => {
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, {});

      await handleUpdateMemory(deps())(req, res, () => undefined);

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

      await handleUpdateMemory(deps())(req, res, () => undefined);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject content exceeding max length', async () => {
      const longContent = 'a'.repeat(2001);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { content: longContent });

      await handleUpdateMemory(deps())(req, res, () => undefined);

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

      await handleUpdateMemory(deps())(req, res, () => undefined);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return 404 when user has no persona', async () => {
      mockGetDefaultPersonaId.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { content: 'new content' });

      await handleUpdateMemory(deps())(req, res, () => undefined);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when memory not found (ownership check)', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { content: 'new content' });

      await handleUpdateMemory(deps())(req, res, () => undefined);

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

      await handleUpdateMemory(deps())(req, res, () => undefined);

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

      await handleUpdateMemory(deps())(req, res, () => undefined);

      const updateCall = mockPrisma.memory.update.mock.calls[0][0];
      const updatedAtDate = updateCall.data.updatedAt as Date;
      expect(updatedAtDate.getTime()).toBeGreaterThanOrEqual(beforeUpdate);
    });

    it('should reject editing a locked memory', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue({ ...defaultMemory, isLocked: true });
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { content: 'new content' });

      await handleUpdateMemory(deps())(req, res, () => undefined);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('locked'),
        })
      );
      expect(mockPrisma.memory.update).not.toHaveBeenCalled();
    });

    it('re-embeds the edited content with the new vector', async () => {
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { content: ' new content ' });

      await handleUpdateMemory(deps())(req, res, () => undefined);

      // The trimmed edited text is what gets embedded — not the raw body.
      expect(mockGenerateEmbedding).toHaveBeenCalledWith('new content');
      // The UPDATE carries the formatted vector and the memory id.
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      const call = mockPrisma.$executeRaw.mock.calls[0];
      expect(call[0].join('')).toContain('SET embedding =');
      expect(call).toContain('[0.1,0.2,0.3]');
      expect(call).toContain(TEST_MEMORY_ID);
    });

    it('NULLs the embedding when re-embedding fails (stale vector must not survive)', async () => {
      mockGenerateEmbedding.mockRejectedValue(new Error('model down'));
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { content: 'new content' });

      await handleUpdateMemory(deps())(req, res, () => undefined);

      const call = mockPrisma.$executeRaw.mock.calls[0];
      expect(call[0].join('')).toContain('SET embedding = NULL');
      expect(res.status).toHaveBeenCalledWith(200); // edit still succeeds
    });

    it('NULLs the embedding when the embedding service is unavailable', async () => {
      mockIsEmbeddingAvailable.mockReturnValue(false);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { content: 'new content' });

      await handleUpdateMemory(deps())(req, res, () => undefined);

      expect(mockGenerateEmbedding).not.toHaveBeenCalled();
      const call = mockPrisma.$executeRaw.mock.calls[0];
      expect(call[0].join('')).toContain('SET embedding = NULL');
    });

    it('commits the content update and vector write in one transaction', async () => {
      // A partial commit (content updated, vector write failed) would leave
      // the new text retrievable by its OLD embedding — the exact bug class
      // this route guards against.
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { content: 'new content' });

      await handleUpdateMemory(deps())(req, res, () => undefined);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const ops = mockPrisma.$transaction.mock.calls[0][0] as unknown[];
      expect(ops).toHaveLength(2);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('handleSetMemoryLock', () => {
    it('should reject missing memoryId', async () => {
      const { req, res } = createMockReqRes({ id: '' }, { locked: true });

      await handleSetMemoryLock(deps())(req, res, () => undefined);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Memory ID'),
        })
      );
    });

    it('should reject missing locked field in body', async () => {
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, {});

      await handleSetMemoryLock(deps())(req, res, () => undefined);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.memory.update).not.toHaveBeenCalled();
    });

    it('should reject non-boolean locked field', async () => {
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { locked: 'yes' });

      await handleSetMemoryLock(deps())(req, res, () => undefined);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.memory.update).not.toHaveBeenCalled();
    });

    it('should return 404 when user has no persona', async () => {
      mockGetDefaultPersonaId.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { locked: true });

      await handleSetMemoryLock(deps())(req, res, () => undefined);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when memory not found', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { locked: true });

      await handleSetMemoryLock(deps())(req, res, () => undefined);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockPrisma.memory.update).not.toHaveBeenCalled();
    });

    it('should lock an unlocked memory when locked=true', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue({
        ...defaultMemory,
        isLocked: false,
      });
      mockPrisma.memory.update.mockResolvedValue({
        ...defaultMemory,
        isLocked: true,
      });

      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { locked: true });

      await handleSetMemoryLock(deps())(req, res, () => undefined);

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

    it('should unlock a locked memory when locked=false', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue({
        ...defaultMemory,
        isLocked: true,
      });
      mockPrisma.memory.update.mockResolvedValue({
        ...defaultMemory,
        isLocked: false,
      });

      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { locked: false });

      await handleSetMemoryLock(deps())(req, res, () => undefined);

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

    it('idempotent: short-circuits when desired state already holds (locked=true on locked memory)', async () => {
      // The idempotency property — caller can retry on network timeout
      // without flipping the state again. handler returns current memory
      // without calling update.
      mockPrisma.memory.findFirst.mockResolvedValue({
        ...defaultMemory,
        isLocked: true,
      });
      mockPrisma.memory.findUnique.mockResolvedValue({
        ...defaultMemory,
        isLocked: true,
      });

      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { locked: true });

      await handleSetMemoryLock(deps())(req, res, () => undefined);

      expect(mockPrisma.memory.update).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          memory: expect.objectContaining({ isLocked: true }),
        })
      );
    });

    it('idempotent: short-circuits when desired state already holds (locked=false on unlocked memory)', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue({
        ...defaultMemory,
        isLocked: false,
      });
      mockPrisma.memory.findUnique.mockResolvedValue({
        ...defaultMemory,
        isLocked: false,
      });

      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { locked: false });

      await handleSetMemoryLock(deps())(req, res, () => undefined);

      expect(mockPrisma.memory.update).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should update the updatedAt timestamp when state changes', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue({
        ...defaultMemory,
        isLocked: false,
      });
      mockPrisma.memory.update.mockResolvedValue({
        ...defaultMemory,
        isLocked: true,
      });

      const beforeToggle = Date.now();
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID }, { locked: true });

      await handleSetMemoryLock(deps())(req, res, () => undefined);

      const updateCall = mockPrisma.memory.update.mock.calls[0][0];
      const updatedAtDate = updateCall.data.updatedAt as Date;
      expect(updatedAtDate.getTime()).toBeGreaterThanOrEqual(beforeToggle);
    });
  });

  describe('handleDeleteMemory', () => {
    it('should reject missing memoryId', async () => {
      const { req, res } = createMockReqRes({ id: '' });

      await handleDeleteMemory(deps())(req, res, () => undefined);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Memory ID'),
        })
      );
    });

    it('should return 404 when user has no persona', async () => {
      mockGetDefaultPersonaId.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleDeleteMemory(deps())(req, res, () => undefined);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 when memory not found', async () => {
      mockPrisma.memory.findFirst.mockResolvedValue(null);
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleDeleteMemory(deps())(req, res, () => undefined);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockPrisma.memory.update).not.toHaveBeenCalled();
    });

    it('should soft delete memory by setting visibility', async () => {
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleDeleteMemory(deps())(req, res, () => undefined);

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

      await handleDeleteMemory(deps())(req, res, () => undefined);

      const updateCall = mockPrisma.memory.update.mock.calls[0][0];
      const updatedAtDate = updateCall.data.updatedAt as Date;
      expect(updatedAtDate.getTime()).toBeGreaterThanOrEqual(beforeDelete);
    });

    it('should verify ownership before delete', async () => {
      const { req, res } = createMockReqRes({ id: TEST_MEMORY_ID });

      await handleDeleteMemory(deps())(req, res, () => undefined);

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

      await handleDeleteMemory(deps())(req, res, () => undefined);

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
