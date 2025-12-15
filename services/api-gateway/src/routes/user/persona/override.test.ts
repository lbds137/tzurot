/**
 * Tests for persona override routes
 * - GET /override - List persona overrides
 * - GET /override/:personalitySlug - Get personality info for override
 * - PUT /override/:personalitySlug - Set persona override
 * - DELETE /override/:personalitySlug - Clear persona override
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';
import {
  createMockPrisma,
  createMockReqRes,
  getHandler,
  mockUser,
  MOCK_USER_ID,
  MOCK_PERSONA_ID,
  MOCK_PERSONA_ID_2,
  MOCK_PERSONALITY_ID,
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

describe('persona override routes', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);
  });

  describe('GET /user/persona/override', () => {
    it('should return list of persona overrides', async () => {
      mockPrisma.userPersonalityConfig.findMany.mockResolvedValue([
        {
          personalityId: MOCK_PERSONALITY_ID,
          personaId: MOCK_PERSONA_ID,
          personality: { slug: 'test-char', name: 'Test', displayName: 'Test Character' },
          persona: { name: 'My Persona' },
        },
      ]);

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/override');

      const { req, res } = createMockReqRes();
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        overrides: [
          {
            personalityId: MOCK_PERSONALITY_ID,
            personalitySlug: 'test-char',
            personalityName: 'Test Character',
            personaId: MOCK_PERSONA_ID,
            personaName: 'My Persona',
          },
        ],
      });
    });

    it('should return empty array when no overrides exist', async () => {
      mockPrisma.userPersonalityConfig.findMany.mockResolvedValue([]);

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/override');

      const { req, res } = createMockReqRes();
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({ overrides: [] });
    });
  });

  describe('GET /user/persona/override/:personalitySlug', () => {
    it('should return personality info for override modal', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: MOCK_PERSONALITY_ID,
        name: 'Lilith',
        displayName: 'Lilith the Succubus',
      });

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/override/:personalitySlug');

      const { req, res } = createMockReqRes({}, { personalitySlug: 'lilith' });
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        personality: {
          id: MOCK_PERSONALITY_ID,
          name: 'Lilith',
          displayName: 'Lilith the Succubus',
        },
      });
    });

    it('should return 404 for non-existent personality', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/override/:personalitySlug');

      const { req, res } = createMockReqRes({}, { personalitySlug: 'nonexistent' });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('PUT /user/persona/override/:personalitySlug', () => {
    it('should set persona override for personality', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue({
        id: MOCK_PERSONA_ID_2,
        name: 'Work Persona',
        preferredName: 'Worker',
      });
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: MOCK_PERSONALITY_ID,
        name: 'Lilith',
        displayName: 'Lilith the Succubus',
      });
      mockPrisma.userPersonalityConfig.upsert.mockResolvedValue({});

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/override/:personalitySlug');

      const { req, res } = createMockReqRes(
        { personaId: MOCK_PERSONA_ID_2 },
        { personalitySlug: 'lilith' }
      );
      await handler(req, res);

      expect(mockPrisma.userPersonalityConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            // Verify deterministic UUID is generated (v5 format check)
            id: expect.stringMatching(
              /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            ),
            userId: MOCK_USER_ID,
            personalityId: MOCK_PERSONALITY_ID,
            personaId: MOCK_PERSONA_ID_2,
          }),
        })
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        personality: {
          id: MOCK_PERSONALITY_ID,
          name: 'Lilith',
          displayName: 'Lilith the Succubus',
        },
        persona: {
          id: MOCK_PERSONA_ID_2,
          name: 'Work Persona',
          preferredName: 'Worker',
        },
      });
    });

    it('should return 404 for non-existent persona', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue(null);

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/override/:personalitySlug');

      const { req, res } = createMockReqRes(
        { personaId: NONEXISTENT_UUID },
        { personalitySlug: 'lilith' }
      );
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 for non-existent personality', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue({ id: MOCK_PERSONA_ID, name: 'Test' });
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/override/:personalitySlug');

      const { req, res } = createMockReqRes(
        { personaId: MOCK_PERSONA_ID },
        { personalitySlug: 'nonexistent' }
      );
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should reject missing personaId', async () => {
      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/override/:personalitySlug');

      const { req, res } = createMockReqRes({}, { personalitySlug: 'lilith' });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('DELETE /user/persona/override/:personalitySlug', () => {
    it('should clear persona override and delete config if no llmConfigId', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: MOCK_PERSONALITY_ID,
        name: 'Lilith',
        displayName: 'Lilith the Succubus',
      });
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue({
        id: 'config-1',
        llmConfigId: null,
      });
      mockPrisma.userPersonalityConfig.delete.mockResolvedValue({});

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/override/:personalitySlug');

      const { req, res } = createMockReqRes({}, { personalitySlug: 'lilith' });
      await handler(req, res);

      expect(mockPrisma.userPersonalityConfig.delete).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          personality: {
            id: MOCK_PERSONALITY_ID,
            name: 'Lilith',
            displayName: 'Lilith the Succubus',
          },
          hadOverride: true,
        })
      );
    });

    it('should only clear personaId if config has llmConfigId', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: MOCK_PERSONALITY_ID,
        name: 'Lilith',
        displayName: null,
      });
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue({
        id: 'config-1',
        llmConfigId: 'some-llm-config',
      });
      mockPrisma.userPersonalityConfig.update.mockResolvedValue({});

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/override/:personalitySlug');

      const { req, res } = createMockReqRes({}, { personalitySlug: 'lilith' });
      await handler(req, res);

      expect(mockPrisma.userPersonalityConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'config-1' },
          data: { personaId: null },
        })
      );
      expect(mockPrisma.userPersonalityConfig.delete).not.toHaveBeenCalled();
    });

    it('should return 404 for non-existent personality', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/override/:personalitySlug');

      const { req, res } = createMockReqRes({}, { personalitySlug: 'nonexistent' });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should succeed even if no override exists', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: MOCK_PERSONALITY_ID,
        name: 'Lilith',
        displayName: 'Lilith',
      });
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue(null);

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/override/:personalitySlug');

      const { req, res } = createMockReqRes({}, { personalitySlug: 'lilith' });
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          personality: {
            id: MOCK_PERSONALITY_ID,
            name: 'Lilith',
            displayName: 'Lilith',
          },
          hadOverride: false,
        })
      );
    });
  });
});
