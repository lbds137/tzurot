/**
 * Tests for PUT /user/personality/:slug (update personality)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types';
import {
  createMockPrisma,
  createMockPersonality,
  createMockReqRes,
  getHandler,
  setupStandardMocks,
  mockIsBotOwner,
} from './test-utils.js';

// Mock dependencies before imports
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  const { mockIsBotOwner: mockFn } = await import('./test-utils.js');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    isBotOwner: (...args: unknown[]) => (mockFn as (...args: unknown[]) => boolean)(...args),
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
  readdir: vi.fn(),
}));
import * as fsPromises from 'fs/promises';
const mockUnlink = vi.mocked(fsPromises.unlink);
const mockReaddir = vi.mocked(fsPromises.readdir);

import { createPersonalityRoutes } from './index.js';

describe('PUT /user/personality/:slug (update)', () => {
  const mockPrisma = createMockPrisma();

  beforeEach(() => {
    vi.clearAllMocks();
    setupStandardMocks(mockPrisma);
    mockUnlink.mockReset();
    mockReaddir.mockReset();
    // Default: empty avatar directory
    mockReaddir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>);
  });

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
      select: expect.objectContaining({
        id: true,
        name: true,
        slug: true,
        displayName: true,
      }),
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
    // User has co-ownership entry in PersonalityOwner table
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

    it('should delete cached avatar files when avatar is updated', async () => {
      // Mock readdir to return files for this slug (versioned and legacy)
      mockReaddir.mockResolvedValue([
        'test-char-1705827727111.png',
        'test-char.png',
        'other-slug.png',
      ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>);
      mockUnlink.mockResolvedValue(undefined);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes(
        { name: 'Updated', avatarData: 'data:image/png;base64,iVBORw0KGgo=' },
        { slug: 'test-char' }
      );

      await handler(req, res);

      // Should delete all versions for this slug
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/test-char-1705827727111.png');
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/test-char.png');
      // Should NOT delete other slugs
      expect(mockUnlink).not.toHaveBeenCalledWith('/data/avatars/other-slug.png');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should silently handle ENOENT when avatar directory does not exist', async () => {
      const enoentError = new Error('Directory not found') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      mockReaddir.mockRejectedValue(enoentError);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes(
        { name: 'Updated', avatarData: 'data:image/png;base64,iVBORw0KGgo=' },
        { slug: 'valid-slug' }
      );

      await handler(req, res);

      // Should not fail - ENOENT is expected when directory doesn't exist
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should silently handle ENOENT during individual file deletion', async () => {
      // File listed but deleted between readdir and unlink
      mockReaddir.mockResolvedValue(['valid-slug.png'] as unknown as Awaited<
        ReturnType<typeof fsPromises.readdir>
      >);
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

      // Should not fail - ENOENT during unlink is silently ignored
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should log warning for other filesystem errors but not fail', async () => {
      // Readdir errors other than ENOENT should be logged but not fail the request
      const permError = new Error('Permission denied') as NodeJS.ErrnoException;
      permError.code = 'EACCES';
      mockReaddir.mockRejectedValue(permError);

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
      // Invalid slugs should not trigger readdir at all
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

      // readdir/unlink should NOT be called for invalid slug
      expect(mockReaddir).not.toHaveBeenCalled();
      expect(mockUnlink).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('cache invalidation on avatar update', () => {
    beforeEach(() => {
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'personality-cache',
        ownerId: 'user-uuid-123',
        name: 'Test',
        avatarData: null,
      });
      mockPrisma.personality.update.mockResolvedValue(
        createMockPersonality({
          id: 'personality-cache',
          name: 'Test',
          slug: 'test-char',
          displayName: 'Test Display',
        })
      );
      mockUnlink.mockResolvedValue(undefined);
    });

    it('should call cache invalidation service when avatar is updated', async () => {
      const mockCacheInvalidationService = {
        invalidatePersonality: vi.fn().mockResolvedValue(undefined),
      } as unknown as import('@tzurot/common-types').CacheInvalidationService;

      const router = createPersonalityRoutes(
        mockPrisma as unknown as PrismaClient,
        mockCacheInvalidationService
      );
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes(
        { avatarData: 'data:image/png;base64,iVBORw0KGgo=' },
        { slug: 'test-char' }
      );

      await handler(req, res);

      expect(mockCacheInvalidationService.invalidatePersonality).toHaveBeenCalledWith(
        'personality-cache'
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should not fail when cache invalidation throws error', async () => {
      const mockCacheInvalidationService = {
        invalidatePersonality: vi.fn().mockRejectedValue(new Error('Cache service unavailable')),
      } as unknown as import('@tzurot/common-types').CacheInvalidationService;

      const router = createPersonalityRoutes(
        mockPrisma as unknown as PrismaClient,
        mockCacheInvalidationService
      );
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes(
        { avatarData: 'data:image/png;base64,iVBORw0KGgo=' },
        { slug: 'test-char' }
      );

      await handler(req, res);

      // Should still succeed - cache invalidation failure is non-fatal
      expect(mockCacheInvalidationService.invalidatePersonality).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should not call cache invalidation when no avatar update', async () => {
      const mockCacheInvalidationService = {
        invalidatePersonality: vi.fn().mockResolvedValue(undefined),
      } as unknown as import('@tzurot/common-types').CacheInvalidationService;

      const router = createPersonalityRoutes(
        mockPrisma as unknown as PrismaClient,
        mockCacheInvalidationService
      );
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes(
        { name: 'Updated Name' }, // No avatar update
        { slug: 'test-char' }
      );

      await handler(req, res);

      // Should not call cache invalidation for non-avatar updates
      expect(mockCacheInvalidationService.invalidatePersonality).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('slug update permissions (admin-only)', () => {
    beforeEach(() => {
      // Setup: user exists and owns the personality
      mockPrisma.personality.findUnique.mockResolvedValue({
        id: 'personality-slug-test',
        ownerId: 'user-uuid-123',
        name: 'Test Character',
      });
    });

    it('should reject slug update from non-admin user', async () => {
      mockIsBotOwner.mockReturnValue(false);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes(
        { slug: 'new-slug' }, // Attempting to change slug
        { slug: 'old-slug' }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Only bot admins'),
        })
      );
      // Should NOT have called update
      expect(mockPrisma.personality.update).not.toHaveBeenCalled();
    });

    it('should allow slug update from bot admin', async () => {
      mockIsBotOwner.mockReturnValue(true);
      // No existing personality with new slug
      mockPrisma.personality.findUnique
        .mockResolvedValueOnce({
          id: 'personality-slug-test',
          ownerId: 'user-uuid-123',
          name: 'Test Character',
        })
        .mockResolvedValueOnce(null); // Uniqueness check

      mockPrisma.personality.update.mockResolvedValue(
        createMockPersonality({
          id: 'personality-slug-test',
          name: 'Test Character',
          slug: 'new-slug',
          displayName: 'Test Character',
        })
      );

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes({ slug: 'new-slug' }, { slug: 'old-slug' });

      await handler(req, res);

      expect(mockPrisma.personality.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slug: 'new-slug',
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should invalidate cache when slug is updated', async () => {
      mockIsBotOwner.mockReturnValue(true);
      // Mock readdir to return files for both old and new slugs
      mockReaddir.mockResolvedValue([
        'old-slug-1705827727111.png',
        'old-slug.png',
        'new-slug-1705827727222.png',
        'other.png',
      ] as unknown as Awaited<ReturnType<typeof fsPromises.readdir>>);
      mockUnlink.mockResolvedValue(undefined);
      // No existing personality with new slug
      mockPrisma.personality.findUnique
        .mockResolvedValueOnce({
          id: 'personality-slug-test',
          ownerId: 'user-uuid-123',
          name: 'Test Character',
        })
        .mockResolvedValueOnce(null); // Uniqueness check

      mockPrisma.personality.update.mockResolvedValue(
        createMockPersonality({
          id: 'personality-slug-test',
          name: 'Test Character',
          slug: 'new-slug',
          displayName: 'Test Character',
        })
      );

      const mockCacheInvalidationService = {
        invalidatePersonality: vi.fn().mockResolvedValue(undefined),
      } as unknown as import('@tzurot/common-types').CacheInvalidationService;

      const router = createPersonalityRoutes(
        mockPrisma as unknown as PrismaClient,
        mockCacheInvalidationService
      );
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes({ slug: 'new-slug' }, { slug: 'old-slug' });

      await handler(req, res);

      // Should delete cached avatar for both old and new slugs (all versions)
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/old-slug-1705827727111.png');
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/old-slug.png');
      expect(mockUnlink).toHaveBeenCalledWith('/data/avatars/new-slug-1705827727222.png');
      // Should NOT delete other slugs
      expect(mockUnlink).not.toHaveBeenCalledWith('/data/avatars/other.png');
      // Should invalidate personality cache
      expect(mockCacheInvalidationService.invalidatePersonality).toHaveBeenCalledWith(
        'personality-slug-test'
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should reject invalid slug format', async () => {
      mockIsBotOwner.mockReturnValue(true);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes(
        { slug: 'Invalid Slug With Spaces!' }, // Invalid format
        { slug: 'old-slug' }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Invalid slug format'),
        })
      );
      expect(mockPrisma.personality.update).not.toHaveBeenCalled();
    });

    it('should reject duplicate slug', async () => {
      mockIsBotOwner.mockReturnValue(true);
      // Existing personality with requested slug
      mockPrisma.personality.findUnique
        .mockResolvedValueOnce({
          id: 'personality-slug-test',
          ownerId: 'user-uuid-123',
          name: 'Test Character',
        })
        .mockResolvedValueOnce({ id: 'other-personality' }); // Another personality has this slug

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes({ slug: 'taken-slug' }, { slug: 'old-slug' });

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('already in use'),
        })
      );
      expect(mockPrisma.personality.update).not.toHaveBeenCalled();
    });

    it('should allow same slug value (no actual change)', async () => {
      // When slug in body equals current slug, no admin check needed
      mockIsBotOwner.mockReturnValue(false); // Not an admin
      mockPrisma.personality.update.mockResolvedValue(
        createMockPersonality({
          id: 'personality-slug-test',
          name: 'Updated Name',
          slug: 'same-slug',
          displayName: 'Updated Name',
        })
      );

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes(
        { name: 'Updated Name', slug: 'same-slug' }, // Same slug as URL param
        { slug: 'same-slug' }
      );

      await handler(req, res);

      // Should succeed because slug isn't actually changing
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should reject reserved slug names', async () => {
      mockIsBotOwner.mockReturnValue(true);

      const router = createPersonalityRoutes(mockPrisma as unknown as PrismaClient);
      const handler = getHandler(router, 'put', '/:slug');
      const { req, res } = createMockReqRes(
        { slug: 'admin' }, // Reserved slug
        { slug: 'old-slug' }
      );

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('reserved'),
        })
      );
      expect(mockPrisma.personality.update).not.toHaveBeenCalled();
    });
  });
});
