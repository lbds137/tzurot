/**
 * Tests for persona default route
 * - PATCH /:id/default - Set default persona
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';
import {
  createMockPrisma,
  createMockReqRes,
  getHandler,
  mockUser,
  MOCK_USER_ID,
  MOCK_PERSONA_ID_2,
  NONEXISTENT_UUID,
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

import { createPersonaRoutes } from './index.js';

describe('PATCH /user/persona/:id/default', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);
  });

  it('should set persona as default', async () => {
    mockPrisma.persona.findFirst.mockResolvedValue({
      id: MOCK_PERSONA_ID_2,
      name: 'Second',
      preferredName: 'Tester',
    });
    mockPrisma.user.update.mockResolvedValue({});

    const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/:id/default');

    const { req, res } = createMockReqRes({}, { id: MOCK_PERSONA_ID_2 });
    await handler(req, res);

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MOCK_USER_ID },
        data: { defaultPersonaId: MOCK_PERSONA_ID_2 },
      })
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      persona: {
        id: MOCK_PERSONA_ID_2,
        name: 'Second',
        preferredName: 'Tester',
      },
      alreadyDefault: false,
    });
  });

  it('should return 404 for non-existent persona', async () => {
    mockPrisma.persona.findFirst.mockResolvedValue(null);

    const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/:id/default');

    const { req, res } = createMockReqRes({}, { id: NONEXISTENT_UUID });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
