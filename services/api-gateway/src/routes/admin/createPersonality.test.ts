/**
 * Create Personality Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createCreatePersonalityRoute } from './createPersonality.js';
import type { PrismaClient, CacheInvalidationService } from '@tzurot/common-types';

// Mock AuthMiddleware
vi.mock('../../services/AuthMiddleware.js', () => ({
  requireOwnerAuth: () => (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = 'admin-discord-id'; // Set admin user ID
    next();
  },
}));

// Mock imageProcessor
vi.mock('../../utils/imageProcessor.js', () => ({
  optimizeAvatar: vi.fn().mockResolvedValue({
    buffer: Buffer.from('optimized-image-data'),
    originalSizeKB: 300,
    processedSizeKB: 150,
    quality: 85,
    exceedsTarget: false,
  }),
}));

// Create mock Prisma client
const createMockPrismaClient = () => ({
  personality: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
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
  user: {
    findUnique: vi.fn(),
  },
});

describe('POST /admin/personality', () => {
  let app: Express;
  let prisma: ReturnType<typeof createMockPrismaClient>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock Prisma client
    prisma = createMockPrismaClient();

    // Default: admin user exists (required for ownerId)
    prisma.user.findUnique.mockResolvedValue({ id: 'admin-user-id' });

    // Create Express app with create personality router
    app = express();
    app.use(express.json());
    app.use('/admin/personality', createCreatePersonalityRoute(prisma as unknown as PrismaClient));
  });

  it('should create a new personality with required fields', async () => {
    prisma.personality.findUnique.mockResolvedValue(null); // Slug doesn't exist
    prisma.personality.create.mockResolvedValue({
      id: 'personality-123',
      name: 'Test Bot',
      slug: 'test-bot',
      displayName: null,
      characterInfo: 'A helpful assistant',
      personalityTraits: 'Friendly and knowledgeable',
      personalityTone: null,
      personalityAge: null,
      personalityAppearance: null,
      personalityLikes: null,
      personalityDislikes: null,
      conversationalGoals: null,
      conversationalExamples: null,
      customFields: null,
      avatarData: null,
      voiceEnabled: false,
      imageEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.llmConfig.findFirst.mockResolvedValue(null); // No default config

    const response = await request(app).post('/admin/personality').send({
      name: 'Test Bot',
      slug: 'test-bot',
      characterInfo: 'A helpful assistant',
      personalityTraits: 'Friendly and knowledgeable',
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.personality).toMatchObject({
      id: 'personality-123',
      name: 'Test Bot',
      slug: 'test-bot',
    });
    expect(prisma.personality.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Test Bot',
        slug: 'test-bot',
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly and knowledgeable',
        voiceEnabled: false,
        imageEnabled: false,
      }),
    });
  });

  it('should reject creation with missing required fields', async () => {
    const response = await request(app).post('/admin/personality').send({
      name: 'Test Bot',
      // Missing slug, characterInfo, personalityTraits
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('should return 403 if admin user not found in database', async () => {
    prisma.user.findUnique.mockResolvedValue(null); // Admin not registered

    const response = await request(app).post('/admin/personality').send({
      name: 'Test Bot',
      slug: 'test-bot',
      characterInfo: 'A helpful assistant',
      personalityTraits: 'Friendly',
    });

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/admin user not found/i);
  });

  it('should reject creation with invalid slug format', async () => {
    const response = await request(app).post('/admin/personality').send({
      name: 'Test Bot',
      slug: 'Invalid Slug!', // Contains uppercase and special chars
      characterInfo: 'A helpful assistant',
      personalityTraits: 'Friendly',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('should reject creation when slug already exists', async () => {
    prisma.personality.findUnique.mockResolvedValue({
      id: 'existing-123',
      slug: 'test-bot',
    } as never);

    const response = await request(app).post('/admin/personality').send({
      name: 'Test Bot',
      slug: 'test-bot',
      characterInfo: 'A helpful assistant',
      personalityTraits: 'Friendly',
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toBeDefined();
  });

  it('should create personality with optional fields', async () => {
    prisma.personality.findUnique.mockResolvedValue(null);
    prisma.personality.create.mockResolvedValue({
      id: 'personality-456',
      name: 'Test Bot',
      slug: 'test-bot',
      displayName: 'My Test Bot',
      characterInfo: 'A helpful assistant',
      personalityTraits: 'Friendly',
      personalityTone: 'casual',
      personalityAge: '25',
      personalityAppearance: 'Tall and friendly',
      personalityLikes: 'Coding',
      personalityDislikes: 'Bugs',
      conversationalGoals: 'Help users',
      conversationalExamples: 'Hello!',
      customFields: { theme: 'dark' },
      avatarData: null,
      voiceEnabled: false,
      imageEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.llmConfig.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .post('/admin/personality')
      .send({
        name: 'Test Bot',
        slug: 'test-bot',
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
        displayName: 'My Test Bot',
        personalityTone: 'casual',
        personalityAge: '25',
        personalityAppearance: 'Tall and friendly',
        personalityLikes: 'Coding',
        personalityDislikes: 'Bugs',
        conversationalGoals: 'Help users',
        conversationalExamples: 'Hello!',
        customFields: { theme: 'dark' },
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(prisma.personality.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        displayName: 'My Test Bot',
        personalityTone: 'casual',
        customFields: { theme: 'dark' },
      }),
    });
  });

  it('should reject invalid customFields (not an object)', async () => {
    prisma.personality.findUnique.mockResolvedValue(null);

    const response = await request(app).post('/admin/personality').send({
      name: 'Test Bot',
      slug: 'test-bot',
      characterInfo: 'A helpful assistant',
      personalityTraits: 'Friendly',
      customFields: 'not-an-object',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('should reject customFields as array', async () => {
    prisma.personality.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/admin/personality')
      .send({
        name: 'Test Bot',
        slug: 'test-bot',
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
        customFields: ['array', 'not', 'allowed'],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  describe('avatar processing', () => {
    it('should process and store avatar data', async () => {
      // Import the already-mocked function
      const { optimizeAvatar } = await import('../../utils/imageProcessor.js');
      prisma.personality.findUnique.mockResolvedValue(null);
      prisma.personality.create.mockResolvedValue({
        id: 'personality-789',
        name: 'Test Bot',
        slug: 'test-bot-avatar',
        displayName: null,
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        customFields: null,
        avatarData: new Uint8Array([1, 2, 3]),
        voiceEnabled: false,
        imageEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.llmConfig.findFirst.mockResolvedValue(null);

      const response = await request(app).post('/admin/personality').send({
        name: 'Test Bot',
        slug: 'test-bot-avatar',
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
        avatarData:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      });

      expect(response.status).toBe(201);
      expect(response.body.personality.hasAvatar).toBe(true);
      expect(optimizeAvatar).toHaveBeenCalled();
    });

    it('should handle avatar processing errors', async () => {
      const { optimizeAvatar } = await import('../../utils/imageProcessor.js');
      prisma.personality.findUnique.mockResolvedValue(null);
      vi.mocked(optimizeAvatar).mockRejectedValueOnce(new Error('Invalid image format'));

      const response = await request(app).post('/admin/personality').send({
        name: 'Test Bot',
        slug: 'test-bot-bad-avatar',
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
        avatarData: 'invalid-base64-data',
      });

      // PROCESSING_ERROR returns 500 (server-side processing failure)
      expect(response.status).toBe(500);
      expect(response.body.message).toContain('Failed to process avatar');
    });
  });

  describe('default LLM config', () => {
    it('should assign default LLM config when available', async () => {
      prisma.personality.findUnique.mockResolvedValue(null);
      prisma.personality.create.mockResolvedValue({
        id: 'personality-llm-123',
        name: 'Test Bot',
        slug: 'test-bot-llm',
        displayName: null,
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        customFields: null,
        avatarData: null,
        voiceEnabled: false,
        imageEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.llmConfig.findFirst.mockResolvedValue({
        id: 'llm-config-123',
        name: 'Default Model',
        isGlobal: true,
        isDefault: true,
      });
      prisma.personalityDefaultConfig.create.mockResolvedValue({
        id: 'default-config-123',
        personalityId: 'personality-llm-123',
        llmConfigId: 'llm-config-123',
      });

      const response = await request(app).post('/admin/personality').send({
        name: 'Test Bot',
        slug: 'test-bot-llm',
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
      });

      expect(response.status).toBe(201);
      expect(prisma.llmConfig.findFirst).toHaveBeenCalledWith({
        where: {
          isGlobal: true,
          isDefault: true,
        },
      });
      expect(prisma.personalityDefaultConfig.create).toHaveBeenCalledWith({
        data: {
          personalityId: 'personality-llm-123',
          llmConfigId: 'llm-config-123',
        },
      });
    });

    it('should succeed even when LLM config assignment fails', async () => {
      prisma.personality.findUnique.mockResolvedValue(null);
      prisma.personality.create.mockResolvedValue({
        id: 'personality-llm-fail',
        name: 'Test Bot',
        slug: 'test-bot-llm-fail',
        displayName: null,
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        customFields: null,
        avatarData: null,
        voiceEnabled: false,
        imageEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.llmConfig.findFirst.mockResolvedValue({
        id: 'llm-config-123',
        name: 'Default Model',
        isGlobal: true,
        isDefault: true,
      });
      prisma.personalityDefaultConfig.create.mockRejectedValue(
        new Error('Database constraint violation')
      );

      const response = await request(app).post('/admin/personality').send({
        name: 'Test Bot',
        slug: 'test-bot-llm-fail',
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
      });

      // Should still succeed - LLM config error is non-critical
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });
  });

  describe('default system prompt', () => {
    it('should assign default system prompt when available', async () => {
      prisma.personality.findUnique.mockResolvedValue(null);
      prisma.systemPrompt.findFirst.mockResolvedValue({
        id: 'system-prompt-123',
      });
      prisma.personality.create.mockResolvedValue({
        id: 'personality-sp-123',
        name: 'Test Bot',
        slug: 'test-bot-sp',
        displayName: null,
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        customFields: null,
        avatarData: null,
        voiceEnabled: false,
        imageEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.llmConfig.findFirst.mockResolvedValue(null);

      const response = await request(app).post('/admin/personality').send({
        name: 'Test Bot',
        slug: 'test-bot-sp',
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
      });

      expect(response.status).toBe(201);
      expect(prisma.systemPrompt.findFirst).toHaveBeenCalledWith({
        where: { isDefault: true },
        select: { id: true },
      });
      expect(prisma.personality.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          systemPromptId: 'system-prompt-123',
        }),
      });
    });

    it('should set systemPromptId to null when no default exists', async () => {
      prisma.personality.findUnique.mockResolvedValue(null);
      prisma.systemPrompt.findFirst.mockResolvedValue(null);
      prisma.personality.create.mockResolvedValue({
        id: 'personality-no-sp',
        name: 'Test Bot',
        slug: 'test-bot-no-sp',
        displayName: null,
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        customFields: null,
        avatarData: null,
        voiceEnabled: false,
        imageEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.llmConfig.findFirst.mockResolvedValue(null);

      const response = await request(app).post('/admin/personality').send({
        name: 'Test Bot',
        slug: 'test-bot-no-sp',
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
      });

      expect(response.status).toBe(201);
      expect(prisma.personality.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          systemPromptId: null,
        }),
      });
    });
  });

  describe('errorMessage field', () => {
    it('should save errorMessage when provided', async () => {
      prisma.personality.findUnique.mockResolvedValue(null);
      prisma.personality.create.mockResolvedValue({
        id: 'personality-err-123',
        name: 'Test Bot',
        slug: 'test-bot-err',
        displayName: null,
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
        errorMessage: 'Custom error message',
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        customFields: null,
        avatarData: null,
        voiceEnabled: false,
        imageEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.llmConfig.findFirst.mockResolvedValue(null);

      const response = await request(app).post('/admin/personality').send({
        name: 'Test Bot',
        slug: 'test-bot-err',
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
        errorMessage: 'Custom error message',
      });

      expect(response.status).toBe(201);
      expect(prisma.personality.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          errorMessage: 'Custom error message',
        }),
      });
    });

    it('should set errorMessage to null when not provided', async () => {
      prisma.personality.findUnique.mockResolvedValue(null);
      prisma.personality.create.mockResolvedValue({
        id: 'personality-no-err',
        name: 'Test Bot',
        slug: 'test-bot-no-err',
        displayName: null,
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
        errorMessage: null,
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        customFields: null,
        avatarData: null,
        voiceEnabled: false,
        imageEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.llmConfig.findFirst.mockResolvedValue(null);

      const response = await request(app).post('/admin/personality').send({
        name: 'Test Bot',
        slug: 'test-bot-no-err',
        characterInfo: 'A helpful assistant',
        personalityTraits: 'Friendly',
      });

      expect(response.status).toBe(201);
      expect(prisma.personality.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          errorMessage: null,
        }),
      });
    });
  });

  describe('isPublic field', () => {
    it('should create personality with isPublic: true', async () => {
      prisma.personality.findUnique.mockResolvedValue(null);
      prisma.personality.create.mockResolvedValue({
        id: 'personality-public',
        name: 'Public Bot',
        slug: 'public-bot',
        displayName: null,
        characterInfo: 'A public assistant',
        personalityTraits: 'Friendly',
        isPublic: true,
        errorMessage: null,
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        customFields: null,
        avatarData: null,
        voiceEnabled: false,
        imageEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.llmConfig.findFirst.mockResolvedValue(null);

      const response = await request(app).post('/admin/personality').send({
        name: 'Public Bot',
        slug: 'public-bot',
        characterInfo: 'A public assistant',
        personalityTraits: 'Friendly',
        isPublic: true,
      });

      expect(response.status).toBe(201);
      expect(prisma.personality.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isPublic: true,
        }),
      });
    });

    it('should default isPublic to false when not provided', async () => {
      prisma.personality.findUnique.mockResolvedValue(null);
      prisma.personality.create.mockResolvedValue({
        id: 'personality-private',
        name: 'Private Bot',
        slug: 'private-bot',
        displayName: null,
        characterInfo: 'A private assistant',
        personalityTraits: 'Friendly',
        isPublic: false,
        errorMessage: null,
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        customFields: null,
        avatarData: null,
        voiceEnabled: false,
        imageEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.llmConfig.findFirst.mockResolvedValue(null);

      const response = await request(app).post('/admin/personality').send({
        name: 'Private Bot',
        slug: 'private-bot',
        characterInfo: 'A private assistant',
        personalityTraits: 'Friendly',
      });

      expect(response.status).toBe(201);
      expect(prisma.personality.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isPublic: false,
        }),
      });
    });
  });

  describe('cache invalidation', () => {
    it('should invalidate cache when creating public personality', async () => {
      const mockCacheService = {
        invalidateAll: vi.fn().mockResolvedValue(undefined),
        invalidatePersonality: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
        publish: vi.fn().mockResolvedValue(undefined),
      } as unknown as CacheInvalidationService;

      // Create new app with cache service
      const appWithCache = express();
      appWithCache.use(express.json());
      appWithCache.use(
        '/admin/personality',
        createCreatePersonalityRoute(prisma as unknown as PrismaClient, mockCacheService)
      );

      prisma.personality.findUnique.mockResolvedValue(null);
      prisma.personality.create.mockResolvedValue({
        id: 'personality-public-cache',
        name: 'Public Bot',
        slug: 'public-bot-cache',
        displayName: null,
        characterInfo: 'A public assistant',
        personalityTraits: 'Friendly',
        isPublic: true,
        errorMessage: null,
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        customFields: null,
        avatarData: null,
        voiceEnabled: false,
        imageEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.llmConfig.findFirst.mockResolvedValue(null);

      const response = await request(appWithCache).post('/admin/personality').send({
        name: 'Public Bot',
        slug: 'public-bot-cache',
        characterInfo: 'A public assistant',
        personalityTraits: 'Friendly',
        isPublic: true,
      });

      expect(response.status).toBe(201);
      expect(mockCacheService.invalidateAll).toHaveBeenCalled();
    });

    it('should not invalidate cache when creating private personality', async () => {
      const mockCacheService = {
        invalidateAll: vi.fn().mockResolvedValue(undefined),
        invalidatePersonality: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
        publish: vi.fn().mockResolvedValue(undefined),
      } as unknown as CacheInvalidationService;

      const appWithCache = express();
      appWithCache.use(express.json());
      appWithCache.use(
        '/admin/personality',
        createCreatePersonalityRoute(prisma as unknown as PrismaClient, mockCacheService)
      );

      prisma.personality.findUnique.mockResolvedValue(null);
      prisma.personality.create.mockResolvedValue({
        id: 'personality-private-cache',
        name: 'Private Bot',
        slug: 'private-bot-cache',
        displayName: null,
        characterInfo: 'A private assistant',
        personalityTraits: 'Friendly',
        isPublic: false,
        errorMessage: null,
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        customFields: null,
        avatarData: null,
        voiceEnabled: false,
        imageEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.llmConfig.findFirst.mockResolvedValue(null);

      const response = await request(appWithCache).post('/admin/personality').send({
        name: 'Private Bot',
        slug: 'private-bot-cache',
        characterInfo: 'A private assistant',
        personalityTraits: 'Friendly',
        isPublic: false,
      });

      expect(response.status).toBe(201);
      expect(mockCacheService.invalidateAll).not.toHaveBeenCalled();
    });

    it('should handle cache invalidation errors gracefully', async () => {
      const mockCacheService = {
        invalidateAll: vi.fn().mockRejectedValue(new Error('Redis connection failed')),
        invalidatePersonality: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
        publish: vi.fn().mockResolvedValue(undefined),
      } as unknown as CacheInvalidationService;

      const appWithCache = express();
      appWithCache.use(express.json());
      appWithCache.use(
        '/admin/personality',
        createCreatePersonalityRoute(prisma as unknown as PrismaClient, mockCacheService)
      );

      prisma.personality.findUnique.mockResolvedValue(null);
      prisma.personality.create.mockResolvedValue({
        id: 'personality-cache-fail',
        name: 'Cache Fail Bot',
        slug: 'cache-fail-bot',
        displayName: null,
        characterInfo: 'A test assistant',
        personalityTraits: 'Friendly',
        isPublic: true,
        errorMessage: null,
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        customFields: null,
        avatarData: null,
        voiceEnabled: false,
        imageEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.llmConfig.findFirst.mockResolvedValue(null);

      // Should still succeed even if cache invalidation fails
      const response = await request(appWithCache).post('/admin/personality').send({
        name: 'Cache Fail Bot',
        slug: 'cache-fail-bot',
        characterInfo: 'A test assistant',
        personalityTraits: 'Friendly',
        isPublic: true,
      });

      expect(response.status).toBe(201);
      expect(mockCacheService.invalidateAll).toHaveBeenCalled();
    });
  });
});
