/**
 * Tests for Avatar Processing Utility
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Attachment } from 'discord.js';
import { processAvatarAttachment, AvatarProcessingError } from './avatarProcessor.js';
import { DISCORD_LIMITS } from '@tzurot/common-types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Create mock attachment factory
const createMockAttachment = (overrides: Partial<Attachment> = {}): Attachment => {
  return {
    contentType: 'image/png',
    size: 1024 * 1024, // 1MB
    url: 'https://cdn.discordapp.com/attachments/123/456/avatar.png',
    name: 'avatar.png',
    ...overrides,
  } as Attachment;
};

describe('processAvatarAttachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validation', () => {
    it('should reject non-image files', async () => {
      const attachment = createMockAttachment({
        contentType: 'application/pdf',
      });

      await expect(processAvatarAttachment(attachment)).rejects.toThrow(AvatarProcessingError);
      await expect(processAvatarAttachment(attachment)).rejects.toThrow(
        '❌ Avatar must be an image file (PNG, JPEG, etc.)'
      );

      try {
        await processAvatarAttachment(attachment);
      } catch (error) {
        expect((error as AvatarProcessingError).code).toBe('INVALID_FILE_TYPE');
      }
    });

    it('should reject files with no contentType', async () => {
      const attachment = createMockAttachment({
        contentType: undefined,
      });

      await expect(processAvatarAttachment(attachment)).rejects.toThrow(AvatarProcessingError);
      await expect(processAvatarAttachment(attachment)).rejects.toThrow(
        '❌ Avatar must be an image file (PNG, JPEG, etc.)'
      );
    });

    it('should reject files with null contentType', async () => {
      const attachment = createMockAttachment({
        contentType: null as any,
      });

      await expect(processAvatarAttachment(attachment)).rejects.toThrow(AvatarProcessingError);
      await expect(processAvatarAttachment(attachment)).rejects.toThrow(
        '❌ Avatar must be an image file (PNG, JPEG, etc.)'
      );
    });

    it('should reject files exceeding size limit', async () => {
      const attachment = createMockAttachment({
        size: DISCORD_LIMITS.AVATAR_SIZE + 1,
      });

      await expect(processAvatarAttachment(attachment)).rejects.toThrow(AvatarProcessingError);
      await expect(processAvatarAttachment(attachment)).rejects.toThrow(
        '❌ Avatar file is too large (max 10MB)'
      );

      try {
        await processAvatarAttachment(attachment);
      } catch (error) {
        expect((error as AvatarProcessingError).code).toBe('FILE_TOO_LARGE');
      }
    });

    it('should accept image files within size limit', async () => {
      const attachment = createMockAttachment({
        contentType: 'image/jpeg',
        size: DISCORD_LIMITS.AVATAR_SIZE,
      });

      // Mock successful fetch
      const imageData = Buffer.from('fake-image-data');
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => imageData,
      });

      const result = await processAvatarAttachment(attachment);
      expect(result).toBe(imageData.toString('base64'));
    });

    it('should accept all image/* content types', async () => {
      const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

      for (const contentType of imageTypes) {
        const attachment = createMockAttachment({ contentType });

        const imageData = Buffer.from('fake-image-data');
        mockFetch.mockResolvedValue({
          ok: true,
          arrayBuffer: async () => imageData,
        });

        const result = await processAvatarAttachment(attachment);
        expect(result).toBe(imageData.toString('base64'));
      }
    });
  });

  describe('download', () => {
    it('should download and convert image to base64', async () => {
      const attachment = createMockAttachment();
      const imageData = Buffer.from('test-image-data-12345');

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => imageData,
      });

      const result = await processAvatarAttachment(attachment);

      expect(mockFetch).toHaveBeenCalledWith(attachment.url);
      expect(result).toBe(imageData.toString('base64'));
    });

    it('should handle HTTP error responses', async () => {
      const attachment = createMockAttachment();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(processAvatarAttachment(attachment)).rejects.toThrow(AvatarProcessingError);
      await expect(processAvatarAttachment(attachment)).rejects.toThrow(
        '❌ Failed to download avatar image'
      );

      try {
        await processAvatarAttachment(attachment);
      } catch (error) {
        expect((error as AvatarProcessingError).code).toBe('DOWNLOAD_FAILED');
      }
    });

    it('should handle network errors', async () => {
      const attachment = createMockAttachment();

      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(processAvatarAttachment(attachment)).rejects.toThrow(AvatarProcessingError);
      await expect(processAvatarAttachment(attachment)).rejects.toThrow(
        '❌ Failed to download avatar image'
      );
    });

    it('should handle fetch timeout errors', async () => {
      const attachment = createMockAttachment();

      mockFetch.mockRejectedValue(new Error('Request timeout'));

      await expect(processAvatarAttachment(attachment)).rejects.toThrow(AvatarProcessingError);
    });
  });

  describe('logging context', () => {
    it('should use default context when not provided', async () => {
      const attachment = createMockAttachment();
      const imageData = Buffer.from('test-data');

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => imageData,
      });

      // Just verify it doesn't throw - logging is tested via integration
      await expect(processAvatarAttachment(attachment)).resolves.toBeDefined();
    });

    it('should use custom context when provided', async () => {
      const attachment = createMockAttachment();
      const imageData = Buffer.from('test-data');

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => imageData,
      });

      // Just verify it doesn't throw - logging is tested via integration
      await expect(
        processAvatarAttachment(attachment, 'Personality Create')
      ).resolves.toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle empty image data', async () => {
      const attachment = createMockAttachment();
      const imageData = Buffer.from('');

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => imageData,
      });

      const result = await processAvatarAttachment(attachment);
      expect(result).toBe('');
    });

    it('should handle large valid images', async () => {
      const attachment = createMockAttachment({
        size: DISCORD_LIMITS.AVATAR_SIZE, // Exactly at limit
      });
      const imageData = Buffer.alloc(DISCORD_LIMITS.AVATAR_SIZE, 'a');

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: async () => imageData,
      });

      const result = await processAvatarAttachment(attachment);
      expect(result).toBe(imageData.toString('base64'));
    });
  });
});
