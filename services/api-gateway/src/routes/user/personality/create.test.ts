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

// Uses the shared mock at `src/services/__mocks__/AuthMiddleware.ts`
// (auto-discovered by vitest). Passes `getOrCreateUserService` through to
// the real implementation and stubs `requireUserAuth` / `requireProvisionedUser`
// as passthrough middleware.
vi.mock('../../../services/AuthMiddleware.js');

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
        select: expect.objectContaining({
          id: true,
          name: true,
          slug: true,
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
    // First findUnique returns null (user doesn't exist), second returns created shell user
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null) // getOrCreateUserShell lookup
      .mockResolvedValueOnce({ id: 'user-uuid-123', defaultPersonaId: null }); // After shell creation
    mockPrisma.user.create.mockResolvedValueOnce({ id: 'user-uuid-123' });
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

    // Shell creation — api-gateway routes don't have username context.
    // See UserService.getOrCreateUserShell.
    expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('does not create a personality_default_configs row on personality create', async () => {
    // New personalities cascade to the current global default at request time
    // via PersonalityService.loadPersonality. Auto-pinning was removed after
    // it fossilized personalities against stale global defaults. Shapes
    // imports still pin deliberately via their own upsert (ShapesImportHelpers.ts)
    // — that path is unaffected by this change.
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

    expect(mockPrisma.personalityDefaultConfig.create).not.toHaveBeenCalled();
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

  describe('voice reference processing', () => {
    it('should return error for invalid voice reference data URI', async () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'Voice Char',
        slug: 'voice-char',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
        voiceReferenceData: 'not-a-data-uri',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.personality.create).not.toHaveBeenCalled();
    });

    it('should return error for unsupported voice reference MIME type', async () => {
      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'Voice Char',
        slug: 'voice-char',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
        voiceReferenceData: 'data:image/png;base64,iVBORw0KGgo=',
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.personality.create).not.toHaveBeenCalled();
    });

    it('should store valid voice reference and return hasVoiceReference true', async () => {
      mockPrisma.personality.create.mockResolvedValue(
        createMockPersonality({ voiceReferenceType: 'audio/wav' })
      );

      const audioBytes = Buffer.from('fake-wav-audio');
      const base64 = audioBytes.toString('base64');
      const dataUri = `data:audio/wav;base64,${base64}`;

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'post', '/');
      const { req, res } = createMockReqRes({
        name: 'Voice Char',
        slug: 'voice-char',
        characterInfo: 'Info',
        personalityTraits: 'Traits',
        voiceReferenceData: dataUri,
      });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(mockPrisma.personality.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            voiceReferenceData: new Uint8Array(audioBytes),
            voiceReferenceType: 'audio/wav',
          }),
        })
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          personality: expect.objectContaining({
            hasVoiceReference: true,
          }),
        })
      );
    });
  });
});
