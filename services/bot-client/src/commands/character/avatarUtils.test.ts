/**
 * Tests for Avatar Processing Utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processAvatarBuffer,
  VALID_IMAGE_TYPES,
  MAX_INPUT_SIZE_MB,
  MAX_INPUT_SIZE_BYTES,
  TARGET_SIZE_BYTES,
} from './avatarUtils.js';

// Mock sharp
vi.mock('sharp', () => ({
  default: vi.fn(),
}));

// Mock logger
vi.mock('@tzurot/common-types', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('Avatar Utils', () => {
  describe('Constants', () => {
    it('should have correct valid image types', () => {
      expect(VALID_IMAGE_TYPES).toContain('image/png');
      expect(VALID_IMAGE_TYPES).toContain('image/jpeg');
      expect(VALID_IMAGE_TYPES).toContain('image/gif');
      expect(VALID_IMAGE_TYPES).toContain('image/webp');
      expect(VALID_IMAGE_TYPES).toHaveLength(4);
    });

    it('should have 25MB max input size', () => {
      expect(MAX_INPUT_SIZE_MB).toBe(25);
      expect(MAX_INPUT_SIZE_BYTES).toBe(25 * 1024 * 1024);
    });

    it('should have 7MB target size for base64 payload', () => {
      expect(TARGET_SIZE_BYTES).toBe(7 * 1024 * 1024);
    });
  });

  describe('processAvatarBuffer', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return buffer as-is if under target size', async () => {
      const smallBuffer = Buffer.from('small image data');

      const result = await processAvatarBuffer(smallBuffer, 'test-context');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.buffer).toBe(smallBuffer);
        expect(result.wasResized).toBe(false);
        expect(result.finalQuality).toBeUndefined();
      }
    });

    it('should resize large buffers', async () => {
      // Create a buffer larger than TARGET_SIZE_BYTES
      const largeBuffer = Buffer.alloc(8 * 1024 * 1024); // 8MB
      const resizedBuffer = Buffer.from('resized data');

      // Mock sharp to return a small resized buffer
      const mockSharp = await import('sharp');
      const mockToBuffer = vi.fn().mockResolvedValue(resizedBuffer);
      const mockJpeg = vi.fn().mockReturnValue({ toBuffer: mockToBuffer });
      const mockResize = vi.fn().mockReturnValue({ jpeg: mockJpeg });
      vi.mocked(mockSharp.default).mockReturnValue({ resize: mockResize } as unknown as ReturnType<typeof mockSharp.default>);

      const result = await processAvatarBuffer(largeBuffer, 'test-context');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.wasResized).toBe(true);
        expect(result.finalQuality).toBe(85);
      }
      expect(mockResize).toHaveBeenCalledWith(1024, 1024, {
        fit: 'inside',
        withoutEnlargement: true,
      });
      expect(mockJpeg).toHaveBeenCalledWith({ quality: 85 });
    });

    it('should try lower quality if first resize is still too large', async () => {
      const largeBuffer = Buffer.alloc(8 * 1024 * 1024);
      const stillLargeBuffer = Buffer.alloc(8 * 1024 * 1024); // Still too large
      const smallEnoughBuffer = Buffer.from('small enough');

      const mockSharp = await import('sharp');
      const mockToBuffer = vi
        .fn()
        .mockResolvedValueOnce(stillLargeBuffer) // First attempt at 85%
        .mockResolvedValueOnce(smallEnoughBuffer); // Second attempt at 70%
      const mockJpeg = vi.fn().mockReturnValue({ toBuffer: mockToBuffer });
      const mockResize = vi.fn().mockReturnValue({ jpeg: mockJpeg });
      vi.mocked(mockSharp.default).mockReturnValue({ resize: mockResize } as unknown as ReturnType<typeof mockSharp.default>);

      const result = await processAvatarBuffer(largeBuffer, 'test-context');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.wasResized).toBe(true);
        expect(result.finalQuality).toBe(70);
      }
      // Should have tried both 85% and 70%
      expect(mockJpeg).toHaveBeenCalledWith({ quality: 85 });
      expect(mockJpeg).toHaveBeenCalledWith({ quality: 70 });
    });

    it('should return error if image is still too large after all quality levels', async () => {
      const largeBuffer = Buffer.alloc(8 * 1024 * 1024);
      const stillLargeBuffer = Buffer.alloc(8 * 1024 * 1024);

      const mockSharp = await import('sharp');
      const mockToBuffer = vi.fn().mockResolvedValue(stillLargeBuffer);
      const mockJpeg = vi.fn().mockReturnValue({ toBuffer: mockToBuffer });
      const mockResize = vi.fn().mockReturnValue({ jpeg: mockJpeg });
      vi.mocked(mockSharp.default).mockReturnValue({ resize: mockResize } as unknown as ReturnType<typeof mockSharp.default>);

      const result = await processAvatarBuffer(largeBuffer, 'test-context');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('too_large');
        expect(result.message).toContain('too complex');
      }
    });

    it('should return error if sharp throws', async () => {
      const largeBuffer = Buffer.alloc(8 * 1024 * 1024);

      const mockSharp = await import('sharp');
      const mockResize = vi.fn().mockImplementation(() => {
        throw new Error('Sharp processing failed');
      });
      vi.mocked(mockSharp.default).mockReturnValue({ resize: mockResize } as unknown as ReturnType<typeof mockSharp.default>);

      const result = await processAvatarBuffer(largeBuffer, 'test-context');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('processing_failed');
        expect(result.message).toContain('Failed to process');
      }
    });
  });
});
