/**
 * Tests for PATCH /user/personality/:slug/visibility (toggle visibility)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';
import {
  createMockPrisma,
  createMockReqRes,
  getHandler,
  setupStandardMocks,
} from './test-utils.js';

// Mock dependencies before imports
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

vi.mock('../../../services/AuthMiddleware.js', () => ({
  requireUserAuth: vi.fn(() => vi.fn((_req: unknown, _res: unknown, next: () => void) => next())),
}));

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

import { createPersonalityRoutes } from './index.js';

describe('PATCH /user/personality/:slug/visibility', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
  });

  it('should reject missing isPublic', async () => {
    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/:slug/visibility');
    const { req, res } = createMockReqRes({}, { slug: 'test-char' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 403 when user not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/:slug/visibility');
    const { req, res } = createMockReqRes({ isPublic: true }, { slug: 'test-char' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should return 404 when personality not found', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue(null);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/:slug/visibility');
    const { req, res } = createMockReqRes({ isPublic: true }, { slug: 'nonexistent' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 403 when user does not own personality', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: 'personality-9',
      ownerId: 'other-user',
      isPublic: false,
    });

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/:slug/visibility');
    const { req, res } = createMockReqRes({ isPublic: true }, { slug: 'not-mine' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should toggle visibility to public', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: 'personality-10',
      ownerId: 'user-uuid-123',
      isPublic: false,
    });
    mockPrisma.personality.update.mockResolvedValue({
      id: 'personality-10',
      slug: 'my-char',
      isPublic: true,
    });

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/:slug/visibility');
    const { req, res } = createMockReqRes({ isPublic: true }, { slug: 'my-char' });

    await handler(req, res);

    expect(mockPrisma.personality.update).toHaveBeenCalledWith({
      where: { id: 'personality-10' },
      data: { isPublic: true },
      select: { id: true, slug: true, isPublic: true },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        personality: expect.objectContaining({
          isPublic: true,
        }),
      })
    );
  });

  it('should toggle visibility to private', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: 'personality-11',
      ownerId: 'user-uuid-123',
      isPublic: true,
    });
    mockPrisma.personality.update.mockResolvedValue({
      id: 'personality-11',
      slug: 'my-char',
      isPublic: false,
    });

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/:slug/visibility');
    const { req, res } = createMockReqRes({ isPublic: false }, { slug: 'my-char' });

    await handler(req, res);

    expect(mockPrisma.personality.update).toHaveBeenCalledWith({
      where: { id: 'personality-11' },
      data: { isPublic: false },
      select: expect.any(Object),
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        personality: expect.objectContaining({
          isPublic: false,
        }),
      })
    );
  });
});
