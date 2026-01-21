/**
 * Tests for Character Avatar Handler
 *
 * Tests /character avatar subcommand:
 * - Invalid image format
 * - Image too large
 * - Character not found
 * - Permission denied
 * - Successful avatar update
 * - Download/upload errors
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleAvatar } from './avatar.js';
import {
  VALID_IMAGE_TYPES,
  MAX_INPUT_SIZE_MB,
  MAX_INPUT_SIZE_BYTES,
  TARGET_SIZE_BYTES,
} from './avatarUtils.js';
import * as api from './api.js';
import type { ChatInputCommandInteraction, Attachment } from 'discord.js';
import type { EnvConfig } from '@tzurot/common-types';

// Mock dependencies
vi.mock('./api.js', () => ({
  fetchCharacter: vi.fn(),
  updateCharacter: vi.fn(),
}));

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

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Character Avatar Handler', () => {
  const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

  const createMockAttachment = (overrides: Partial<Attachment> = {}): Attachment =>
    ({
      url: 'https://cdn.discord.com/attachments/123/456/image.png',
      contentType: 'image/png',
      size: 1024 * 1024, // 1MB
      ...overrides,
    }) as Attachment;

  const createMockContext = (slug: string, attachment: Attachment) =>
    ({
      user: { id: 'user-123' },
      interaction: {
        options: {
          getString: vi.fn((_name: string, _required?: boolean) => slug),
          getAttachment: vi.fn((_name: string, _required?: boolean) => attachment),
        },
      },
      editReply: vi.fn(),
    }) as unknown as Parameters<typeof handleAvatar>[0];

  const createMockCharacter = (overrides = {}) => ({
    id: 'char-uuid-1',
    name: 'Test Character',
    displayName: 'Test Display',
    slug: 'test-character',
    canEdit: true,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default successful fetch mock
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Constants', () => {
    it('should have correct valid image types', () => {
      expect(VALID_IMAGE_TYPES).toContain('image/png');
      expect(VALID_IMAGE_TYPES).toContain('image/jpeg');
      expect(VALID_IMAGE_TYPES).toContain('image/gif');
      expect(VALID_IMAGE_TYPES).toContain('image/webp');
    });

    it('should have 25MB max input size', () => {
      expect(MAX_INPUT_SIZE_MB).toBe(25);
      expect(MAX_INPUT_SIZE_BYTES).toBe(25 * 1024 * 1024);
    });

    it('should have 7MB target size for base64 payload', () => {
      expect(TARGET_SIZE_BYTES).toBe(7 * 1024 * 1024);
    });
  });

  describe('handleAvatar', () => {
    // Note: deferReply is handled by top-level interactionCreate handler

    it('should reject invalid image format', async () => {
      const attachment = createMockAttachment({ contentType: 'application/pdf' });
      const mockContext = createMockContext('test-char', attachment);

      await handleAvatar(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Invalid image format')
      );
      expect(api.fetchCharacter).not.toHaveBeenCalled();
    });

    it('should reject null content type', async () => {
      const attachment = createMockAttachment({ contentType: null });
      const mockContext = createMockContext('test-char', attachment);

      await handleAvatar(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Invalid image format')
      );
    });

    it('should reject images larger than 25MB', async () => {
      const attachment = createMockAttachment({ size: 26 * 1024 * 1024 }); // 26MB
      const mockContext = createMockContext('test-char', attachment);

      await handleAvatar(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(expect.stringContaining('too large'));
      expect(api.fetchCharacter).not.toHaveBeenCalled();
    });

    it('should return error when character not found', async () => {
      const attachment = createMockAttachment();
      const mockContext = createMockContext('nonexistent', attachment);
      vi.mocked(api.fetchCharacter).mockResolvedValue(null);

      await handleAvatar(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('should return error when user cannot edit character', async () => {
      const attachment = createMockAttachment();
      const mockContext = createMockContext('other-char', attachment);
      vi.mocked(api.fetchCharacter).mockResolvedValue(
        createMockCharacter({ canEdit: false, slug: 'other-char' })
      );

      await handleAvatar(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.stringContaining("don't have permission")
      );
    });

    it('should handle image download failure', async () => {
      const attachment = createMockAttachment();
      const mockContext = createMockContext('my-char', attachment);
      vi.mocked(api.fetchCharacter).mockResolvedValue(createMockCharacter({ slug: 'my-char' }));
      mockFetch.mockResolvedValue({ ok: false });

      await handleAvatar(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Failed to download')
      );
    });

    it('should successfully update avatar', async () => {
      const attachment = createMockAttachment();
      const mockContext = createMockContext('my-char', attachment);
      const mockCharacter = createMockCharacter({ slug: 'my-char', name: 'Luna' });
      vi.mocked(api.fetchCharacter).mockResolvedValue(mockCharacter);
      vi.mocked(api.updateCharacter).mockResolvedValue(undefined);

      await handleAvatar(mockContext, mockConfig);

      expect(api.updateCharacter).toHaveBeenCalledWith(
        'my-char',
        { avatarData: expect.any(String) },
        'user-123',
        mockConfig
      );
      expect(mockContext.editReply).toHaveBeenCalledWith(expect.stringContaining('Avatar updated'));
    });

    it('should use displayName in success message when available', async () => {
      const attachment = createMockAttachment();
      const mockContext = createMockContext('my-char', attachment);
      vi.mocked(api.fetchCharacter).mockResolvedValue(
        createMockCharacter({ slug: 'my-char', name: 'Luna', displayName: 'Luna the Great' })
      );
      vi.mocked(api.updateCharacter).mockResolvedValue(undefined);

      await handleAvatar(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(expect.stringContaining('Luna the Great'));
    });

    it('should handle update errors gracefully', async () => {
      const attachment = createMockAttachment();
      const mockContext = createMockContext('my-char', attachment);
      vi.mocked(api.fetchCharacter).mockResolvedValue(createMockCharacter({ slug: 'my-char' }));
      vi.mocked(api.updateCharacter).mockRejectedValue(new Error('API error'));

      await handleAvatar(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update avatar')
      );
    });
  });
});
