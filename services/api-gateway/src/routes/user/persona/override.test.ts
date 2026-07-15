/**
 * Tests for persona override routes
 * - GET /override - List persona overrides
 * - GET /override/:personalitySlug - Get personality info for override
 * - PUT /override/:personalitySlug - Set persona override
 * - DELETE /override/:personalitySlug - Clear persona override
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';
import { stubRouteResolvers } from '../../../test/shared-route-test-utils.js';
import {
  createMockPrisma,
  createMockReqRes,
  mockUser,
  MOCK_USER_ID,
  MOCK_PERSONA_ID,
  MOCK_PERSONA_ID_2,
  MOCK_PERSONALITY_ID,
  NONEXISTENT_UUID,
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

import {
  handleListPersonaOverrides,
  handleGetPersonaOverride,
  handleSetPersonaOverride,
  handleClearPersonaOverride,
  handleCreatePersonaOverride,
} from './override.js';

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

      const handler = handleListPersonaOverrides({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes();
      await handler(req, res, vi.fn());

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

      const handler = handleListPersonaOverrides({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes();
      await handler(req, res, vi.fn());

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

      const handler = handleGetPersonaOverride({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({}, { personalitySlug: 'lilith' });
      await handler(req, res, vi.fn());

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

      const handler = handleGetPersonaOverride({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({}, { personalitySlug: 'nonexistent' });
      await handler(req, res, vi.fn());

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

      const handler = handleSetPersonaOverride({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes(
        { personaId: MOCK_PERSONA_ID_2 },
        { personalitySlug: 'lilith' }
      );
      await handler(req, res, vi.fn());

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

      const handler = handleSetPersonaOverride({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes(
        { personaId: NONEXISTENT_UUID },
        { personalitySlug: 'lilith' }
      );
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 404 for non-existent personality', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue({ id: MOCK_PERSONA_ID, name: 'Test' });
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const handler = handleSetPersonaOverride({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes(
        { personaId: MOCK_PERSONA_ID },
        { personalitySlug: 'nonexistent' }
      );
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should reject missing personaId', async () => {
      const handler = handleSetPersonaOverride({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({}, { personalitySlug: 'lilith' });
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('DELETE /user/persona/override/:personalitySlug', () => {
    it('clears the persona slice and prunes the row when no other slice remains', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: MOCK_PERSONALITY_ID,
        name: 'Lilith',
        displayName: 'Lilith the Succubus',
      });
      // Route reads the row (id), then the prune re-reads the full slice set —
      // both hit this mock; an all-null slice set means the prune deletes.
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue({
        id: 'config-1',
        personaId: null,
        llmConfigId: null,
        visionConfigId: null,
        ttsConfigId: null,
        configOverrides: null,
      });
      mockPrisma.userPersonalityConfig.update.mockResolvedValue({});
      mockPrisma.userPersonalityConfig.delete.mockResolvedValue({});

      const handler = handleClearPersonaOverride({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({}, { personalitySlug: 'lilith' });
      await handler(req, res, vi.fn());

      expect(mockPrisma.userPersonalityConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { personaId: null } })
      );
      expect(mockPrisma.userPersonalityConfig.delete).toHaveBeenCalledWith({
        where: { id: 'config-1' },
      });
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

    it('clears the persona slice but keeps the row when another slice is set', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: MOCK_PERSONALITY_ID,
        name: 'Lilith',
        displayName: null,
      });
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue({
        id: 'config-1',
        personaId: null,
        llmConfigId: 'some-llm-config',
        visionConfigId: null,
        ttsConfigId: null,
        configOverrides: null,
      });
      mockPrisma.userPersonalityConfig.update.mockResolvedValue({});

      const handler = handleClearPersonaOverride({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({}, { personalitySlug: 'lilith' });
      await handler(req, res, vi.fn());

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

      const handler = handleClearPersonaOverride({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({}, { personalitySlug: 'nonexistent' });
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should succeed even if no override exists', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: MOCK_PERSONALITY_ID,
        name: 'Lilith',
        displayName: 'Lilith',
      });
      mockPrisma.userPersonalityConfig.findUnique.mockResolvedValue(null);

      const handler = handleClearPersonaOverride({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({}, { personalitySlug: 'lilith' });
      await handler(req, res, vi.fn());

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

  describe('POST /user/persona/override/by-id/:personalityId', () => {
    const validBody = {
      name: 'Override Persona',
      content: 'Persona content for testing.',
      preferredName: 'Pref',
      description: 'A test description',
      pronouns: 'they/them',
    };

    it('should create a persona AND set it as override in a single transaction', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: MOCK_PERSONALITY_ID,
        name: 'Lilith',
        displayName: 'Lilith the Succubus',
      });
      mockPrisma.persona.create.mockResolvedValue({
        id: MOCK_PERSONA_ID_2,
        name: 'Override Persona',
        preferredName: 'Pref',
        description: 'A test description',
        content: 'Persona content for testing.',
        pronouns: 'they/them',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });
      mockPrisma.userPersonalityConfig.upsert.mockResolvedValue({});

      const handler = handleCreatePersonaOverride({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes(validBody, { personalityId: MOCK_PERSONALITY_ID });
      await handler(req, res, vi.fn());

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.persona.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Override Persona',
            content: 'Persona content for testing.',
            preferredName: 'Pref',
            description: 'A test description',
            pronouns: 'they/them',
            ownerId: MOCK_USER_ID,
          }),
        })
      );
      expect(mockPrisma.userPersonalityConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_personalityId: { userId: MOCK_USER_ID, personalityId: MOCK_PERSONALITY_ID },
          },
          create: expect.objectContaining({
            userId: MOCK_USER_ID,
            personalityId: MOCK_PERSONALITY_ID,
            personaId: MOCK_PERSONA_ID_2,
          }),
          update: { personaId: MOCK_PERSONA_ID_2 },
        })
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          persona: expect.objectContaining({ id: MOCK_PERSONA_ID_2, name: 'Override Persona' }),
          personality: { name: 'Lilith', displayName: 'Lilith the Succubus' },
        })
      );
    });

    it('should return NAME_COLLISION when the override persona name is already taken', async () => {
      // P2002 from the persona insert propagates out of $transaction (which
      // rolls back), and the handler translates it to a NAME_COLLISION.
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: MOCK_PERSONALITY_ID,
        name: 'Lilith',
        displayName: 'Lilith the Succubus',
      });
      mockPrisma.persona.create.mockRejectedValue({ code: 'P2002' });

      const handler = handleCreatePersonaOverride({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes(validBody, { personalityId: MOCK_PERSONALITY_ID });
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: API_ERROR_SUBCODE.NAME_COLLISION })
      );
    });

    it('should return 400 for invalid personalityId (not a UUID)', async () => {
      const handler = handleCreatePersonaOverride({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes(validBody, { personalityId: 'not-a-uuid' });
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid body (missing required field)', async () => {
      const handler = handleCreatePersonaOverride({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes(
        { name: 'No content' },
        { personalityId: MOCK_PERSONALITY_ID }
      );
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should return 404 when personality does not exist', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const handler = handleCreatePersonaOverride({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes(validBody, { personalityId: NONEXISTENT_UUID });
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should roll back the persona create when the upsert throws (atomicity)', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: MOCK_PERSONALITY_ID,
        name: 'Lilith',
        displayName: null,
      });
      mockPrisma.persona.create.mockResolvedValue({
        id: MOCK_PERSONA_ID_2,
        name: 'Will be rolled back',
        preferredName: null,
        description: null,
        content: 'x',
        pronouns: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      // Simulate upsert failure inside the transaction. The mock's pass-through
      // $transaction propagates the throw, and because `asyncHandler` is
      // mocked to identity at the top of this file (`vi.fn(fn => fn)`), errors
      // thrown inside the callback escape rather than being caught and
      // converted to 500s. That's what the `rejects.toThrow` assertion catches.
      // In production, asyncHandler would convert this to a 500, but for the
      // unit test the identity mock gives a tighter signal: confirms the
      // transaction wrapping propagates the error AND that no success
      // response is sent before the failure point.
      mockPrisma.userPersonalityConfig.upsert.mockRejectedValue(new Error('write conflict'));

      const handler = handleCreatePersonaOverride({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes(validBody, { personalityId: MOCK_PERSONALITY_ID });
      await expect(handler(req, res, vi.fn())).rejects.toThrow('write conflict');
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
