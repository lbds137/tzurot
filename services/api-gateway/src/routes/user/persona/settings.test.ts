/**
 * Tests for persona settings route
 * - PATCH /settings - Update persona settings (share-ltm)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';
import {
  createMockPrisma,
  createMockReqRes,
  getHandler,
  mockUser,
  MOCK_PERSONA_ID,
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

describe('PATCH /user/persona/settings', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);
  });

  it('should update share-ltm setting to true', async () => {
    mockPrisma.persona.findUnique.mockResolvedValue({ shareLtmAcrossPersonalities: false });
    mockPrisma.persona.update.mockResolvedValue({});

    const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/settings');

    const { req, res } = createMockReqRes({ shareLtmAcrossPersonalities: true });
    await handler(req, res);

    expect(mockPrisma.persona.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MOCK_PERSONA_ID },
        data: { shareLtmAcrossPersonalities: true },
      })
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      unchanged: false,
    });
  });

  it('should update share-ltm setting to false', async () => {
    mockPrisma.persona.findUnique.mockResolvedValue({ shareLtmAcrossPersonalities: true });
    mockPrisma.persona.update.mockResolvedValue({});

    const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/settings');

    const { req, res } = createMockReqRes({ shareLtmAcrossPersonalities: false });
    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      unchanged: false,
    });
  });

  it('should return unchanged: true when setting is already the same', async () => {
    mockPrisma.persona.findUnique.mockResolvedValue({ shareLtmAcrossPersonalities: true });

    const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/settings');

    const { req, res } = createMockReqRes({ shareLtmAcrossPersonalities: true });
    await handler(req, res);

    expect(mockPrisma.persona.update).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      unchanged: true,
    });
  });

  it('should reject non-boolean value', async () => {
    const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/settings');

    const { req, res } = createMockReqRes({ shareLtmAcrossPersonalities: 'yes' });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should reject when no default persona set', async () => {
    // UserService uses findUnique, not findFirst
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-uuid-123', defaultPersonaId: null });

    const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'patch', '/settings');

    const { req, res } = createMockReqRes({ shareLtmAcrossPersonalities: true });
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('default persona'),
      })
    );
  });
});
