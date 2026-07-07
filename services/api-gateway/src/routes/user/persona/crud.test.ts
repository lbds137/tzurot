/**
 * Tests for persona CRUD routes
 * - GET / - List personas
 * - GET /:id - Get persona
 * - POST / - Create persona
 * - PUT /:id - Update persona
 * - DELETE /:id - Delete persona
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';
import { ListPersonasResponseSchema } from '@tzurot/common-types/schemas/api/persona';
import { stubRouteResolvers } from '../../../test/shared-route-test-utils.js';
import {
  createMockPrisma,
  createMockReqRes,
  mockUser,
  mockPersona,
  MOCK_USER_ID,
  MOCK_PERSONA_ID,
  MOCK_PERSONA_ID_2,
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
  handleListPersonas,
  handleGetPersona,
  handleCreatePersona,
  handleUpdatePersona,
  handleDeletePersona,
} from './crud.js';

describe('persona CRUD routes', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);
    // UserService uses findUnique to look up users
    mockPrisma.user.findUnique.mockResolvedValue({
      id: MOCK_USER_ID,
      username: 'test-user',
      defaultPersonaId: MOCK_PERSONA_ID,
      isSuperuser: false,
    });
  });

  describe('GET /user/persona', () => {
    it('should return empty array when user has no personas', async () => {
      mockPrisma.persona.findMany.mockResolvedValue([]);
      const handler = handleListPersonas({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes();
      await handler(req, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith({ personas: [] });
    });

    it('should return list of personas with isDefault flag', async () => {
      mockPrisma.persona.findMany.mockResolvedValue([mockPersona]);
      const handler = handleListPersonas({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes();
      await handler(req, res, vi.fn());

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
      const handler = handleListPersonas({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes();
      await handler(req, res, vi.fn());

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown;

      // Validate response against the shared Zod schema - this is the contract test
      const parseResult = ListPersonasResponseSchema.safeParse(response);
      expect(parseResult.success).toBe(true);
      if (!parseResult.success) {
        // This provides helpful error messages if the schema validation fails
        console.error('Schema validation failed:', parseResult.error.format());
      }
    });

    it('should handle personas with null content and pronouns', async () => {
      const personaWithNulls = {
        ...mockPersona,
        content: null,
        pronouns: null,
        preferredName: null,
        description: null,
      };
      mockPrisma.persona.findMany.mockResolvedValue([personaWithNulls]);
      const handler = handleListPersonas({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes();
      await handler(req, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith({
        personas: [
          expect.objectContaining({
            id: MOCK_PERSONA_ID,
            name: 'Test Persona',
            content: null,
            pronouns: null,
            preferredName: null,
            description: null,
            isDefault: true,
          }),
        ],
      });

      // Also validate against schema to ensure null values pass contract

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown;
      const parseResult = ListPersonasResponseSchema.safeParse(response);
      expect(parseResult.success).toBe(true);
    });
  });

  describe('GET /user/persona/:id', () => {
    it('should return persona details', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue(mockPersona);
      const handler = handleGetPersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({}, { id: MOCK_PERSONA_ID });
      await handler(req, res, vi.fn());

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
      const handler = handleGetPersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({}, { id: NONEXISTENT_UUID });
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'NOT_FOUND',
        })
      );
    });

    it('should return 400 for invalid UUID format', async () => {
      const handler = handleGetPersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({}, { id: 'invalid-uuid-format' });
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
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

      const handler = handleCreatePersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({
        name: 'New Persona',
        content: 'New persona content',
        preferredName: 'Newbie',
      });
      await handler(req, res, vi.fn());

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

    it('should return NAME_COLLISION when the persona name is already taken', async () => {
      // Deterministic persona UUID → a duplicate (name, owner) trips P2002 on
      // the primary key. The handler translates it to a NAME_COLLISION rather
      // than an opaque 500.
      mockPrisma.persona.create.mockRejectedValue({ code: 'P2002' });

      const handler = handleCreatePersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({
        name: 'Existing Persona',
        content: 'whatever',
      });
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: API_ERROR_SUBCODE.NAME_COLLISION })
      );
    });

    it('should reject empty name', async () => {
      const handler = handleCreatePersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({ name: '', content: 'Valid content' });
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should reject empty content', async () => {
      const handler = handleCreatePersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({ name: 'Valid', content: '' });
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject content exceeding max length', async () => {
      const handler = handleCreatePersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({
        name: 'Valid',
        content: 'x'.repeat(5000), // Exceeds 4000 char limit
      });
      await handler(req, res, vi.fn());

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

      const handler = handleUpdatePersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({ name: 'Updated Name' }, { id: MOCK_PERSONA_ID });
      await handler(req, res, vi.fn());

      expect(mockPrisma.persona.update).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        persona: expect.objectContaining({ name: 'Updated Name' }),
      });
    });

    it('should return 404 for non-existent persona', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue(null);

      const handler = handleUpdatePersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({ name: 'Updated' }, { id: NONEXISTENT_UUID });
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should ignore empty name update (preserve existing value)', async () => {
      const existingPersona = { ...mockPersona, name: 'Existing Name' };
      mockPrisma.persona.findFirst.mockResolvedValue({ id: MOCK_PERSONA_ID });
      mockPrisma.persona.update.mockResolvedValue(existingPersona);

      const handler = handleUpdatePersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      // Empty name should NOT be included in update (preserves existing)
      const { req, res } = createMockReqRes({ name: '' }, { id: MOCK_PERSONA_ID });
      await handler(req, res, vi.fn());

      // Should succeed and NOT pass name to the update
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockPrisma.persona.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ name: expect.anything() }),
        })
      );
    });

    it('should return 400 for invalid UUID format', async () => {
      const handler = handleUpdatePersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({ name: 'Updated' }, { id: 'invalid-uuid' });
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });

    it('should ignore empty content (preserve existing value)', async () => {
      const existingPersona = { ...mockPersona, content: 'Existing content' };
      mockPrisma.persona.findFirst.mockResolvedValue({ id: MOCK_PERSONA_ID });
      mockPrisma.persona.update.mockResolvedValue(existingPersona);

      const handler = handleUpdatePersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      // Empty content should NOT be included in update (preserves existing)
      const { req, res } = createMockReqRes({ content: '' }, { id: MOCK_PERSONA_ID });
      await handler(req, res, vi.fn());

      // Should succeed and NOT pass content to the update
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockPrisma.persona.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ content: expect.anything() }),
        })
      );
    });

    it('should reject content update exceeding max length', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue({ id: MOCK_PERSONA_ID });

      const handler = handleUpdatePersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({ content: 'x'.repeat(5000) }, { id: MOCK_PERSONA_ID });
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('4000'),
        })
      );
    });

    it('should update optional fields', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue({ id: MOCK_PERSONA_ID });
      mockPrisma.persona.update.mockResolvedValue({
        ...mockPersona,
        preferredName: 'New Preferred',
        description: 'New description',
        pronouns: 'they/them',
      });

      const handler = handleUpdatePersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes(
        {
          preferredName: 'New Preferred',
          description: 'New description',
          pronouns: 'they/them',
        },
        { id: MOCK_PERSONA_ID }
      );
      await handler(req, res, vi.fn());

      expect(mockPrisma.persona.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            preferredName: 'New Preferred',
            description: 'New description',
            pronouns: 'they/them',
          }),
        })
      );
    });
  });

  describe('DELETE /user/persona/:id', () => {
    it('should delete persona', async () => {
      // Delete a non-default persona (MOCK_PERSONA_ID_2) — provisioning
      // middleware sets req.provisionedDefaultPersonaId = MOCK_PERSONA_ID,
      // so deleting that id would trip the "can't delete default" guard.
      mockPrisma.persona.findFirst.mockResolvedValue({ id: MOCK_PERSONA_ID_2 });
      mockPrisma.persona.delete.mockResolvedValue({});

      const handler = handleDeletePersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({}, { id: MOCK_PERSONA_ID_2 });
      await handler(req, res, vi.fn());

      expect(mockPrisma.persona.delete).toHaveBeenCalledWith({ where: { id: MOCK_PERSONA_ID_2 } });
      expect(res.json).toHaveBeenCalledWith({ message: 'Persona deleted' });
    });

    it('should prevent deleting default persona', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue({ id: MOCK_PERSONA_ID });

      const handler = handleDeletePersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({}, { id: MOCK_PERSONA_ID });
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('default'),
        })
      );
    });

    it('should return 404 for non-existent persona', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue(null);

      const handler = handleDeletePersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({}, { id: NONEXISTENT_UUID });
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 400 for invalid UUID format', async () => {
      const handler = handleDeletePersona({
        ...stubRouteResolvers(),
        prisma: mockPrisma as unknown as PrismaClient,
      });

      const { req, res } = createMockReqRes({}, { id: 'not-a-valid-uuid' });
      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
        })
      );
    });
  });
});
