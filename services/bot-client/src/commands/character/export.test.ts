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
import { handleExport, CLEARABLE_FIELDS } from './export.js';
import type { EnvConfig } from '@tzurot/common-types/config/config';
import type { UserClient } from '@tzurot/clients';
import { AttachmentBuilder } from 'discord.js';

interface StubUserClient {
  getPersonality: ReturnType<typeof vi.fn>;
}

const stub: StubUserClient = {
  getPersonality: vi.fn(),
};

vi.mock('@tzurot/common-types/utils/ownerMiddleware', () => ({
  isBotOwner: vi.fn().mockReturnValue(false),
}));

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

/**
 * The string-valued members of the export's clearable class — fields whose
 * empty form is a clear instruction on re-import rather than an absence.
 * `tags` is the list-valued member and is asserted separately.
 *
 * Deliberately hand-written rather than derived from the production set: a
 * list derived from the code under test can only catch a MISSING entry, never
 * a wrong one. The parity test below closes the drift the duplication opens,
 * so a field added to production without a case here fails rather than
 * silently going untested.
 */
const CLEARABLE_STRING_FIELDS = [
  'personalityTone',
  'personalityAge',
  'personalityAppearance',
  'personalityLikes',
  'personalityDislikes',
  'conversationalGoals',
  'conversationalExamples',
  'errorMessage',
] as const;

describe('clearable-field parity', () => {
  it('covers every production clearable field with a per-field case', () => {
    const productionStringFields = CLEARABLE_FIELDS.filter(field => field !== 'tags').sort();
    expect([...CLEARABLE_STRING_FIELDS].sort()).toEqual(productionStringFields);
  });

  it('treats tags as the only list-valued clearable field', () => {
    // The `field === 'tags' ? [] : ''` branch in buildExportData is correct
    // only while this holds; a second list field would need it extended.
    expect(CLEARABLE_FIELDS).toContain('tags');
    expect(CLEARABLE_FIELDS).toHaveLength(CLEARABLE_STRING_FIELDS.length + 1);
  });
});

describe('Character Export', () => {
  const mockConfig = { GATEWAY_URL: 'http://localhost:3000' } as EnvConfig;

  /** Parse the JSON attachment from the first editReply call. */
  const exportedJson = (context: Parameters<typeof handleExport>[0]): Record<string, unknown> => {
    const args = vi.mocked(context.editReply).mock.calls[0][0] as { files: AttachmentBuilder[] };
    return JSON.parse((args.files[0].attachment as Buffer).toString('utf-8')) as Record<
      string,
      unknown
    >;
  };

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
    it('denies export of a non-owned character (system-voice permission line)', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: { personality: mockCharacterData, canEdit: false },
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        expect.stringContaining('You do not have permission to export')
      );
    });

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

      const json = exportedJson(mockContext);
      expect(json.definitionPublic).toBe(true);
      expect(json.customFields).toEqual({ lore: 'deep' });
    });

    it('round-trips a populated tags array in the exported JSON', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: {
          personality: { ...mockCharacterData, tags: ['fantasy', 'sci-fi'] },
          canEdit: true,
        },
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect(exportedJson(mockContext).tags).toEqual(['fantasy', 'sci-fi']);
    });

    it('emits tags: [] for an untagged character so a re-import restores the untagged state', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: { personality: { ...mockCharacterData, tags: [] }, canEdit: true },
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      const json = exportedJson(mockContext);
      expect(json.tags).toEqual([]);
    });

    it.each(CLEARABLE_STRING_FIELDS)(
      'emits %s: "" when the stored value is null (the explicit clear form)',
      async field => {
        stub.getPersonality.mockResolvedValue({
          ok: true,
          data: { personality: { ...mockCharacterData, [field]: null }, canEdit: true },
        });

        const mockContext = createMockContext();
        await handleExport(mockContext, mockConfig);

        // Not null: `buildImportPayload` maps every optional field through
        // `?? undefined`, so an exported null would collapse to "no change"
        // and silently fail to clear anything.
        expect(exportedJson(mockContext)[field]).toBe('');
      }
    );

    it('keeps populated clearable fields verbatim', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: {
          personality: { ...mockCharacterData, personalityTone: 'Casual', tags: ['fantasy'] },
          canEdit: true,
        },
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      const json = exportedJson(mockContext);
      expect(json.personalityTone).toBe('Casual');
      expect(json.tags).toEqual(['fantasy']);
    });

    it('still omits a null displayName rather than emitting a clear form', async () => {
      // Both user routes rewrite an empty displayName to the character's name,
      // so `''` here would overwrite the stored null instead of preserving it.
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: { personality: { ...mockCharacterData, displayName: null }, canEdit: true },
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect('displayName' in exportedJson(mockContext)).toBe(false);
    });

    it('still omits a null customFields (its clear is nullish and gateway-dropped)', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: { personality: { ...mockCharacterData, customFields: null }, canEdit: true },
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect('customFields' in exportedJson(mockContext)).toBe(false);
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

      expect(exportedJson(mockContext).definitionPublic).toBe(false);
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

    it('should show warning when the avatar endpoint returns a non-404 error status', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: true,
        data: { personality: { ...mockCharacterData, hasAvatar: true }, canEdit: true },
      });
      // 500 takes the throw arm (not the 404 early return); fetchAvatarData
      // catches it and degrades to the same "could not be exported" notice.
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

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
        '❌ Character "test-character" not found.'
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
        '❌ You do not have permission to access character `test-character`.'
      );
    });

    it('should handle API errors gracefully', async () => {
      stub.getPersonality.mockResolvedValue({
        ok: false,
        kind: 'http',
        status: 500,
        error: 'Internal server error',
      });

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      // The fail-arm's gateway message is surfaced, not a hand-written generic.
      expect(mockContext.editReply).toHaveBeenCalledWith('❌ Internal server error');
    });

    it('should handle network errors gracefully', async () => {
      stub.getPersonality.mockRejectedValue(new Error('Network error'));

      const mockContext = createMockContext();
      await handleExport(mockContext, mockConfig);

      expect(mockContext.editReply).toHaveBeenCalledWith(
        '❌ Failed to export the character. Please try again.'
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
