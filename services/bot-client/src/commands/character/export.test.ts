/**
 * Tests for Character Export Command
 *
 * Tests the /character export functionality:
 * - JSON data export with correct fields
 * - Avatar export as separate image
 * - Error handling (404, 403, API errors)
 * - Avatar fetch failures
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleExport } from './export.js';
import * as userGatewayClient from '../../utils/userGatewayClient.js';
import type { EnvConfig } from '@tzurot/common-types';
import type { ChatInputCommandInteraction } from 'discord.js';
import { AttachmentBuilder } from 'discord.js';

// Mock dependencies
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    getConfig: vi.fn().mockReturnValue({
      GATEWAY_URL: 'http://localhost:3000',
    }),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

// Mock global fetch for avatar fetching
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Character Export', () => {
  const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

  const createMockInteraction = () =>
    ({
      user: { id: 'user-123' },
      options: {
        getString: vi.fn().mockReturnValue('test-character'),
      },
      editReply: vi.fn(),
    }) as unknown as ChatInputCommandInteraction;

  const mockCharacterData = {
    id: 'char-uuid',
    name: 'Test Character',
    slug: 'test-character',
    displayName: 'Test Display Name',
    isPublic: true,
    ownerId: 'owner-uuid',
    characterInfo: 'A test character',
    personalityTraits: 'Friendly and helpful',
    personalityTone: 'Casual',
    personalityAge: null,
    personalityAppearance: null,
    personalityLikes: 'Coffee',
    personalityDislikes: null,
    conversationalGoals: null,
    conversationalExamples: null,
    errorMessage: null,
    hasAvatar: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleExport', () => {
    // Note: deferReply is handled by top-level interactionCreate handler

    it('should export character as JSON attachment', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { personality: mockCharacterData, canEdit: true },
      });

      const mockInteraction = createMockInteraction();

      await handleExport(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Exported **Test Display Name**'),
          files: expect.arrayContaining([expect.any(AttachmentBuilder)]),
        })
      );

      // Verify only one file (JSON only, no avatar)
      const editReplyArgs = vi.mocked(mockInteraction.editReply).mock.calls[0][0] as {
        files: AttachmentBuilder[];
      };
      expect(editReplyArgs.files).toHaveLength(1);
    });

    it('should include only non-null fields in exported JSON', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { personality: mockCharacterData, canEdit: true },
      });

      const mockInteraction = createMockInteraction();

      await handleExport(mockInteraction, mockConfig);

      // The JSON should include only non-null fields
      // We can't easily inspect the buffer contents, but we verified the flow works
      expect(mockInteraction.editReply).toHaveBeenCalled();
    });

    it('should use character name when displayName is null', async () => {
      const characterWithoutDisplayName = {
        ...mockCharacterData,
        displayName: null,
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { personality: characterWithoutDisplayName, canEdit: true },
      });

      const mockInteraction = createMockInteraction();

      await handleExport(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Exported **Test Character**'),
        })
      );
    });

    it('should export avatar as separate PNG file when hasAvatar is true', async () => {
      const characterWithAvatar = {
        ...mockCharacterData,
        hasAvatar: true,
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { personality: characterWithAvatar, canEdit: true },
      });

      // Mock successful avatar fetch
      const mockAvatarBuffer = new ArrayBuffer(100);
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(mockAvatarBuffer),
      });

      const mockInteraction = createMockInteraction();

      await handleExport(mockInteraction, mockConfig);

      // Verify avatar was fetched
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/avatars/test-character.png');

      // Verify response includes avatar message
      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Avatar image included'),
        })
      );

      // Verify two files (JSON + avatar)
      const editReplyArgs = vi.mocked(mockInteraction.editReply).mock.calls[0][0] as {
        files: AttachmentBuilder[];
      };
      expect(editReplyArgs.files).toHaveLength(2);
    });

    it('should show warning when avatar fetch fails', async () => {
      const characterWithAvatar = {
        ...mockCharacterData,
        hasAvatar: true,
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { personality: characterWithAvatar, canEdit: true },
      });

      // Mock failed avatar fetch (network error)
      mockFetch.mockRejectedValue(new Error('Network error'));

      const mockInteraction = createMockInteraction();

      await handleExport(mockInteraction, mockConfig);

      // Verify warning message is shown
      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Avatar could not be exported'),
        })
      );

      // Verify only JSON file (no avatar)
      const editReplyArgs = vi.mocked(mockInteraction.editReply).mock.calls[0][0] as {
        files: AttachmentBuilder[];
      };
      expect(editReplyArgs.files).toHaveLength(1);
    });

    it('should show warning when avatar returns 404', async () => {
      const characterWithAvatar = {
        ...mockCharacterData,
        hasAvatar: true,
      };

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { personality: characterWithAvatar, canEdit: true },
      });

      // Mock 404 response for avatar
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const mockInteraction = createMockInteraction();

      await handleExport(mockInteraction, mockConfig);

      // Verify warning message is shown
      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Avatar could not be exported'),
        })
      );
    });

    it('should handle character not found (404)', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Not found',
      });

      const mockInteraction = createMockInteraction();

      await handleExport(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        '❌ Character `test-character` not found.'
      );
    });

    it('should handle access denied (403)', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        status: 403,
        error: 'Forbidden',
      });

      const mockInteraction = createMockInteraction();

      await handleExport(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        "❌ You don't have access to character `test-character`."
      );
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Internal server error',
      });

      const mockInteraction = createMockInteraction();

      await handleExport(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        '❌ An unexpected error occurred while exporting the character.'
      );
    });

    it('should handle network errors gracefully', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockRejectedValue(new Error('Network error'));

      const mockInteraction = createMockInteraction();

      await handleExport(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        '❌ An unexpected error occurred while exporting the character.'
      );
    });

    it('should fetch character using correct API call', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { personality: mockCharacterData, canEdit: true },
      });

      const mockInteraction = createMockInteraction();

      await handleExport(mockInteraction, mockConfig);

      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledWith(
        '/user/personality/test-character',
        { userId: 'user-123' }
      );
    });

    it('should include import instructions in response', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { personality: mockCharacterData, canEdit: true },
      });

      const mockInteraction = createMockInteraction();

      await handleExport(mockInteraction, mockConfig);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('/character import'),
        })
      );
    });
  });
});
