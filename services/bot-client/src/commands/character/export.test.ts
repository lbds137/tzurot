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
import type { EnvConfig } from '@tzurot/common-types/config/config';
import type { UserClient } from '@tzurot/clients';
import { AttachmentBuilder } from 'discord.js';

interface StubUserClient {
  getPersonality: ReturnType<typeof vi.fn>;
}

const stub: StubUserClient = {
  getPersonality: vi.fn(),
};

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: vi.fn().mockReturnValue({
      GATEWAY_URL: 'http://localhost:3000',
    }),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
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

  const createMockContext = () =>
    ({
      user: { id: 'user-123', username: 'testuser' },
      interaction: {
        options: {
          getString: vi.fn().mockReturnValue('test-character'),
        },
      },
      editReply: vi.fn(),
    }) as unknown as Parameters<typeof handleExport>[0];

  const mockCharacterData = {
    id: 'char-uuid',
    name: 'Test Character',
    slug: 'test-character',
    displayName: 'Test Display Name',
    isPublic: true,
    definitionPublic: true,
    definitionRedacted: false,
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
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    voiceEnabled: false,
    imageEnabled: false,
    hasAvatar: false,
    hasVoiceReference: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    stub.getPersonality.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleExport', () => {
    it('should export character as JSON attachment', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: { personality: mockCharacterData, canEdit: true },
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Exported **Test Display Name**'),
          files: expect.arrayContaining([expect.any(AttachmentBuilder)]),
        })
      );

      const editReplyArgs = vi.mocked(mockContext.editReply).mock.calls[0][0] as {
        files: AttachmentBuilder[];
      };
      expect(editReplyArgs.files).toHaveLength(1);
    });

    it('should include only non-null fields in exported JSON', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: { personality: mockCharacterData, canEdit: true },
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalled();
    });

    it('round-trips definitionPublic and customFields in the exported JSON', async () => {
      // Both were previously import-accepted but export-omitted — a character
      // with custom fields silently lost them on export → re-import.
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: {
          personality: {
            ...mockCharacterData,
            definitionPublic: true,
            customFields: { lore: 'deep' },
          },
          canEdit: true,
        },
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      const editReplyArgs = vi.mocked(mockContext.editReply).mock.calls[0][0] as {
        files: AttachmentBuilder[];
      };
      const json = JSON.parse(
        (editReplyArgs.files[0].attachment as Buffer).toString('utf-8')
      ) as Record<string, unknown>;
      expect(json.definitionPublic).toBe(true);
      expect(json.customFields).toEqual({ lore: 'deep' });
    });

    it('exports definitionPublic: false explicitly (boolean false survives the non-null filter)', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: {
          personality: { ...mockCharacterData, definitionPublic: false },
          canEdit: true,
        },
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      const editReplyArgs = vi.mocked(mockContext.editReply).mock.calls[0][0] as {
        files: AttachmentBuilder[];
      };
      const json = JSON.parse(
        (editReplyArgs.files[0].attachment as Buffer).toString('utf-8')
      ) as Record<string, unknown>;
      expect(json.definitionPublic).toBe(false);
    });

    it('should use character name when displayName is null', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: { personality: { ...mockCharacterData, displayName: null }, canEdit: true },
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Exported **Test Character**'),
        })
      );
    });

    it('should export avatar as separate PNG file when hasAvatar is true', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: { personality: { ...mockCharacterData, hasAvatar: true }, canEdit: true },
      });

      const mockAvatarBuffer = new ArrayBuffer(100);
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(mockAvatarBuffer),
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/avatars/test-character.png');
      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Avatar image included'),
        })
      );
      const editReplyArgs = vi.mocked(mockContext.editReply).mock.calls[0][0] as {
        files: AttachmentBuilder[];
      };
      expect(editReplyArgs.files).toHaveLength(2);
    });

    it('should show warning when avatar fetch fails', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: { personality: { ...mockCharacterData, hasAvatar: true }, canEdit: true },
      });
      mockFetch.mockRejectedValue(new Error('Network error'));

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Avatar could not be exported'),
        })
      );
      const editReplyArgs = vi.mocked(mockContext.editReply).mock.calls[0][0] as {
        files: AttachmentBuilder[];
      };
      expect(editReplyArgs.files).toHaveLength(1);
    });

    it('should show warning when avatar returns 404', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: { personality: { ...mockCharacterData, hasAvatar: true }, canEdit: true },
      });
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Avatar could not be exported'),
        })
      );
    });

    it('should handle character not found (404)', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Not found',
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        '❌ Character `test-character` not found.'
      );
    });

    it('should handle access denied (403)', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: false,
        status: 403,
        error: 'Forbidden',
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        "❌ You don't have access to character `test-character`."
      );
    });

    it('should handle API errors gracefully', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Internal server error',
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        '❌ An unexpected error occurred while exporting the character.'
      );
    });

    it('should handle network errors gracefully', async () => {
      stub.getPersonality.mockRejectedValue(new Error('Network error'));

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        '❌ An unexpected error occurred while exporting the character.'
      );
    });

    it('should fetch character using userClient.getPersonality', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: { personality: mockCharacterData, canEdit: true },
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect(stub.getPersonality).toHaveBeenCalledWith('test-character');
    });

    it('should include import instructions in response', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: { personality: mockCharacterData, canEdit: true },
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('/character import'),
        })
      );
    });
  });
});
