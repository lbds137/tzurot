/**
 * Update Personality Route Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createUpdatePersonalityRoute } from './updatePersonality.js';
import type { PrismaClient, CacheInvalidationService } from '@tzurot/common-types';
import { optimizeAvatar } from '../../utils/imageProcessor.js';

// Mock AuthMiddleware
vi.mock('../../services/AuthMiddleware.js', () => ({
  requireOwnerAuth: () => (_req: unknown, _res: unknown, next: () => void) => {
    next(); // Bypass auth for testing
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
  llmConfig: {
    findFirst: vi.fn(),
  },
  personalityDefaultConfig: {
    create: vi.fn(),
  },
});

describe('PATCH /admin/personality/:slug', () => {
  let app: Express;
  let prisma: ReturnType<typeof createMockPrismaClient>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock Prisma client
    prisma = createMockPrismaClient();

    // Create Express app with update personality router
    app = express();
    app.use(express.json());
    app.use('/admin/personality', createUpdatePersonalityRoute(prisma as unknown as PrismaClient));
  });

  describe('successful updates', () => {
    it('should update an existing personality', async () => {
      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: false,
      } as never);
      prisma.personality.update.mockResolvedValue({
        id: 'personality-123',
        name: 'Updated Bot',
        slug: 'test-bot',
        displayName: null,
        avatarData: null,
      } as never);

      const response = await request(app).patch('/admin/personality/test-bot').send({
        name: 'Updated Bot',
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.personality.name).toBe('Updated Bot');
      expect(prisma.personality.update).toHaveBeenCalledWith({
        where: { slug: 'test-bot' },
        data: { name: 'Updated Bot' },
      });
    });

    it('should update multiple fields at once', async () => {
      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: false,
      } as never);
      prisma.personality.update.mockResolvedValue({
        id: 'personality-123',
        name: 'Updated Bot',
        slug: 'test-bot',
        displayName: 'Display Name',
        characterInfo: 'New info',
        personalityTraits: 'Friendly',
        avatarData: null,
      } as never);

      const response = await request(app).patch('/admin/personality/test-bot').send({
        name: 'Updated Bot',
        displayName: 'Display Name',
        characterInfo: 'New info',
        personalityTraits: 'Friendly',
        personalityTone: 'Casual',
        personalityAge: '25',
        personalityAppearance: 'Tall',
        personalityLikes: 'Music',
        personalityDislikes: 'Spam',
        conversationalGoals: 'Help users',
        conversationalExamples: 'Hi there!',
      });

      expect(response.status).toBe(200);
      expect(prisma.personality.update).toHaveBeenCalledWith({
        where: { slug: 'test-bot' },
        data: {
          name: 'Updated Bot',
          displayName: 'Display Name',
          characterInfo: 'New info',
          personalityTraits: 'Friendly',
          personalityTone: 'Casual',
          personalityAge: '25',
          personalityAppearance: 'Tall',
          personalityLikes: 'Music',
          personalityDislikes: 'Spam',
          conversationalGoals: 'Help users',
          conversationalExamples: 'Hi there!',
        },
      });
    });

    it('should update customFields', async () => {
      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: false,
      } as never);
      prisma.personality.update.mockResolvedValue({
        id: 'personality-123',
        name: 'Test Bot',
        slug: 'test-bot',
        displayName: null,
        avatarData: null,
      } as never);

      const customFields = { key1: 'value1', key2: 123 };
      const response = await request(app).patch('/admin/personality/test-bot').send({
        customFields,
      });

      expect(response.status).toBe(200);
      expect(prisma.personality.update).toHaveBeenCalledWith({
        where: { slug: 'test-bot' },
        data: { customFields },
      });
    });

    it('should update avatar and return hasAvatar true', async () => {
      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: false,
      } as never);
      prisma.personality.update.mockResolvedValue({
        id: 'personality-123',
        name: 'Test Bot',
        slug: 'test-bot',
        displayName: null,
        avatarData: Buffer.from('avatar-data'),
      } as never);

      const response = await request(app).patch('/admin/personality/test-bot').send({
        avatarData: 'base64-image-data',
      });

      expect(response.status).toBe(200);
      expect(response.body.personality.hasAvatar).toBe(true);
      expect(optimizeAvatar).toHaveBeenCalledWith('base64-image-data');
    });

    it('should handle avatar that exceeds target size (warning only)', async () => {
      vi.mocked(optimizeAvatar).mockResolvedValueOnce({
        buffer: Buffer.from('large-image'),
        originalSizeKB: 500,
        processedSizeKB: 300,
        quality: 60,
        exceedsTarget: true,
      });

      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: false,
      } as never);
      prisma.personality.update.mockResolvedValue({
        id: 'personality-123',
        name: 'Test Bot',
        slug: 'test-bot',
        displayName: null,
        avatarData: Buffer.from('large-image'),
      } as never);

      const response = await request(app).patch('/admin/personality/test-bot').send({
        avatarData: 'large-base64-image',
      });

      // Should still succeed, just logs a warning
      expect(response.status).toBe(200);
      expect(response.body.personality.hasAvatar).toBe(true);
    });
  });

  describe('validation errors', () => {
    it('should return 404 when personality does not exist', async () => {
      prisma.personality.findUnique.mockResolvedValue(null);

      const response = await request(app).patch('/admin/personality/nonexistent').send({
        name: 'Updated Bot',
      });

      expect(response.status).toBe(404);
      expect(response.body.error).toBeDefined();
    });

    it('should return 400 for reserved slug', async () => {
      const response = await request(app).patch('/admin/personality/admin').send({
        name: 'Updated Bot',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('reserved');
    });

    it('should return 400 for invalid slug format', async () => {
      const response = await request(app).patch('/admin/personality/Invalid_Slug!').send({
        name: 'Updated Bot',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid customFields (non-object)', async () => {
      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: false,
      } as never);

      // customFields must be an object, not a primitive
      const response = await request(app).patch('/admin/personality/test-bot').send({
        customFields: 'invalid-string-value',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VALIDATION_ERROR');
    });

    it('should allow null customFields to clear the field', async () => {
      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: false,
      } as never);
      prisma.personality.update.mockResolvedValue({
        id: 'personality-123',
        name: 'Test Bot',
        slug: 'test-bot',
        displayName: null,
        avatarData: null,
      } as never);

      const response = await request(app).patch('/admin/personality/test-bot').send({
        customFields: null,
      });

      expect(response.status).toBe(200);
      expect(prisma.personality.update).toHaveBeenCalledWith({
        where: { slug: 'test-bot' },
        data: { customFields: null },
      });
    });
  });

  describe('avatar processing errors', () => {
    it('should return 500 when avatar processing fails', async () => {
      vi.mocked(optimizeAvatar).mockRejectedValueOnce(new Error('Invalid image format'));

      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: false,
      } as never);

      const response = await request(app).patch('/admin/personality/test-bot').send({
        avatarData: 'invalid-image-data',
      });

      expect(response.status).toBe(500);
      expect(response.body.message).toContain('Failed to process avatar');
    });

    it('should skip avatar processing for empty avatarData', async () => {
      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: false,
      } as never);
      prisma.personality.update.mockResolvedValue({
        id: 'personality-123',
        name: 'Updated Bot',
        slug: 'test-bot',
        displayName: null,
        avatarData: null,
      } as never);

      const response = await request(app).patch('/admin/personality/test-bot').send({
        name: 'Updated Bot',
        avatarData: '',
      });

      expect(response.status).toBe(200);
      expect(optimizeAvatar).not.toHaveBeenCalled();
    });
  });

  describe('isPublic field', () => {
    it('should update personality with isPublic: true', async () => {
      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: false,
      } as never);
      prisma.personality.update.mockResolvedValue({
        id: 'personality-123',
        name: 'Test Bot',
        slug: 'test-bot',
        displayName: null,
        avatarData: null,
        isPublic: true,
      } as never);

      const response = await request(app).patch('/admin/personality/test-bot').send({
        isPublic: true,
      });

      expect(response.status).toBe(200);
      expect(prisma.personality.update).toHaveBeenCalledWith({
        where: { slug: 'test-bot' },
        data: { isPublic: true },
      });
    });

    it('should update personality with isPublic: false', async () => {
      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: true,
      } as never);
      prisma.personality.update.mockResolvedValue({
        id: 'personality-123',
        name: 'Test Bot',
        slug: 'test-bot',
        displayName: null,
        avatarData: null,
        isPublic: false,
      } as never);

      const response = await request(app).patch('/admin/personality/test-bot').send({
        isPublic: false,
      });

      expect(response.status).toBe(200);
      expect(prisma.personality.update).toHaveBeenCalledWith({
        where: { slug: 'test-bot' },
        data: { isPublic: false },
      });
    });
  });

  describe('cache invalidation', () => {
    let mockCacheService: CacheInvalidationService;
    let appWithCache: Express;

    beforeEach(() => {
      mockCacheService = {
        invalidateAll: vi.fn().mockResolvedValue(undefined),
        invalidatePersonality: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
        publish: vi.fn().mockResolvedValue(undefined),
      } as unknown as CacheInvalidationService;

      appWithCache = express();
      appWithCache.use(express.json());
      appWithCache.use(
        '/admin/personality',
        createUpdatePersonalityRoute(prisma as unknown as PrismaClient, mockCacheService)
      );
    });

    it('should invalidate all caches when visibility changes from private to public', async () => {
      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: false, // Was private
      } as never);
      prisma.personality.update.mockResolvedValue({
        id: 'personality-123',
        name: 'Test Bot',
        slug: 'test-bot',
        displayName: null,
        avatarData: null,
      } as never);

      await request(appWithCache).patch('/admin/personality/test-bot').send({
        isPublic: true, // Now public
      });

      expect(mockCacheService.invalidateAll).toHaveBeenCalled();
      expect(mockCacheService.invalidatePersonality).not.toHaveBeenCalled();
    });

    it('should invalidate all caches when visibility changes from public to private', async () => {
      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: true, // Was public
      } as never);
      prisma.personality.update.mockResolvedValue({
        id: 'personality-123',
        name: 'Test Bot',
        slug: 'test-bot',
        displayName: null,
        avatarData: null,
      } as never);

      await request(appWithCache).patch('/admin/personality/test-bot').send({
        isPublic: false, // Now private
      });

      expect(mockCacheService.invalidateAll).toHaveBeenCalled();
      expect(mockCacheService.invalidatePersonality).not.toHaveBeenCalled();
    });

    it('should invalidate all caches when updating a public personality (visibility unchanged)', async () => {
      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: true, // Was public
      } as never);
      prisma.personality.update.mockResolvedValue({
        id: 'personality-123',
        name: 'Updated Public Bot',
        slug: 'test-bot',
        displayName: null,
        avatarData: null,
      } as never);

      await request(appWithCache).patch('/admin/personality/test-bot').send({
        name: 'Updated Public Bot', // No visibility change
      });

      // Should still invalidate all since the personality is public
      expect(mockCacheService.invalidateAll).toHaveBeenCalled();
      expect(mockCacheService.invalidatePersonality).not.toHaveBeenCalled();
    });

    it('should only invalidate specific personality when updating a private personality (visibility unchanged)', async () => {
      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: false, // Was private
      } as never);
      prisma.personality.update.mockResolvedValue({
        id: 'personality-123',
        name: 'Updated Private Bot',
        slug: 'test-bot',
        displayName: null,
        avatarData: null,
      } as never);

      await request(appWithCache).patch('/admin/personality/test-bot').send({
        name: 'Updated Private Bot', // No visibility change
      });

      // Should only invalidate this specific personality
      expect(mockCacheService.invalidatePersonality).toHaveBeenCalledWith('personality-123');
      expect(mockCacheService.invalidateAll).not.toHaveBeenCalled();
    });

    it('should handle cache invalidation errors gracefully', async () => {
      mockCacheService.invalidateAll = vi
        .fn()
        .mockRejectedValue(new Error('Redis connection lost'));

      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: false,
      } as never);
      prisma.personality.update.mockResolvedValue({
        id: 'personality-123',
        name: 'Test Bot',
        slug: 'test-bot',
        displayName: null,
        avatarData: null,
      } as never);

      const response = await request(appWithCache).patch('/admin/personality/test-bot').send({
        isPublic: true,
      });

      // Should still succeed even if cache invalidation fails
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should not invalidate cache when no cache service is provided', async () => {
      prisma.personality.findUnique.mockResolvedValue({
        id: 'personality-123',
        slug: 'test-bot',
        isPublic: false,
      } as never);
      prisma.personality.update.mockResolvedValue({
        id: 'personality-123',
        name: 'Test Bot',
        slug: 'test-bot',
        displayName: null,
        avatarData: null,
      } as never);

      // Use the original app without cache service
      const response = await request(app).patch('/admin/personality/test-bot').send({
        isPublic: true,
      });

      expect(response.status).toBe(200);
      // No errors even though cache service is undefined
    });
  });
});
