/**
 * Tests for persona CRUD routes
 * - GET / - List personas
 * - GET /:id - Get persona
 * - POST / - Create persona
 * - PUT /:id - Update persona
 * - DELETE /:id - Delete persona
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';
import { ListPersonasResponseSchema } from '@tzurot/common-types';
import {
  createMockPrisma,
  createMockReqRes,
  getHandler,
  mockUser,
  mockPersona,
  MOCK_USER_ID,
  MOCK_PERSONA_ID,
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

describe('persona CRUD routes', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);
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

    it('should return response that validates against shared API schema (contract test)', async () => {
      // This test ensures the API response matches the shared contract in common-types
      // If this test fails, the bot-client will break because it uses the same schema
      mockPrisma.persona.findMany.mockResolvedValue([mockPersona]);
      const router = createPersonaRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');

      const { req, res } = createMockReqRes();
      await handler(req, res);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown;

      // Validate response against the shared Zod schema - this is the contract test
      const parseResult = ListPersonasResponseSchema.safeParse(response);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) {
        // This provides helpful error messages if the schema validation fails
        console.error('Schema validation failed:', parseResult.error.format());
      }
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
        id: 'e5f6a7b8-c9d0-1234-ef01-345678901234',
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

      const { req, res } = createMockReqRes({}, { id: MOCK_PERSONA_ID });
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
});
