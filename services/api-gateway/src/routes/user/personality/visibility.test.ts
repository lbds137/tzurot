/**
 * Tests for PATCH /user/personality/:slug/visibility (toggle visibility)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetPersonalityResponseSchema } from '@tzurot/common-types/schemas/api/personality';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  createMockPersonality,
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

describe('PATCH /user/personality/:slug/visibility', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
  });

  it('should reject missing isPublic', async () => {
    const router = createPersonalityRoutes({
      ...stubRouteResolvers(),
      prisma: mockPrisma as unknown as PrismaClient,
    });
    const handler = getHandler(router, 'patch', '/:slug/visibility');
    const { req, res } = createMockReqRes({}, { slug: 'test-char' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 404 when personality not found', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue(null);

    const router = createPersonalityRoutes({
      ...stubRouteResolvers(),
      prisma: mockPrisma as unknown as PrismaClient,
    });
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

    const router = createPersonalityRoutes({
      ...stubRouteResolvers(),
      prisma: mockPrisma as unknown as PrismaClient,
    });
    const handler = getHandler(router, 'patch', '/:slug/visibility');
    const { req, res } = createMockReqRes({ isPublic: true }, { slug: 'not-mine' });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should toggle visibility to public', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: '7e570000-0000-4000-8000-000000000010',
      ownerId: MOCK_USER_ID,
      isPublic: false,
    });
    mockPrisma.personality.update.mockResolvedValue(
      createMockPersonality({
        id: '7e570000-0000-4000-8000-000000000010',
        slug: 'my-char',
        isPublic: true,
      })
    );

    const router = createPersonalityRoutes({
      ...stubRouteResolvers(),
      prisma: mockPrisma as unknown as PrismaClient,
    });
    const handler = getHandler(router, 'patch', '/:slug/visibility');
    const { req, res } = createMockReqRes({ isPublic: true }, { slug: 'my-char' });

    await handler(req, res);

    expect(mockPrisma.personality.update).toHaveBeenCalledWith({
      where: { id: '7e570000-0000-4000-8000-000000000010' },
      data: { isPublic: true },
      // Full detail select: the response carries the complete personality
      // per GetPersonalityResponseSchema.
      select: expect.objectContaining({ id: true, slug: true, isPublic: true, name: true }),
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        canEdit: true,
        personality: expect.objectContaining({
          isPublic: true,
        }),
      })
    );
    // Pin the full declared contract, not just the fields asserted above.
    const sentBody = vi.mocked(res.json).mock.calls[0][0];
    expect(GetPersonalityResponseSchema.safeParse(sentBody).success).toBe(true);
  });

  it('should toggle visibility to private', async () => {
    mockPrisma.personality.findUnique.mockResolvedValue({
      id: '7e570000-0000-4000-8000-000000000011',
      ownerId: MOCK_USER_ID,
      isPublic: true,
    });
    mockPrisma.personality.update.mockResolvedValue(
      createMockPersonality({
        id: '7e570000-0000-4000-8000-000000000011',
        slug: 'my-char',
        isPublic: false,
      })
    );

    const router = createPersonalityRoutes({
      ...stubRouteResolvers(),
      prisma: mockPrisma as unknown as PrismaClient,
    });
    const handler = getHandler(router, 'patch', '/:slug/visibility');
    const { req, res } = createMockReqRes({ isPublic: false }, { slug: 'my-char' });

    await handler(req, res);

    expect(mockPrisma.personality.update).toHaveBeenCalledWith({
      where: { id: '7e570000-0000-4000-8000-000000000011' },
      data: { isPublic: false },
      select: expect.objectContaining({
        id: true,
        slug: true,
        isPublic: true,
      }),
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        personality: expect.objectContaining({
          isPublic: false,
        }),
      })
    );
    // Pin the full declared contract, not just the fields asserted above.
    const sentBody = vi.mocked(res.json).mock.calls[0][0];
    expect(GetPersonalityResponseSchema.safeParse(sentBody).success).toBe(true);
  });
});
