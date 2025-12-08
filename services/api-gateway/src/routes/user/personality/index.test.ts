/**
 * Tests for /user/personality routes
 *
 * Comprehensive tests for CRUD operations on user personalities (characters).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock isBotOwner - must be before vi.mock to be hoisted
const mockIsBotOwner = vi.fn().mockReturnValue(false);

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
    assertDefined: vi.fn((value: unknown, name: string) => {
      if (value === undefined || value === null) {
        throw new Error(`${name} must be defined`);
      }
    }),
    isBotOwner: (...args: unknown[]) => mockIsBotOwner(...args),
  };
});

vi.mock('../../../services/AuthMiddleware.js', () => ({
  requireUserAuth: vi.fn(() => vi.fn((_req: unknown, _res: unknown, next: () => void) => next())),
}));

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

vi.mock('../../../utils/imageProcessor.js', () => ({
  optimizeAvatar: vi.fn().mockResolvedValue({
    buffer: Buffer.from('test'),
    quality: 80,
    originalSizeKB: 100,
    processedSizeKB: 50,
    exceedsTarget: false,
  }),
}));

// Mock fs/promises for avatar cache deletion tests
vi.mock('fs/promises', () => ({
  unlink: vi.fn(),
}));
import * as fsPromises from 'fs/promises';
const mockUnlink = vi.mocked(fsPromises.unlink);

// Mock Prisma
const mockPrisma = {
  user: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  personality: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  personalityOwner: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  pendingMemory: {
    count: vi.fn(),
    deleteMany: vi.fn(),
  },
  systemPrompt: {
    findFirst: vi.fn(),
  },
  llmConfig: {
    findFirst: vi.fn(),
  },
  personalityDefaultConfig: {
    create: vi.fn(),
  },
};

import { createPersonalityRoutes } from './index.js';
import { type PrismaClient, DeletePersonalityResponseSchema } from '@tzurot/common-types';

// Mock dates for consistent testing
const MOCK_CREATED_AT = new Date('2024-01-01T00:00:00.000Z');
const MOCK_UPDATED_AT = new Date('2024-01-02T00:00:00.000Z');

// Base mock personality with all fields needed for POST/PUT responses
function createMockPersonality(overrides: Record<string, unknown> = {}) {
  return {
    id: 'new-personality',
    name: 'New Character',
    slug: 'new-char',
    displayName: null,
    characterInfo: 'Default character info',
    personalityTraits: 'Default traits',
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
    avatarData: null,
    createdAt: MOCK_CREATED_AT,
    updatedAt: MOCK_UPDATED_AT,
    ...overrides,
  };
}

// Alias for backward compatibility
function createMockCreatedPersonality(overrides: Record<string, unknown> = {}) {
  return createMockPersonality(overrides);
}

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
  router: ReturnType<typeof createPersonalityRoutes>,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (router.stack as any[]).find(
    l => l.route?.path === path && l.route?.methods?.[method]
  );
  return (layer as { route: { stack: { handle: Function }[] } }).route.stack[
    (layer as { route: { stack: { handle: Function }[] } }).route.stack.length - 1
  ].handle;
}

describe('/user/personality routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBotOwner.mockReturnValue(false);
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-uuid-123' });
    mockPrisma.personality.findMany.mockResolvedValue([]);
    mockPrisma.personality.findUnique.mockResolvedValue(null);
    mockPrisma.personalityOwner.findMany.mockResolvedValue([]);
    mockPrisma.personalityOwner.findUnique.mockResolvedValue(null);
    mockPrisma.llmConfig.findFirst.mockResolvedValue(null);
    mockPrisma.pendingMemory.count.mockResolvedValue(0);
    mockPrisma.pendingMemory.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.personality.delete.mockResolvedValue({});
  });

  describe('route factory', () => {
    it('should create a router', () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);

      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('should have GET / route registered', () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);

      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);

      const getRoute = (
        router.stack as unknown as { route?: { path?: string; methods?: { get?: boolean } } }[]
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.get);
      expect(getRoute).toBeDefined();
    });

    it('should have GET /:slug route registered', () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);

      const getRoute = (
        router.stack as unknown as { route?: { path?: string; methods?: { get?: boolean } } }[]
      ).find(layer => layer.route?.path === '/:slug' && layer.route?.methods?.get);
      expect(getRoute).toBeDefined();
    });

    it('should have POST route registered', () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);

      const postRoute = (
        router.stack as unknown as { route?: { path?: string; methods?: { post?: boolean } } }[]
      ).find(layer => layer.route?.path === '/' && layer.route?.methods?.post);
      expect(postRoute).toBeDefined();
    });

    it('should have PUT /:slug route registered', () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);

      const putRoute = (
        router.stack as unknown as { route?: { path?: string; methods?: { put?: boolean } } }[]
      ).find(layer => layer.route?.path === '/:slug' && layer.route?.methods?.put);
      expect(putRoute).toBeDefined();
    });

    it('should have PATCH /:slug/visibility route registered', () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);

      const patchRoute = (
        router.stack as unknown as { route?: { path?: string; methods?: { patch?: boolean } } }[]
      ).find(layer => layer.route?.path === '/:slug/visibility' && layer.route?.methods?.patch);
      expect(patchRoute).toBeDefined();
    });
  });

  describe('GET /user/personality', () => {
    it('should return public personalities', async () => {
      const publicPersonality = {
        id: 'personality-1',
        name: 'Public Character',
        displayName: 'Public',
        slug: 'public-character',
        ownerId: 'other-user',
        isPublic: true,
      };
      mockPrisma.personality.findMany
        .mockResolvedValueOnce([publicPersonality])
        .mockResolvedValueOnce([]);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personalities: [
            expect.objectContaining({
              id: 'personality-1',
              slug: 'public-character',
              isOwned: false,
              isPublic: true,
            }),
          ],
        })
      );
    });

    it('should return owned personalities with isOwned=true', async () => {
      const ownedPersonality = {
        id: 'personality-2',
        name: 'My Character',
        displayName: 'Mine',
        slug: 'my-character',
        ownerId: 'user-uuid-123',
        isPublic: false,
      };
      mockPrisma.personality.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([ownedPersonality]);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personalities: [
            expect.objectContaining({
              id: 'personality-2',
              slug: 'my-character',
              isOwned: true,
              isPublic: false,
            }),
          ],
        })
      );
    });

    it('should handle user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.personality.findMany.mockResolvedValue([]);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'get', '/');
      const { req, res } = createMockReqRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personalities: [],
        })
      );
    });
  });

  describe('GET /user/personality/:slug', () => {
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
      mockPrisma.personalityOwner.findUnique.mockResolvedValue(null);

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

  describe('POST /user/personality', () => {
    it('should reject missing name', async () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        slug: 'test-char',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject missing slug', async () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'Test Character',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject missing characterInfo', async () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'Test Character',
        slug: 'test-char',
        personalityTraits: 'Traits',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject missing personalityTraits', async () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'Test Character',
        slug: 'test-char',
        characterInfo: 'Info',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject invalid slug format', async () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'Test Character',
        slug: 'Invalid Slug With Spaces!',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should reject duplicate slug', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({ id: 'existing' });

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'Test Character',
        slug: 'existing-slug',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('should create personality successfully', async () => {
      mockPrisma.personality.create.mockResolvedValue(
        createMockCreatedPersonality({
          characterInfo: 'A new character',
          personalityTraits: 'Friendly, kind',
        })
      );

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'New Character',
        slug: 'new-char',
        characterInfo: 'A new character',
        personalityTraits: 'Friendly, kind',
      });

      await handler(req, res);

      expect(mockPrisma.personality.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'New Character',
            slug: 'new-char',
            characterInfo: 'A new character',
            personalityTraits: 'Friendly, kind',
            ownerId: 'user-uuid-123',
            isPublic: false,
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          personality: expect.objectContaining({
            id: 'new-personality',
            slug: 'new-char',
          }),
        })
      );
    });

    it('should create user if not exists', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({ id: 'new-user' });
      mockPrisma.personality.create.mockResolvedValue(createMockCreatedPersonality());

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'New Character',
        slug: 'new-char',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handler(req, res);

      expect(mockPrisma.user.create).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('should set default LLM config if available', async () => {
      mockPrisma.personality.create.mockResolvedValue(createMockCreatedPersonality());
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: 'default-config',
        isGlobal: true,
        isDefault: true,
      });

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'New Character',
        slug: 'new-char',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handler(req, res);

      expect(mockPrisma.personalityDefaultConfig.create).toHaveBeenCalledWith({
        data: {
          personalityId: 'new-personality',
          llmConfigId: 'default-config',
        },
      });
    });

    it('should set default system prompt if available', async () => {
      mockPrisma.systemPrompt.findFirst.mockResolvedValue({
        id: 'default-system-prompt',
      });
      mockPrisma.personality.create.mockResolvedValue(createMockCreatedPersonality());

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'New Character',
        slug: 'new-char',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handler(req, res);

      expect(mockPrisma.systemPrompt.findFirst).toHaveBeenCalledWith({
        where: { isDefault: true },
        select: { id: true },
      });
      expect(mockPrisma.personality.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            systemPromptId: 'default-system-prompt',
          }),
        })
      );
    });

    it('should set systemPromptId to null when no default system prompt exists', async () => {
      mockPrisma.systemPrompt.findFirst.mockResolvedValue(null);
      mockPrisma.personality.create.mockResolvedValue(createMockCreatedPersonality());

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'New Character',
        slug: 'new-char',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handler(req, res);

      expect(mockPrisma.personality.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            systemPromptId: null,
          }),
        })
      );
    });

    it('should save errorMessage when provided', async () => {
      mockPrisma.personality.create.mockResolvedValue(
        createMockCreatedPersonality({ errorMessage: 'Custom error message for this character' })
      );

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'New Character',
        slug: 'new-char',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
        errorMessage: 'Custom error message for this character',
      });

      await handler(req, res);

      expect(mockPrisma.personality.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            errorMessage: 'Custom error message for this character',
          }),
        })
      );
    });

    it('should set errorMessage to null when not provided', async () => {
      mockPrisma.personality.create.mockResolvedValue(createMockCreatedPersonality());

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'New Character',
        slug: 'new-char',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handler(req, res);

      expect(mockPrisma.personality.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            errorMessage: null,
          }),
        })
      );
    });
  });

  describe('PUT /user/personality/:slug', () => {
    it('should return 403 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes({ name: 'Updated' }, { slug: 'test-char' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 404 when personality not found', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes({ name: 'Updated' }, { slug: 'nonexistent' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 403 when user does not own personality', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'personality-6',
        ownerId: 'other-user',
      });
      mockPrisma.personalityOwner.findUnique.mockResolvedValue(null);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes({ name: 'Updated' }, { slug: 'not-mine' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should update owned personality', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'personality-7',
        ownerId: 'user-uuid-123',
      });
      mockPrisma.personality.update.mockResolvedValue(
        createMockPersonality({
          id: 'personality-7',
          name: 'Updated Name',
          slug: 'my-char',
          displayName: 'Updated Display',
          isPublic: false,
          updatedAt: new Date('2024-01-03'),
        })
      );

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes(
        { name: 'Updated Name', displayName: 'Updated Display' },
        { slug: 'my-char' }
      );

      await handler(req, res);

      expect(mockPrisma.personality.update).toHaveBeenCalledWith({
        where: { id: 'personality-7' },
        data: expect.objectContaining({
          name: 'Updated Name',
          displayName: 'Updated Display',
        }),
        select: expect.any(Object),
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          personality: expect.objectContaining({
            name: 'Updated Name',
          }),
        })
      );
    });

    it('should allow update via PersonalityOwner table', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'personality-8',
        ownerId: 'other-user', // Not direct owner
      });
      // But user has entry in PersonalityOwner table
      mockPrisma.personalityOwner.findUnique.mockResolvedValue({
        userId: 'user-uuid-123',
        personalityId: 'personality-8',
      });
      mockPrisma.personality.update.mockResolvedValue(
        createMockPersonality({
          id: 'personality-8',
          name: 'Updated',
          slug: 'shared-char',
          displayName: null,
          isPublic: false,
          updatedAt: new Date(),
        })
      );

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes({ name: 'Updated' }, { slug: 'shared-char' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    describe('displayName preservation (regression tests)', () => {
      beforeEach(() => {
        mockPrisma.personality.findUnique.mockResolvedValue({
          id: 'personality-unicode',
          ownerId: 'user-uuid-123',
          name: 'persephone', // Plain ASCII name
        });
      });

      it('should NOT modify displayName when only updating avatar', async () => {
        // This test verifies the fix for the bug where avatar-only updates
        // were overwriting Unicode displayNames with plain ASCII names
        mockPrisma.personality.update.mockResolvedValue(
          createMockPersonality({
            id: 'personality-unicode',
            name: 'persephone',
            displayName: '𝑷𝒆𝒓𝒔𝒆𝒑𝒉𝒐𝒏𝒆', // Unicode displayName preserved
            slug: 'persephone',
          })
        );

        const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
        const handler = getHandler(router, 'put', '/:slug');
        const { req, res } = createMockReqRes(
          { avatarData: 'data:image/png;base64,iVBORw0KGgo=' }, // Only avatar, no displayName
          { slug: 'persephone' }
        );

        await handler(req, res);

        // Verify that displayName was NOT included in the update
        expect(mockPrisma.personality.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.not.objectContaining({
              displayName: expect.any(String),
            }),
          })
        );
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it('should sync displayName when name is updated without explicit displayName', async () => {
        mockPrisma.personality.update.mockResolvedValue(
          createMockPersonality({
            id: 'personality-unicode',
            name: 'NewName',
            displayName: 'NewName',
            slug: 'persephone',
          })
        );

        const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
        const handler = getHandler(router, 'put', '/:slug');
        const { req, res } = createMockReqRes(
          { name: 'NewName' }, // Only name, no displayName
          { slug: 'persephone' }
        );

        await handler(req, res);

        // When name is updated without displayName, displayName should sync to new name
        expect(mockPrisma.personality.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              name: 'NewName',
              displayName: 'NewName',
            }),
          })
        );
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it('should use explicit displayName when provided', async () => {
        mockPrisma.personality.update.mockResolvedValue(
          createMockPersonality({
            id: 'personality-unicode',
            name: 'persephone',
            displayName: 'Custom Display Name',
            slug: 'persephone',
          })
        );

        const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
        const handler = getHandler(router, 'put', '/:slug');
        const { req, res } = createMockReqRes(
          { displayName: 'Custom Display Name' },
          { slug: 'persephone' }
        );

        await handler(req, res);

        expect(mockPrisma.personality.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              displayName: 'Custom Display Name',
            }),
          })
        );
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it('should fall back to name when displayName is explicitly set to empty string', async () => {
        mockPrisma.personality.update.mockResolvedValue(
          createMockPersonality({
            id: 'personality-unicode',
            name: 'persephone',
            displayName: 'persephone',
            slug: 'persephone',
          })
        );

        const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
        const handler = getHandler(router, 'put', '/:slug');
        const { req, res } = createMockReqRes(
          { displayName: '' }, // Explicitly empty
          { slug: 'persephone' }
        );

        await handler(req, res);

        // Empty displayName should fall back to existing name
        expect(mockPrisma.personality.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              displayName: 'persephone', // Falls back to personality.name
            }),
          })
        );
        expect(res.status).toHaveBeenCalledWith(200);
      });
    });

    describe('avatar cache deletion', () => {
      beforeEach(() => {
        mockUnlink.mockReset();
        // Standard setup: user exists, owns the personality
        mockPrisma.personality.findUnique.mockResolvedValue({
          id: 'personality-avatar',
          ownerId: 'user-uuid-123',
          name: 'Test',
          avatarData: null,
        });
        mockPrisma.personality.update.mockResolvedValue(
          createMockPersonality({
            id: 'personality-avatar',
            name: 'Test',
            slug: 'test-char',
            displayName: 'Test Display',
          })
        );
      });

      it('should delete cached avatar file when avatar is updated', async () => {
        mockUnlink.mockResolvedValue(undefined);

        const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
        const handler = getHandler(router, 'put', '/:slug');
        const { req, res } = createMockReqRes(
          { name: 'Updated', avatarData: 'data:image/png;base64,iVBORw0KGgo=' },
          { slug: 'test-char' }
        );

        await handler(req, res);

        expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/test-char.png');
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it('should silently handle ENOENT when avatar cache file does not exist', async () => {
        const enoentError = new Error('File not found') as NodeJS.ErrnoException;
        enoentError.code = 'ENOENT';
        mockUnlink.mockRejectedValue(enoentError);

        const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
        const handler = getHandler(router, 'put', '/:slug');
        const { req, res } = createMockReqRes(
          { name: 'Updated', avatarData: 'data:image/png;base64,iVBORw0KGgo=' },
          { slug: 'valid-slug' }
        );

        await handler(req, res);

        // Should not fail - ENOENT is expected when file doesn't exist
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it('should silently handle ENOTDIR when avatar path issue', async () => {
        const enotdirError = new Error('Not a directory') as NodeJS.ErrnoException;
        enotdirError.code = 'ENOTDIR';
        mockUnlink.mockRejectedValue(enotdirError);

        const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
        const handler = getHandler(router, 'put', '/:slug');
        const { req, res } = createMockReqRes(
          { name: 'Updated', avatarData: 'data:image/png;base64,iVBORw0KGgo=' },
          { slug: 'valid-slug' }
        );

        await handler(req, res);

        // Should not fail - ENOTDIR is expected when data volume not mounted
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it('should log warning for other filesystem errors but not fail', async () => {
        const permError = new Error('Permission denied') as NodeJS.ErrnoException;
        permError.code = 'EACCES';
        mockUnlink.mockRejectedValue(permError);

        const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
        const handler = getHandler(router, 'put', '/:slug');
        const { req, res } = createMockReqRes(
          { name: 'Updated', avatarData: 'data:image/png;base64,iVBORw0KGgo=' },
          { slug: 'valid-slug' }
        );

        await handler(req, res);

        // Should still succeed - cache deletion failure is non-fatal
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it('should skip cache deletion for invalid slug format (path traversal protection)', async () => {
        // This tests the CWE-22 path traversal protection
        // Invalid slugs should not trigger unlink at all
        mockPrisma.personality.findUnique.mockResolvedValue({
          id: 'personality-avatar',
          ownerId: 'user-uuid-123',
          slug: '../../../etc/passwd', // Malicious slug
          avatarData: null,
        });

        const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
        const handler = getHandler(router, 'put', '/:slug');
        const { req, res } = createMockReqRes(
          { name: 'Updated', avatarData: 'data:image/png;base64,iVBORw0KGgo=' },
          { slug: '../../../etc/passwd' }
        );

        await handler(req, res);

        // unlink should NOT be called for invalid slug
        expect(mockUnlink).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
      });
    });
  });

  describe('PATCH /user/personality/:slug/visibility', () => {
    it('should reject missing isPublic', async () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/:slug/visibility');
      const { req, res } = createMockReqRes({}, { slug: 'test-char' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 403 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/:slug/visibility');
      const { req, res } = createMockReqRes({ isPublic: true }, { slug: 'test-char' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 404 when personality not found', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
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
      mockPrisma.personalityOwner.findUnique.mockResolvedValue(null);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/:slug/visibility');
      const { req, res } = createMockReqRes({ isPublic: true }, { slug: 'not-mine' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should toggle visibility to public', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'personality-10',
        ownerId: 'user-uuid-123',
        isPublic: false,
      });
      mockPrisma.personality.update.mockResolvedValue({
        id: 'personality-10',
        slug: 'my-char',
        isPublic: true,
      });

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/:slug/visibility');
      const { req, res } = createMockReqRes({ isPublic: true }, { slug: 'my-char' });

      await handler(req, res);

      expect(mockPrisma.personality.update).toHaveBeenCalledWith({
        where: { id: 'personality-10' },
        data: { isPublic: true },
        select: { id: true, slug: true, isPublic: true },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          personality: expect.objectContaining({
            isPublic: true,
          }),
        })
      );
    });

    it('should toggle visibility to private', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'personality-11',
        ownerId: 'user-uuid-123',
        isPublic: true,
      });
      mockPrisma.personality.update.mockResolvedValue({
        id: 'personality-11',
        slug: 'my-char',
        isPublic: false,
      });

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'patch', '/:slug/visibility');
      const { req, res } = createMockReqRes({ isPublic: false }, { slug: 'my-char' });

      await handler(req, res);

      expect(mockPrisma.personality.update).toHaveBeenCalledWith({
        where: { id: 'personality-11' },
        data: { isPublic: false },
        select: expect.any(Object),
      });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personality: expect.objectContaining({
            isPublic: false,
          }),
        })
      );
    });
  });

  describe('DELETE /user/personality/:slug', () => {
    it('should have DELETE /:slug route registered', () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);

      const deleteRoute = (
        router.stack as unknown as { route?: { path?: string; methods?: { delete?: boolean } } }[]
      ).find(layer => layer.route?.path === '/:slug' && layer.route?.methods?.delete);
      expect(deleteRoute).toBeDefined();
    });

    it('should return 403 when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: 'test-char' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('should return 404 when personality not found', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: 'nonexistent' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should return 403 when user does not own personality', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'personality-other',
        name: 'Not Mine',
        ownerId: 'other-user-uuid',
        _count: {
          conversationHistory: 0,
          memories: 0,
          activatedChannels: 0,
          aliases: 0,
        },
      });
      mockPrisma.personalityOwner.findUnique.mockResolvedValue(null);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: 'not-mine' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockPrisma.personality.delete).not.toHaveBeenCalled();
    });

    it('should delete owned personality successfully', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'personality-owned',
        name: 'My Character',
        ownerId: 'user-uuid-123',
        _count: {
          conversationHistory: 10,
          memories: 5,
          activatedChannels: 2,
          aliases: 1,
        },
      });
      mockPrisma.pendingMemory.count.mockResolvedValue(3);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: 'my-char' });

      await handler(req, res);

      expect(mockPrisma.pendingMemory.deleteMany).toHaveBeenCalledWith({
        where: { personalityId: 'personality-owned' },
      });
      expect(mockPrisma.personality.delete).toHaveBeenCalledWith({
        where: { id: 'personality-owned' },
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return correct deletion counts', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'personality-counts',
        name: 'Count Test',
        ownerId: 'user-uuid-123',
        _count: {
          conversationHistory: 50,
          memories: 25,
          activatedChannels: 3,
          aliases: 2,
        },
      });
      mockPrisma.pendingMemory.count.mockResolvedValue(10);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: 'count-test' });

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          deletedSlug: 'count-test',
          deletedName: 'Count Test',
          deletedCounts: {
            conversationHistory: 50,
            memories: 25,
            pendingMemories: 10,
            activatedChannels: 3,
            aliases: 2,
          },
        })
      );
    });

    it('should validate response against Zod schema (contract validation)', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'personality-schema',
        name: 'Schema Test',
        ownerId: 'user-uuid-123',
        _count: {
          conversationHistory: 5,
          memories: 3,
          activatedChannels: 1,
          aliases: 0,
        },
      });
      mockPrisma.pendingMemory.count.mockResolvedValue(2);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: 'schema-test' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(200);

      // Extract the actual response and validate against schema
      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      const parseResult = DeletePersonalityResponseSchema.safeParse(jsonCall);
      expect(parseResult.success).toBe(true);
    });

    it('should skip PendingMemory deletion when count is 0', async () => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'personality-no-pending',
        name: 'No Pending',
        ownerId: 'user-uuid-123',
        _count: {
          conversationHistory: 5,
          memories: 3,
          activatedChannels: 0,
          aliases: 0,
        },
      });
      mockPrisma.pendingMemory.count.mockResolvedValue(0);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: 'no-pending' });

      await handler(req, res);

      // Should NOT call deleteMany when count is 0
      expect(mockPrisma.pendingMemory.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.personality.delete).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should allow bot owner to delete any personality', async () => {
      // Set up as bot owner
      mockIsBotOwner.mockReturnValue(true);

      // Personality owned by someone else
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'personality-other-user',
        name: 'Other User Character',
        ownerId: 'other-user-uuid',
        _count: {
          conversationHistory: 10,
          memories: 5,
          activatedChannels: 0,
          aliases: 0,
        },
      });
      mockPrisma.pendingMemory.count.mockResolvedValue(0);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: 'other-user-char' });

      await handler(req, res);

      expect(mockIsBotOwner).toHaveBeenCalled();
      expect(mockPrisma.personality.delete).toHaveBeenCalledWith({
        where: { id: 'personality-other-user' },
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should allow co-owner (PersonalityOwner table) to delete personality', async () => {
      // Personality owned by different user
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'personality-coowned',
        name: 'Co-owned Character',
        ownerId: 'other-user-uuid',
        _count: {
          conversationHistory: 0,
          memories: 0,
          activatedChannels: 0,
          aliases: 0,
        },
      });
      // But user has co-ownership entry
      mockPrisma.personalityOwner.findUnique.mockResolvedValue({
        userId: 'user-uuid-123',
        personalityId: 'personality-coowned',
      });
      mockPrisma.pendingMemory.count.mockResolvedValue(0);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'delete', '/:slug');
      const { req, res } = createMockReqRes({}, { slug: 'coowned-char' });

      await handler(req, res);

      expect(mockPrisma.personality.delete).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    describe('avatar cache deletion', () => {
      beforeEach(() => {
        mockUnlink.mockReset();
        mockPrisma.personality.findUnique.mockResolvedValue({
          id: 'personality-avatar-delete',
          name: 'Avatar Test',
          ownerId: 'user-uuid-123',
          _count: {
            conversationHistory: 0,
            memories: 0,
            activatedChannels: 0,
            aliases: 0,
          },
        });
        mockPrisma.pendingMemory.count.mockResolvedValue(0);
      });

      it('should delete cached avatar file with valid slug', async () => {
        mockUnlink.mockResolvedValue(undefined);

        const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
        const handler = getHandler(router, 'delete', '/:slug');
        const { req, res } = createMockReqRes({}, { slug: 'valid-slug' });

        await handler(req, res);

        expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/valid-slug.png');
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it('should silently handle ENOENT when avatar cache file does not exist', async () => {
        const enoentError = new Error('File not found') as NodeJS.ErrnoException;
        enoentError.code = 'ENOENT';
        mockUnlink.mockRejectedValue(enoentError);

        const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
        const handler = getHandler(router, 'delete', '/:slug');
        const { req, res } = createMockReqRes({}, { slug: 'valid-slug' });

        await handler(req, res);

        // Should not fail - ENOENT is expected when file doesn't exist
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it('should silently handle ENOTDIR when avatar path issue', async () => {
        const enotdirError = new Error('Not a directory') as NodeJS.ErrnoException;
        enotdirError.code = 'ENOTDIR';
        mockUnlink.mockRejectedValue(enotdirError);

        const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
        const handler = getHandler(router, 'delete', '/:slug');
        const { req, res } = createMockReqRes({}, { slug: 'valid-slug' });

        await handler(req, res);

        // Should not fail - ENOTDIR is expected when data volume not mounted
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it('should skip avatar deletion for invalid slug format (path traversal protection)', async () => {
        // This tests the CWE-22 path traversal protection
        // Invalid slugs should not trigger unlink at all
        const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
        const handler = getHandler(router, 'delete', '/:slug');
        const { req, res } = createMockReqRes({}, { slug: '../../../etc/passwd' });

        await handler(req, res);

        // unlink should NOT be called for invalid slug
        expect(mockUnlink).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
      });

      it('should skip avatar deletion for slug with spaces', async () => {
        const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
        const handler = getHandler(router, 'delete', '/:slug');
        const { req, res } = createMockReqRes({}, { slug: 'invalid slug' });

        await handler(req, res);

        // unlink should NOT be called for slug with spaces
        expect(mockUnlink).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
      });
    });
  });
});
