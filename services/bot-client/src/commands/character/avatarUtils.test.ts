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
vi.mock('@tzurot/common-types', async importOriginal => {
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

    it('should resize large JPEG buffers', async () => {
      const largeBuffer = Buffer.alloc(8 * 1024 * 1024); // 8MB
      const resizedBuffer = Buffer.from('resized data');

      const mockSharp = await import('sharp');
      const mockToBuffer = vi.fn().mockResolvedValue(resizedBuffer);
      const mockJpeg = vi.fn().mockReturnValue({ toBuffer: mockToBuffer });
      const mockResize = vi.fn().mockReturnValue({ jpeg: mockJpeg });
      const mockMetadata = vi.fn().mockResolvedValue({ format: 'jpeg', width: 2000, height: 2000 });
      vi.mocked(mockSharp.default).mockReturnValue({
        metadata: mockMetadata,
        resize: mockResize,
      } as unknown as ReturnType<typeof mockSharp.default>);

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

    it('should preserve PNG format with compression level', async () => {
      const largeBuffer = Buffer.alloc(8 * 1024 * 1024);
      const resizedBuffer = Buffer.from('resized png');

      const mockSharp = await import('sharp');
      const mockToBuffer = vi.fn().mockResolvedValue(resizedBuffer);
      const mockPng = vi.fn().mockReturnValue({ toBuffer: mockToBuffer });
      const mockResize = vi.fn().mockReturnValue({ png: mockPng });
      const mockMetadata = vi.fn().mockResolvedValue({ format: 'png', width: 2000, height: 2000 });
      vi.mocked(mockSharp.default).mockReturnValue({
        metadata: mockMetadata,
        resize: mockResize,
      } as unknown as ReturnType<typeof mockSharp.default>);

      const result = await processAvatarBuffer(largeBuffer, 'test-context');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.wasResized).toBe(true);
      }
      // PNG uses compressionLevel instead of quality
      expect(mockPng).toHaveBeenCalledWith({ compressionLevel: 7 }); // quality 85 → level 7
    });

    it('should preserve WebP format with quality', async () => {
      const largeBuffer = Buffer.alloc(8 * 1024 * 1024);
      const resizedBuffer = Buffer.from('resized webp');

      const mockSharp = await import('sharp');
      const mockToBuffer = vi.fn().mockResolvedValue(resizedBuffer);
      const mockWebp = vi.fn().mockReturnValue({ toBuffer: mockToBuffer });
      const mockResize = vi.fn().mockReturnValue({ webp: mockWebp });
      const mockMetadata = vi.fn().mockResolvedValue({ format: 'webp', width: 2000, height: 2000 });
      vi.mocked(mockSharp.default).mockReturnValue({
        metadata: mockMetadata,
        resize: mockResize,
      } as unknown as ReturnType<typeof mockSharp.default>);

      const result = await processAvatarBuffer(largeBuffer, 'test-context');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.wasResized).toBe(true);
      }
      expect(mockWebp).toHaveBeenCalledWith({ quality: 85 });
    });

    it('should convert GIF to JPEG (loses animation)', async () => {
      const largeBuffer = Buffer.alloc(8 * 1024 * 1024);
      const resizedBuffer = Buffer.from('converted gif');

      const mockSharp = await import('sharp');
      const mockToBuffer = vi.fn().mockResolvedValue(resizedBuffer);
      const mockJpeg = vi.fn().mockReturnValue({ toBuffer: mockToBuffer });
      const mockResize = vi.fn().mockReturnValue({ jpeg: mockJpeg });
      const mockMetadata = vi.fn().mockResolvedValue({ format: 'gif', width: 500, height: 500 });
      vi.mocked(mockSharp.default).mockReturnValue({
        metadata: mockMetadata,
        resize: mockResize,
      } as unknown as ReturnType<typeof mockSharp.default>);

      const result = await processAvatarBuffer(largeBuffer, 'test-context');

      expect(result.success).toBe(true);
      // GIF → JPEG conversion
      expect(mockJpeg).toHaveBeenCalledWith({ quality: 85 });
    });

    it('should try lower quality if first resize is still too large', async () => {
      const largeBuffer = Buffer.alloc(8 * 1024 * 1024);
      const stillLargeBuffer = Buffer.alloc(8 * 1024 * 1024);
      const smallEnoughBuffer = Buffer.from('small enough');

      const mockSharp = await import('sharp');
      const mockToBuffer = vi
        .fn()
        .mockResolvedValueOnce(stillLargeBuffer)
        .mockResolvedValueOnce(smallEnoughBuffer);
      const mockJpeg = vi.fn().mockReturnValue({ toBuffer: mockToBuffer });
      const mockResize = vi.fn().mockReturnValue({ jpeg: mockJpeg });
      const mockMetadata = vi.fn().mockResolvedValue({ format: 'jpeg', width: 2000, height: 2000 });
      vi.mocked(mockSharp.default).mockReturnValue({
        metadata: mockMetadata,
        resize: mockResize,
      } as unknown as ReturnType<typeof mockSharp.default>);

      const result = await processAvatarBuffer(largeBuffer, 'test-context');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.wasResized).toBe(true);
        expect(result.finalQuality).toBe(70);
      }
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
      const mockMetadata = vi.fn().mockResolvedValue({ format: 'jpeg', width: 2000, height: 2000 });
      vi.mocked(mockSharp.default).mockReturnValue({
        metadata: mockMetadata,
        resize: mockResize,
      } as unknown as ReturnType<typeof mockSharp.default>);

      const result = await processAvatarBuffer(largeBuffer, 'test-context');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('too_large');
        expect(result.message).toContain('too complex');
      }
    });

    it('should return error for unsupported image format', async () => {
      const largeBuffer = Buffer.alloc(8 * 1024 * 1024);

      const mockSharp = await import('sharp');
      const mockMetadata = vi.fn().mockResolvedValue({ format: 'tiff', width: 1000, height: 1000 });
      vi.mocked(mockSharp.default).mockReturnValue({
        metadata: mockMetadata,
      } as unknown as ReturnType<typeof mockSharp.default>);

      const result = await processAvatarBuffer(largeBuffer, 'test-context');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('invalid_format');
        expect(result.message).toContain('Unsupported image format');
      }
    });

    it('should return error for image dimensions too large (image bomb protection)', async () => {
      const largeBuffer = Buffer.alloc(8 * 1024 * 1024);

      const mockSharp = await import('sharp');
      // 15000 x 15000 = 225 million pixels > 100 million limit
      const mockMetadata = vi
        .fn()
        .mockResolvedValue({ format: 'png', width: 15000, height: 15000 });
      vi.mocked(mockSharp.default).mockReturnValue({
        metadata: mockMetadata,
      } as unknown as ReturnType<typeof mockSharp.default>);

      const result = await processAvatarBuffer(largeBuffer, 'test-context');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('dimensions_too_large');
        expect(result.message).toContain('dimensions are too large');
      }
    });

    it('should return error if sharp throws during metadata extraction', async () => {
      const largeBuffer = Buffer.alloc(8 * 1024 * 1024);

      const mockSharp = await import('sharp');
      const mockMetadata = vi.fn().mockRejectedValue(new Error('Invalid image data'));
      vi.mocked(mockSharp.default).mockReturnValue({
        metadata: mockMetadata,
      } as unknown as ReturnType<typeof mockSharp.default>);

      const result = await processAvatarBuffer(largeBuffer, 'test-context');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('processing_failed');
        expect(result.message).toContain('Failed to process');
      }
    });

    it('should return error if sharp throws during resize', async () => {
      const largeBuffer = Buffer.alloc(8 * 1024 * 1024);

      const mockSharp = await import('sharp');
      const mockMetadata = vi.fn().mockResolvedValue({ format: 'jpeg', width: 2000, height: 2000 });
      const mockResize = vi.fn().mockImplementation(() => {
        throw new Error('Sharp processing failed');
      });
      vi.mocked(mockSharp.default).mockReturnValue({
        metadata: mockMetadata,
        resize: mockResize,
      } as unknown as ReturnType<typeof mockSharp.default>);

      const result = await processAvatarBuffer(largeBuffer, 'test-context');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('processing_failed');
        expect(result.message).toContain('Failed to process');
      }
    });
  });
});
