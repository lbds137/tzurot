/**
 * Tests for GET /user/personality/:slug (get single personality)
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

describe('GET /user/personality/:slug', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
  });

  it('should return 404 when personality not found', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue(null);

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/:slug');
    const { req, res } = createMockReqRes({}, { slug: 'nonexistent' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 403 for private personality user cannot access', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: 'personality-3',
      name: 'Private',
      slug: 'private-char',
      isPublic: false,
      ownerId: 'other-user',
      avatarData: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/:slug');
    const { req, res } = createMockReqRes({}, { slug: 'private-char' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should return public personality', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: 'personality-4',
      name: 'Public Character',
      displayName: 'Pubby',
      slug: 'public-char',
      characterInfo: 'A public character',
      personalityTraits: 'Friendly',
      personalityTone: null,
      personalityAge: null,
      personalityAppearance: null,
      personalityLikes: null,
      personalityDislikes: null,
      conversationalGoals: null,
      conversationalExamples: null,
      errorMessage: null,
      birthMonth: null,
      birthDay: null,
      birthYear: null,
      isPublic: true,
      voiceEnabled: false,
      imageEnabled: false,
      ownerId: 'other-user',
      avatarData: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
    });

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/:slug');
    const { req, res } = createMockReqRes({}, { slug: 'public-char' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        personality: expect.objectContaining({
          id: 'personality-4',
          name: 'Public Character',
          slug: 'public-char',
          hasAvatar: false,
        }),
        canEdit: false,
      })
    );
  });

  it('should return owned personality with canEdit=true', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: 'personality-5',
      name: 'My Character',
      displayName: null,
      slug: 'my-char',
      characterInfo: 'My character info',
      personalityTraits: 'Cool',
      personalityTone: null,
      personalityAge: null,
      personalityAppearance: null,
      personalityLikes: null,
      personalityDislikes: null,
      conversationalGoals: null,
      conversationalExamples: null,
      errorMessage: null,
      birthMonth: null,
      birthDay: null,
      birthYear: null,
      isPublic: false,
      voiceEnabled: false,
      imageEnabled: false,
      ownerId: 'user-uuid-123',
      avatarData: Buffer.from('test'),
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
    });

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'get', '/:slug');
    const { req, res } = createMockReqRes({}, { slug: 'my-char' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        personality: expect.objectContaining({
          id: 'personality-5',
          hasAvatar: true,
        }),
        canEdit: true,
      })
    );
  });
});
