/**
 * Tests for /user/persona routes
 *
 * Comprehensive tests for user persona CRUD operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

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

vi.mock('../../services/AuthMiddleware.js', () => ({
  requireUserAuth: vi.fn(() => vi.fn((_req: unknown, _res: unknown, next: () => void) => next())),
}));

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

// Mock Prisma
const mockPrisma = {
  user: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  persona: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  personality: {
    findUnique: vi.fn(),
  },
  userPersonalityConfig: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

import { createPersonaRoutes } from './persona.js';
import type { PrismaClient } from '@tzurot/common-types';

// Helper to create mock request/response
function createMockReqRes(body: Record<string, unknown> = {}, params: Record<string, string> = {}) {
  const req = {
    body,
    params,
    userId: 'discord-user-123',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

// Helper to get handler from router
function getHandler(
  router: ReturnType<typeof createPersonaRoutes>,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (router.stack as any[]).find(
    l => l.route?.path === path && l.route?.methods?.[method]
  );
  return (layer as { route: { stack: Array<{ handle: Function }> } }).route.stack[
    (layer as { route: { stack: Array<{ handle: Function }> } }).route.stack.length - 1
  ].handle;
}

describe('/user/persona routes', () => {
  // Valid UUIDs for testing (required by route validation)
  const MOCK_USER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const MOCK_PERSONA_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  const MOCK_PERSONA_ID_2 = 'f6a7b8c9-d0e1-2345-f012-456789012345'; // Second persona for testing
  const MOCK_PERSONALITY_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
  const NONEXISTENT_UUID = 'd4e5f6a7-b8c9-0123-def0-234567890123'; // Valid format but doesn't exist

  const mockUser = {
    id: MOCK_USER_ID,
    defaultPersonaId: MOCK_PERSONA_ID,
  };

  const mockPersona = {
    id: MOCK_PERSONA_ID,
    name: 'Test Persona',
    preferredName: 'Tester',
    description: 'A test persona',
    content: 'I am a test persona for unit tests.',
    pronouns: 'they/them',
    shareLtmAcrossPersonalities: false,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-02'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have GET / route registered', () => {
      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);

      const getRoute = (
        router.stack as unknown as Array<{ route?: { path?: string; methods?: { get?: boolean } } }>
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.get);
      expect(getRoute).toBeDefined();
    });

    it('should have POST / route registered', () => {
      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);

      const postRoute = (
        router.stack as unknown as Array<{
          route?: { path?: string; methods?: { post?: boolean } };
        }>
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.post);
      expect(postRoute).toBeDefined();
    });
  });

  describe('GET /user/persona', () => {
    it('should return empty array when user has no personas', async () => {
      mockPrisma.persona.findMany.mockResolvedValue([]);
      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');

      const { req, res } = createMockReqRes();
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({ personas: [] });
    });

    it('should return list of personas with isDefault flag', async () => {
      mockPrisma.persona.findMany.mockResolvedValue([mockPersona]);
      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');

      const { req, res } = createMockReqRes();
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        personas: [
          expect.objectContaining({
            id: MOCK_PERSONA_ID,
            name: 'Test Persona',
            isDefault: true,
          }),
        ],
      });
    });

    it('should create user if they do not exist', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'new-user', defaultPersonaId: null });
      mockPrisma.persona.findMany.mockResolvedValue([]);

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');

      const { req, res } = createMockReqRes();
      await handler(req, res);

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ discordId: 'discord-user-123' }),
        })
      );
    });
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

  describe('GET /user/persona/:id', () => {
    it('should return persona details', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue(mockPersona);
      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/:id');

      const { req, res } = createMockReqRes({}, { id: MOCK_PERSONA_ID });
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        persona: expect.objectContaining({
          id: MOCK_PERSONA_ID,
          name: 'Test Persona',
          content: 'I am a test persona for unit tests.',
          isDefault: true,
        }),
      });
    });

    it('should return 404 when persona not found', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue(null);
      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/:id');

      const { req, res } = createMockReqRes({}, { id: NONEXISTENT_UUID });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'NOT_FOUND',
        })
      );
    });
  });

  describe('POST /user/persona', () => {
    it('should create a new persona', async () => {
      mockPrisma.persona.create.mockResolvedValue({
        ...mockPersona,
        id: 'e5f6a7b8-c9d0-1234-ef01-345678901234', // New UUID for created persona
      });

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');

      const { req, res } = createMockReqRes({
        name: 'New Persona',
        content: 'New persona content',
        preferredName: 'Newbie',
      });
      await handler(req, res);

      expect(mockPrisma.persona.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'New Persona',
            content: 'New persona content',
            ownerId: MOCK_USER_ID,
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should reject empty name', async () => {
      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');

      const { req, res } = createMockReqRes({ name: '', content: 'Valid content' });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should reject empty content', async () => {
      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');

      const { req, res } = createMockReqRes({ name: 'Valid', content: '' });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject content exceeding max length', async () => {
      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');

      const { req, res } = createMockReqRes({
        name: 'Valid',
        content: 'x'.repeat(5000), // Exceeds 4000 char limit
      });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('4000'),
        })
      );
    });
  });

  describe('PUT /user/persona/:id', () => {
    it('should update persona', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue({ id: MOCK_PERSONA_ID });
      mockPrisma.persona.update.mockResolvedValue({
        ...mockPersona,
        name: 'Updated Name',
      });

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/:id');

      const { req, res } = createMockReqRes({ name: 'Updated Name' }, { id: MOCK_PERSONA_ID });
      await handler(req, res);

      expect(mockPrisma.persona.update).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        persona: expect.objectContaining({ name: 'Updated Name' }),
      });
    });

    it('should return 404 for non-existent persona', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue(null);

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/:id');

      const { req, res } = createMockReqRes({ name: 'Updated' }, { id: NONEXISTENT_UUID });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should reject empty name update', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue({ id: MOCK_PERSONA_ID });

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/:id');

      const { req, res } = createMockReqRes({ name: '' }, { id: MOCK_PERSONA_ID });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('DELETE /user/persona/:id', () => {
    it('should delete persona', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123', defaultPersonaId: null });
      mockPrisma.persona.findFirst.mockResolvedValue({ id: MOCK_PERSONA_ID });
      mockPrisma.persona.delete.mockResolvedValue({});

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:id');

      const { req, res } = createMockReqRes({}, { id: MOCK_PERSONA_ID });
      await handler(req, res);

      expect(mockPrisma.persona.delete).toHaveBeenCalledWith({ where: { id: MOCK_PERSONA_ID } });
      expect(res.json).toHaveBeenCalledWith({ message: 'Persona deleted' });
    });

    it('should prevent deleting default persona', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue({ id: MOCK_PERSONA_ID });

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:id');

      const { req, res } = createMockReqRes({}, { id: MOCK_PERSONA_ID }); // persona-1 is default
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('default'),
        })
      );
    });

    it('should return 404 for non-existent persona', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue(null);

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:id');

      const { req, res } = createMockReqRes({}, { id: NONEXISTENT_UUID });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('PATCH /user/persona/:id/default', () => {
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

  describe('PATCH /user/persona/settings', () => {
    it('should update share-ltm setting to true', async () => {
      // Mock current value is false, so updating to true is a change
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
      // Mock current value is true, so updating to false is a change
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
      // Mock current value is already true
      mockPrisma.persona.findUnique.mockResolvedValue({ shareLtmAcrossPersonalities: true });

      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/settings');

      const { req, res } = createMockReqRes({ shareLtmAcrossPersonalities: true });
      await handler(req, res);

      // Should NOT call update since value is unchanged
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
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123', defaultPersonaId: null });

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

      expect(mockPrisma.userPersonalityConfig.upsert).toHaveBeenCalled();
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

      // Should succeed (idempotent delete) with hadOverride: false
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
