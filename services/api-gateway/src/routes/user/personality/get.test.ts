/**
 * Tests for GET /user/personality/:slug (get single personality)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  createMockPrisma,
  createMockReqRes,
  getHandler,
  setupStandardMocks,
  MOCK_USER_ID,
} from './test-utils.js';

// Mock dependencies before imports
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

// Uses the shared mock at `src/services/__mocks__/AuthMiddleware.ts`
// (auto-discovered by vitest). Passes `getOrCreateUserService` through to
// the real implementation and stubs `requireUserAuth` / `requireProvisionedUser`
// as passthrough middleware.
vi.mock('../../../services/AuthMiddleware.js');

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

import { createPersonalityRoutes } from './index.js';
import { stubRouteResolvers } from '../../../test/shared-route-test-utils.js';

describe('GET /user/personality/:slug', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
  });

  it('should return 404 when personality not found', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue(null);

    const router = createPersonalityRoutes({
      ...stubRouteResolvers(),
      prisma: mockPrisma as unknown as PrismaClient,
    });
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
      voiceReferenceType: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const router = createPersonalityRoutes({
      ...stubRouteResolvers(),
      prisma: mockPrisma as unknown as PrismaClient,
    });
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
      definitionPublic: false,
      voiceEnabled: false,
      imageEnabled: false,
      ownerId: 'other-user',
      avatarData: null,
      voiceReferenceType: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
    });

    const router = createPersonalityRoutes({
      ...stubRouteResolvers(),
      prisma: mockPrisma as unknown as PrismaClient,
    });
    const handler = getHandler(router, 'get', '/:slug');
    const { req, res } = createMockReqRes({}, { slug: 'public-char' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Non-owner of a definition-private public character: metadata visible,
    // card redacted to null, definitionRedacted true.
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        personality: expect.objectContaining({
          id: 'personality-4',
          name: 'Public Character',
          slug: 'public-char',
          hasAvatar: false,
          characterInfo: null,
          personalityTraits: null,
          definitionRedacted: true,
        }),
        canEdit: false,
      })
    );
  });

  it('does NOT redact a definition-public character for a non-owner', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: 'personality-4b',
      name: 'Open Character',
      displayName: 'Openy',
      slug: 'open-char',
      characterInfo: 'Visible to all',
      personalityTraits: 'Transparent',
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
      definitionPublic: true,
      voiceEnabled: false,
      imageEnabled: false,
      ownerId: 'other-user',
      avatarData: null,
      voiceReferenceType: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
    });

    const router = createPersonalityRoutes({
      ...stubRouteResolvers(),
      prisma: mockPrisma as unknown as PrismaClient,
    });
    const handler = getHandler(router, 'get', '/:slug');
    const { req, res } = createMockReqRes({}, { slug: 'open-char' });

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        personality: expect.objectContaining({
          characterInfo: 'Visible to all',
          personalityTraits: 'Transparent',
          definitionRedacted: false,
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
      definitionPublic: false,
      voiceEnabled: false,
      imageEnabled: false,
      ownerId: MOCK_USER_ID,
      avatarData: Buffer.from('test'),
      voiceReferenceType: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
    });

    const router = createPersonalityRoutes({
      ...stubRouteResolvers(),
      prisma: mockPrisma as unknown as PrismaClient,
    });
    const handler = getHandler(router, 'get', '/:slug');
    const { req, res } = createMockReqRes({}, { slug: 'my-char' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Owner (canEdit) always sees the full card even when definitionPublic=false.
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        personality: expect.objectContaining({
          id: 'personality-5',
          hasAvatar: true,
          characterInfo: 'My character info',
          definitionRedacted: false,
        }),
        canEdit: true,
      })
    );
  });
});
