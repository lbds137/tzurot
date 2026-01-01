/**
 * Tests for DELETE /user/personality/:slug (delete personality)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeletePersonalityResponseSchema, type PrismaClient } from '@tzurot/common-types';
import {
  createMockPrisma,
  createMockReqRes,
  getHandler,
  mockIsBotOwner,
  setupStandardMocks,
} from './test-utils.js';

// Mock dependencies before imports
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  const { mockIsBotOwner: mockFn } = await import('./test-utils.js');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    isBotOwner: (...args: unknown[]) => (mockFn as (...args: unknown[]) => boolean)(...args),
  };
});

vi.mock('../../../services/AuthMiddleware.js', () => ({
  requireUserAuth: vi.fn(() => vi.fn((_req: unknown, _res: unknown, next: () => void) => next())),
}));

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

// Mock fs/promises for avatar cache deletion tests
vi.mock('fs/promises', () => ({
  unlink: vi.fn(),
}));
import * as fsPromises from 'fs/promises';
const mockUnlink = vi.mocked(fsPromises.unlink);

import { createPersonalityRoutes } from './index.js';

describe('DELETE /user/personality/:slug', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
    mockUnlink.mockReset();
  });

  it('should return 403 when user not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'delete', '/:slug');
    const { req, res } = createMockReqRes({}, { slug: 'test-char' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should return 404 when personality not found', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue(null);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'delete', '/:slug');
    const { req, res } = createMockReqRes({}, { slug: 'nonexistent' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 403 when user does not own personality', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: 'personality-other',
      name: 'Not Mine',
      ownerId: 'other-user-uuid',
      _count: {
        conversationHistory: 0,
        memories: 0,
        channelSettings: 0,
        aliases: 0,
      },
    });

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'delete', '/:slug');
    const { req, res } = createMockReqRes({}, { slug: 'not-mine' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockPrisma.personality.delete).not.toHaveBeenCalled();
  });

  it('should delete owned personality successfully', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: 'personality-owned',
      name: 'My Character',
      ownerId: 'user-uuid-123',
      _count: {
        conversationHistory: 10,
        memories: 5,
        channelSettings: 2,
        aliases: 1,
      },
    });
    mockPrisma.pendingMemory.count.mockResolvedValue(3);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'delete', '/:slug');
    const { req, res } = createMockReqRes({}, { slug: 'my-char' });

    await handler(req, res);

    expect(mockPrisma.pendingMemory.deleteMany).toHaveBeenCalledWith({
      where: { personalityId: 'personality-owned' },
    });
    expect(mockPrisma.personality.delete).toHaveBeenCalledWith({
      where: { id: 'personality-owned' },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should return correct deletion counts', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: 'personality-counts',
      name: 'Count Test',
      ownerId: 'user-uuid-123',
      _count: {
        conversationHistory: 50,
        memories: 25,
        channelSettings: 3,
        aliases: 2,
      },
    });
    mockPrisma.pendingMemory.count.mockResolvedValue(10);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'delete', '/:slug');
    const { req, res } = createMockReqRes({}, { slug: 'count-test' });

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        deletedSlug: 'count-test',
        deletedName: 'Count Test',
        deletedCounts: {
          conversationHistory: 50,
          memories: 25,
          pendingMemories: 10,
          channelSettings: 3,
          aliases: 2,
        },
      })
    );
  });

  it('should validate response against Zod schema (contract validation)', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: 'personality-schema',
      name: 'Schema Test',
      ownerId: 'user-uuid-123',
      _count: {
        conversationHistory: 5,
        memories: 3,
        channelSettings: 1,
        aliases: 0,
      },
    });
    mockPrisma.pendingMemory.count.mockResolvedValue(2);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'delete', '/:slug');
    const { req, res } = createMockReqRes({}, { slug: 'schema-test' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);

    // Extract the actual response and validate against schema
    const jsonCall = vi.mocked(res.json).mock.calls[0][0];
    const parseResult = DeletePersonalityResponseSchema.safeParse(jsonCall);
    expect(parseResult.success).toBe(true);
  });

  it('should skip PendingMemory deletion when count is 0', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: 'personality-no-pending',
      name: 'No Pending',
      ownerId: 'user-uuid-123',
      _count: {
        conversationHistory: 5,
        memories: 3,
        channelSettings: 0,
        aliases: 0,
      },
    });
    mockPrisma.pendingMemory.count.mockResolvedValue(0);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'delete', '/:slug');
    const { req, res } = createMockReqRes({}, { slug: 'no-pending' });

    await handler(req, res);

    // Should NOT call deleteMany when count is 0
    expect(mockPrisma.pendingMemory.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.personality.delete).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should allow bot owner to delete any personality', async () => {
    // Set up as bot owner
    mockIsBotOwner.mockReturnValue(true);

    // Personality owned by someone else
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: 'personality-other-user',
      name: 'Other User Character',
      ownerId: 'other-user-uuid',
      _count: {
        conversationHistory: 10,
        memories: 5,
        channelSettings: 0,
        aliases: 0,
      },
    });
    mockPrisma.pendingMemory.count.mockResolvedValue(0);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'delete', '/:slug');
    const { req, res } = createMockReqRes({}, { slug: 'other-user-char' });

    await handler(req, res);

    expect(mockIsBotOwner).toHaveBeenCalled();
    expect(mockPrisma.personality.delete).toHaveBeenCalledWith({
      where: { id: 'personality-other-user' },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should allow co-owner (PersonalityOwner table) to delete personality', async () => {
    // Personality owned by different user
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: 'personality-coowned',
      name: 'Co-owned Character',
      ownerId: 'other-user-uuid',
      _count: {
        conversationHistory: 0,
        memories: 0,
        channelSettings: 0,
        aliases: 0,
      },
    });
    // User has co-ownership entry in PersonalityOwner table
    mockPrisma.personalityOwner.findUnique.mockResolvedValue({
      userId: 'user-uuid-123',
      personalityId: 'personality-coowned',
    });
    mockPrisma.pendingMemory.count.mockResolvedValue(0);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'delete', '/:slug');
    const { req, res } = createMockReqRes({}, { slug: 'coowned-char' });

    await handler(req, res);

    expect(mockPrisma.personality.delete).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  describe('avatar cache deletion', () => {
    beforeEach(() => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'personality-avatar-delete',
        name: 'Avatar Test',
        ownerId: 'user-uuid-123',
        _count: {
          conversationHistory: 0,
          memories: 0,
          channelSettings: 0,
          aliases: 0,
        },
      });
      mockPrisma.pendingMemory.count.mockResolvedValue(0);
    });

    it('should delete cached avatar file with valid slug', async () => {
      mockUnlink.mockResolvedValue(undefined);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: 'valid-slug' });

      await handler(req, res);

      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/valid-slug.png');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should silently handle ENOENT when avatar cache file does not exist', async () => {
      const enoentError = new Error('File not found') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      mockUnlink.mockRejectedValue(enoentError);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: 'valid-slug' });

      await handler(req, res);

      // Should not fail - ENOENT is expected when file doesn't exist
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should silently handle ENOTDIR when avatar path issue', async () => {
      const enotdirError = new Error('Not a directory') as NodeJS.ErrnoException;
      enotdirError.code = 'ENOTDIR';
      mockUnlink.mockRejectedValue(enotdirError);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: 'valid-slug' });

      await handler(req, res);

      // Should not fail - ENOTDIR is expected when data volume not mounted
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should skip avatar deletion for invalid slug format (path traversal protection)', async () => {
      // This tests the CWE-22 path traversal protection
      // Invalid slugs should not trigger unlink at all
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: '../../../etc/passwd' });

      await handler(req, res);

      // unlink should NOT be called for invalid slug
      expect(mockUnlink).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should skip avatar deletion for slug with spaces', async () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: 'invalid slug' });

      await handler(req, res);

      // unlink should NOT be called for slug with spaces
      expect(mockUnlink).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('cache invalidation', () => {
    beforeEach(() => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'personality-cache-test',
        name: 'Cache Test',
        ownerId: 'user-uuid-123',
        _count: {
          conversationHistory: 0,
          memories: 0,
          channelSettings: 0,
          aliases: 0,
        },
      });
      mockPrisma.pendingMemory.count.mockResolvedValue(0);
      mockUnlink.mockResolvedValue(undefined);
    });

    it('should call cache invalidation service when provided', async () => {
      const mockCacheInvalidationService = {
        invalidatePersonality: vi.fn().mockResolvedValue(undefined),
      } as unknown as import('@tzurot/common-types').CacheInvalidationService;

      const router = createPersonalityRoutes(
        mockPrisma as unknown as PrismaClient,
        mockCacheInvalidationService
      );
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: 'cache-test' });

      await handler(req, res);

      expect(mockCacheInvalidationService.invalidatePersonality).toHaveBeenCalledWith(
        'personality-cache-test'
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should not fail when cache invalidation throws error', async () => {
      const mockCacheInvalidationService = {
        invalidatePersonality: vi.fn().mockRejectedValue(new Error('Redis connection failed')),
      } as unknown as import('@tzurot/common-types').CacheInvalidationService;

      const router = createPersonalityRoutes(
        mockPrisma as unknown as PrismaClient,
        mockCacheInvalidationService
      );
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: 'cache-test' });

      await handler(req, res);

      // Should still succeed - cache invalidation failure is non-fatal
      expect(mockCacheInvalidationService.invalidatePersonality).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should succeed without cache invalidation service', async () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: 'no-cache-service' });

      await handler(req, res);

      // Should succeed without cache service
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
