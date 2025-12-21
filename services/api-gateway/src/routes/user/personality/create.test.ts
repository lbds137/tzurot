/**
 * Tests for POST /user/personality (create new personality)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';
import {
  createMockPrisma,
  createMockPersonality,
  createMockReqRes,
  getHandler,
  setupStandardMocks,
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
    assertDefined: vi.fn((value: unknown, name: string) => {
      if (value === undefined || value === null) {
        throw new Error(`${name} must be defined`);
      }
    }),
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

import { createPersonalityRoutes } from './index.js';

describe('POST /user/personality (create)', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
  });

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
      createMockPersonality({
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
    // First findUnique returns null (user doesn't exist), second returns created user
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null) // UserService lookup
      .mockResolvedValueOnce({ id: 'user-uuid-123', defaultPersonaId: 'test-persona-uuid' }); // After creation
    mockPrisma.personality.create.mockResolvedValue(createMockPersonality());

    const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
    const handler = getHandler(router, 'post', '/');
    const { req, res } = createMockReqRes({
      name: 'New Character',
      slug: 'new-char',
      characterInfo: 'Info',
      personalityTraits: 'Traits',
    });

    await handler(req, res);

    // UserService creates users via $transaction, not direct create
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should set default LLM config if available', async () => {
    mockPrisma.personality.create.mockResolvedValue(createMockPersonality());
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
    mockPrisma.personality.create.mockResolvedValue(createMockPersonality());

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
    mockPrisma.personality.create.mockResolvedValue(createMockPersonality());

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
      createMockPersonality({ errorMessage: 'Custom error message for this character' })
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
    mockPrisma.personality.create.mockResolvedValue(createMockPersonality());

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

  describe('avatar processing edge cases', () => {
    it('should warn when avatar exceeds target size after optimization', async () => {
      // Import the mock to override it for this test
      const { optimizeAvatar } = await import('../../../utils/imageProcessor.js');
      const mockOptimizeAvatar = vi.mocked(optimizeAvatar);
      mockOptimizeAvatar.mockResolvedValueOnce({
        buffer: Buffer.from('test'),
        quality: 10, // Low quality still produced large file
        originalSizeKB: 500,
        processedSizeKB: 150, // Still exceeds 100KB target
        exceedsTarget: true,
      });
      mockPrisma.personality.create.mockResolvedValue(createMockPersonality());

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'Big Avatar Character',
        slug: 'big-avatar',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
        avatarData: 'data:image/png;base64,iVBORw0KGgo=',
      });

      await handler(req, res);

      // Should still succeed - exceeding target is just a warning
      expect(res.status).toHaveBeenCalledWith(201);
      expect(mockPrisma.personality.create).toHaveBeenCalled();
    });

    it('should return error when avatar processing fails', async () => {
      const { optimizeAvatar } = await import('../../../utils/imageProcessor.js');
      const mockOptimizeAvatar = vi.mocked(optimizeAvatar);
      mockOptimizeAvatar.mockRejectedValueOnce(new Error('Invalid image format'));

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'Bad Avatar Character',
        slug: 'bad-avatar',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
        avatarData: 'data:image/png;base64,invalid-data',
      });

      await handler(req, res);

      // PROCESSING_ERROR returns 500, not 422
      expect(res.status).toHaveBeenCalledWith(500);
      expect(mockPrisma.personality.create).not.toHaveBeenCalled();
    });
  });

  describe('LLM config error handling', () => {
    it('should still succeed when setting default LLM config fails', async () => {
      mockPrisma.personality.create.mockResolvedValue(createMockPersonality());
      mockPrisma.llmConfig.findFirst.mockResolvedValue({
        id: 'default-config',
        isGlobal: true,
        isDefault: true,
      });
      // Make the personalityDefaultConfig.create throw an error
      mockPrisma.personalityDefaultConfig.create.mockRejectedValue(
        new Error('Database constraint violation')
      );

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'Config Error Character',
        slug: 'config-error',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handler(req, res);

      // Should still succeed - LLM config failure is logged but non-fatal
      expect(res.status).toHaveBeenCalledWith(201);
      expect(mockPrisma.personality.create).toHaveBeenCalled();
    });

    it('should skip LLM config when no default config exists', async () => {
      mockPrisma.personality.create.mockResolvedValue(createMockPersonality());
      mockPrisma.llmConfig.findFirst.mockResolvedValue(null);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'No Config Character',
        slug: 'no-config',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      // Should NOT attempt to create personalityDefaultConfig
      expect(mockPrisma.personalityDefaultConfig.create).not.toHaveBeenCalled();
    });
  });
});
