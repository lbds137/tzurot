/**
 * Tests for GET /user/personality (list all personalities)
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

describe('GET /user/personality (list)', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
  });

  it('should return public personalities', async () => {
    const publicPersonality = {
      id: 'personality-1',
      name: 'Public Character',
      displayName: 'Public',
      slug: 'public-character',
      ownerId: 'other-user',
      isPublic: true,
    };
    mockPrisma.personality.findMany
      .mockResolvedValueOnce([publicPersonality])
      .mockResolvedValueOnce([]);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/');
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        personalities: [
          expect.objectContaining({
            id: 'personality-1',
            slug: 'public-character',
            isOwned: false,
            isPublic: true,
          }),
        ],
      })
    );
  });

  it('should return owned personalities with isOwned=true', async () => {
    const ownedPersonality = {
      id: 'personality-2',
      name: 'My Character',
      displayName: 'Mine',
      slug: 'my-character',
      ownerId: 'user-uuid-123',
      isPublic: false,
    };
    mockPrisma.personality.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([ownedPersonality]);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/');
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        personalities: [
          expect.objectContaining({
            id: 'personality-2',
            slug: 'my-character',
            isOwned: true,
            isPublic: false,
          }),
        ],
      })
    );
  });

  it('should handle user not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.personality.findMany.mockResolvedValue([]);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/');
    const { req, res } = createMockReqRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        personalities: [],
      })
    );
  });
});
