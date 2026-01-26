/**
 * Avatar Route Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { StatusCodes } from 'http-status-codes';

// Use vi.hoisted to create mock functions before they're used in vi.mock
const { mockAccess, mockWriteFile } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockWriteFile: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  access: mockAccess,
  writeFile: mockWriteFile,
}));

// Mock common-types
vi.mock('@tzurot/common-types', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  CONTENT_TYPES: {
    IMAGE_PNG: 'image/png',
  },
  CACHE_CONTROL: {
    AVATAR_MAX_AGE: 604800, // 7 days
  },
}));

// Mock errorResponses
vi.mock('../../utils/errorResponses.js', () => ({
  ErrorResponses: {
    validationError: vi.fn((message: string) => ({ error: 'Validation Error', message })),
    notFound: vi.fn((resource: string) => ({
      error: 'Not Found',
      message: `${resource} not found`,
    })),
    internalError: vi.fn((message: string) => ({ error: 'Internal Error', message })),
  },
}));

import { createAvatarRouter } from './avatars.js';

// Mock Prisma client
function createMockPrisma() {
  return {
    personality: {
      findUnique: vi.fn(),
    },
  };
}

describe('Avatar Routes', () => {
  let app: express.Express;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    app = express();
    app.use('/avatars', createAvatarRouter(mockPrisma as never));
  });

  describe('GET /:slug.png', () => {
    it('should reject slug with special characters', async () => {
      // Note: Path traversal attempts like '../etc/passwd' don't match the route pattern
      // Express returns 404 for those. This test validates special characters in the slug.
      const response = await request(app).get('/avatars/test<script>.png');

      expect(response.status).toBe(StatusCodes.BAD_REQUEST);
      expect(response.body.error).toBe('Validation Error');
    });

    it('should accept valid slug with letters, numbers, underscores, and hyphens', async () => {
      mockAccess.mockResolvedValue(undefined);

      // This will fail with ENOENT since we're not actually serving files
      // but it should pass validation
      const response = await request(app).get('/avatars/test-bot_123.png');

      // Should not be a validation error
      expect(response.body.error).not.toBe('Validation Error');
    });

    it('should return 404 when avatar not found in filesystem or database', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      const response = await request(app).get('/avatars/nonexistent.png');

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
      expect(response.body.error).toBe('Not Found');
    });

    it('should return 404 when personality exists but has no avatar data', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockPrisma.personality.findUnique.mockResolvedValue({
        avatarData: null,
      });

      const response = await request(app).get('/avatars/testbot.png');

      expect(response.status).toBe(StatusCodes.NOT_FOUND);
    });

    it('should serve avatar from database and cache to filesystem with versioned filename', async () => {
      const avatarBuffer = Buffer.from('fake-png-data');
      const updatedAt = new Date('2024-01-20T10:00:00.000Z');

      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockPrisma.personality.findUnique.mockResolvedValue({
        avatarData: avatarBuffer,
        updatedAt,
      });
      mockWriteFile.mockResolvedValue(undefined);

      const response = await request(app).get('/avatars/testbot.png');

      expect(response.status).toBe(StatusCodes.OK);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toContain('max-age=604800');

      // Should cache to filesystem with versioned filename
      expect(mockWriteFile).toHaveBeenCalledWith(
        `/data/avatars/testbot-${updatedAt.getTime()}.png`,
        avatarBuffer
      );
    });

    it('should handle database error gracefully', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockPrisma.personality.findUnique.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app).get('/avatars/testbot.png');

      expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
      expect(response.body.error).toBe('Internal Error');
    });

    it('should return 500 if filesystem cache write fails', async () => {
      // Note: Current implementation awaits writeFile before sending response,
      // so if caching fails, the request fails with 500. This is a known behavior.
      const avatarBuffer = Buffer.from('fake-png-data');

      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockPrisma.personality.findUnique.mockResolvedValue({
        avatarData: avatarBuffer,
        updatedAt: new Date(),
      });
      mockWriteFile.mockRejectedValue(new Error('Disk full'));

      const response = await request(app).get('/avatars/testbot.png');

      expect(response.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
      expect(response.body.error).toBe('Internal Error');
    });

    it('should query database with correct slug and select updatedAt', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockPrisma.personality.findUnique.mockResolvedValue(null);

      await request(app).get('/avatars/my-personality.png');

      expect(mockPrisma.personality.findUnique).toHaveBeenCalledWith({
        where: { slug: 'my-personality' },
        select: { avatarData: true, updatedAt: true },
      });
    });
  });
});
