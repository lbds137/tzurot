/**
 * AttachmentStorageService Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { AttachmentStorageService } from './AttachmentStorageService.js';
import type { AttachmentMetadata } from '@tzurot/common-types';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
}));

// Mock sharp
vi.mock('sharp', () => {
  const mockSharp = vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 2048, height: 1536 }),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('resized-image-data')),
  }));
  return { default: mockSharp };
});

// Mock fetch
global.fetch = vi.fn();

describe('AttachmentStorageService', () => {
  let service: AttachmentStorageService;
  const mockFetch = global.fetch as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AttachmentStorageService({
      storageBasePath: '/tmp/test-attachments',
      gatewayUrl: 'https://gateway.example.com',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default options when none provided', () => {
      const defaultService = new AttachmentStorageService();
      expect(defaultService).toBeInstanceOf(AttachmentStorageService);
    });

    it('should use custom options when provided', () => {
      expect(service).toBeInstanceOf(AttachmentStorageService);
    });
  });

  describe('downloadAndStore', () => {
    it('should return empty array when no attachments', async () => {
      const result = await service.downloadAndStore('req-123', []);
      expect(result).toEqual([]);
      expect(mkdir).not.toHaveBeenCalled();
    });

    it('should download and store attachments', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://cdn.discordapp.com/image1.png',
          contentType: 'image/png',
          name: 'image1.png',
          size: 5000,
        },
      ];

      // Mock successful fetch
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(5000)),
      } as any);

      const result = await service.downloadAndStore('req-123', attachments);

      // Should create directory
      expect(mkdir).toHaveBeenCalledWith('/tmp/test-attachments/req-123', { recursive: true });

      // Should download attachment
      expect(mockFetch).toHaveBeenCalledWith('https://cdn.discordapp.com/image1.png');

      // Should save to disk
      expect(writeFile).toHaveBeenCalled();

      // Should return updated metadata with local URL
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        originalUrl: 'https://cdn.discordapp.com/image1.png',
        url: 'https://gateway.example.com/temp-attachments/req-123/image1.png',
        contentType: 'image/png',
        name: 'image1.png',
      });
    });

    it('should handle multiple attachments in parallel', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://cdn.discordapp.com/image1.png',
          contentType: 'image/png',
          name: 'image1.png',
          size: 5000,
        },
        {
          url: 'https://cdn.discordapp.com/image2.jpg',
          contentType: 'image/jpeg',
          name: 'image2.jpg',
          size: 7000,
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(5000)),
      } as any);

      const result = await service.downloadAndStore('req-456', attachments);

      expect(result).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(writeFile).toHaveBeenCalledTimes(2);
    });

    it('should use original URL as fallback when download fails', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://cdn.discordapp.com/broken.png',
          contentType: 'image/png',
          name: 'broken.png',
          size: 5000,
        },
      ];

      // Mock failed fetch
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as any);

      const result = await service.downloadAndStore('req-789', attachments);

      // Should still return attachment with original URL
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe('https://cdn.discordapp.com/broken.png');
      expect(result[0]).not.toHaveProperty('originalUrl');
    });

    it('should generate filename from index when name is missing', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://cdn.discordapp.com/file',
          contentType: 'application/octet-stream',
          size: 1000,
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1000)),
      } as any);

      const result = await service.downloadAndStore('req-abc', attachments);

      expect(result[0].url).toMatch(/attachment-0-\d+\.bin/);
    });

    it('should handle image attachments', async () => {
      // Test with a reasonable-sized image
      const imageBuffer = Buffer.alloc(1024); // 1KB test buffer
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://cdn.discordapp.com/image.png',
          contentType: 'image/png',
          name: 'image.png',
          size: imageBuffer.length,
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(imageBuffer.buffer),
      } as any);

      const result = await service.downloadAndStore('req-image', attachments);

      expect(result).toHaveLength(1);
      expect(result[0].contentType).toBe('image/png');
    });

    it('should handle PDF attachments', async () => {
      const pdfBuffer = Buffer.alloc(1024); // 1KB test buffer

      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://cdn.discordapp.com/document.pdf',
          contentType: 'application/pdf',
          name: 'document.pdf',
          size: pdfBuffer.length,
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(pdfBuffer.buffer),
      } as any);

      const result = await service.downloadAndStore('req-pdf', attachments);

      expect(result).toHaveLength(1);
      expect(result[0].contentType).toBe('application/pdf');
    });
  });

  describe('cleanup', () => {
    it('should remove request directory', async () => {
      await service.cleanup('req-cleanup');

      expect(rm).toHaveBeenCalledWith('/tmp/test-attachments/req-cleanup', {
        recursive: true,
        force: true,
      });
    });

    it('should handle cleanup errors gracefully', async () => {
      const rmMock = rm as ReturnType<typeof vi.fn>;
      rmMock.mockRejectedValue(new Error('Permission denied'));

      // Should not throw
      await expect(service.cleanup('req-error')).resolves.toBeUndefined();
    });
  });

  describe('various content types', () => {
    it('should handle video attachments', async () => {
      const videoBuffer = Buffer.alloc(1024); // 1KB test buffer

      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://cdn.discordapp.com/video.mp4',
          contentType: 'video/mp4',
          name: 'video.mp4',
          size: videoBuffer.length,
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(videoBuffer.buffer),
      } as any);

      const result = await service.downloadAndStore('req-video', attachments);

      expect(result).toHaveLength(1);
      expect(result[0].contentType).toBe('video/mp4');
    });
  });
});
