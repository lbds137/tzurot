/**
 * Tests for Character Import Subcommand
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { MessageFlags, EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, Attachment } from 'discord.js';
import { handleImport, CHARACTER_JSON_TEMPLATE, REQUIRED_IMPORT_FIELDS } from './import.js';
import { DISCORD_LIMITS, DISCORD_COLORS } from '@tzurot/common-types';

// Mock dependencies
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
    // Mock bot owner check to true so slugs remain unchanged in tests
    // (slug normalization is tested in slugUtils.test.ts)
    isBotOwner: vi.fn().mockReturnValue(true),
  };
});

vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

// Import mocked modules
import { callGatewayApi } from '../../utils/userGatewayClient.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * Create a mock interaction for testing
 * @param fileAttachment - Override for the required JSON file attachment
 * @param avatarAttachment - Override for the optional avatar attachment (defaults to null)
 */
function createMockInteraction(
  fileAttachment?: Partial<Attachment>,
  avatarAttachment: Partial<Attachment> | null = null
): ChatInputCommandInteraction {
  const defaultFileAttachment: Attachment = {
    id: 'attachment-123',
    name: 'character.json',
    url: 'https://cdn.discordapp.com/attachments/123/456/character.json',
    contentType: 'application/json',
    size: 1024,
    proxyURL: 'https://media.discordapp.net/attachments/123/456/character.json',
    height: null,
    width: null,
    ephemeral: false,
    description: null,
    duration: null,
    waveform: null,
    flags: { bitfield: 0 } as any,
    title: null,
    spoiler: false,
    toJSON: () => ({}),
    ...fileAttachment,
  } as Attachment;

  const avatarAttachmentData = avatarAttachment
    ? ({
        id: 'avatar-attachment-123',
        name: 'avatar.png',
        url: 'https://cdn.discordapp.com/attachments/123/456/avatar.png',
        contentType: 'image/png',
        size: 1024,
        proxyURL: 'https://media.discordapp.net/attachments/123/456/avatar.png',
        height: 256,
        width: 256,
        ephemeral: false,
        description: null,
        duration: null,
        waveform: null,
        flags: { bitfield: 0 } as any,
        title: null,
        spoiler: false,
        toJSON: () => ({}),
        ...avatarAttachment,
      } as Attachment)
    : null;

  return {
    user: { id: 'owner-123', username: 'testowner' },
    editReply: vi.fn().mockResolvedValue(undefined),
    options: {
      getAttachment: vi.fn().mockImplementation((name: string, _required?: boolean) => {
        if (name === 'file') return defaultFileAttachment;
        if (name === 'avatar') return avatarAttachmentData;
        return null;
      }),
    },
  } as unknown as ChatInputCommandInteraction;
}

/**
 * Create valid character JSON data
 */
function createValidCharacterData(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    name: 'Test Character',
    slug: 'test-character',
    characterInfo: 'A test character for import testing',
    personalityTraits: 'Curious, helpful, friendly',
    ...overrides,
  };
}

/**
 * Mock callGatewayApi for create scenario (character doesn't exist)
 * First call (GET) returns 404, second call (POST) returns success
 */
function mockCreateScenario(createResponse: {
  ok: boolean;
  data?: unknown;
  error?: string;
  status?: number;
}) {
  (callGatewayApi as Mock)
    .mockResolvedValueOnce({ ok: false, error: 'Not found', status: 404 }) // GET returns 404
    .mockResolvedValueOnce(createResponse); // POST
}

/**
 * Mock callGatewayApi for update scenario (character exists and user owns it)
 */
function mockUpdateScenario(
  canEdit: boolean,
  updateResponse?: { ok: boolean; data?: unknown; error?: string; status?: number }
) {
  const getResponse = {
    ok: true,
    data: { personality: { id: 'existing-id' }, canEdit },
  };
  if (updateResponse) {
    (callGatewayApi as Mock)
      .mockResolvedValueOnce(getResponse) // GET returns existing
      .mockResolvedValueOnce(updateResponse); // PUT
  } else {
    (callGatewayApi as Mock).mockResolvedValueOnce(getResponse); // GET only (for canEdit: false case)
  }
}

describe('Character Import Constants', () => {
  describe('CHARACTER_JSON_TEMPLATE', () => {
    it('should be a valid JSON string', () => {
      expect(() => JSON.parse(CHARACTER_JSON_TEMPLATE)).not.toThrow();
    });

    it('should include all required fields', () => {
      const template = JSON.parse(CHARACTER_JSON_TEMPLATE);
      expect(template).toHaveProperty('name');
      expect(template).toHaveProperty('slug');
      expect(template).toHaveProperty('characterInfo');
      expect(template).toHaveProperty('personalityTraits');
    });

    it('should include optional fields', () => {
      const template = JSON.parse(CHARACTER_JSON_TEMPLATE);
      expect(template).toHaveProperty('displayName');
      expect(template).toHaveProperty('isPublic');
      expect(template).toHaveProperty('personalityTone');
      expect(template).toHaveProperty('personalityAge');
      expect(template).toHaveProperty('personalityAppearance');
      expect(template).toHaveProperty('personalityLikes');
      expect(template).toHaveProperty('personalityDislikes');
      expect(template).toHaveProperty('conversationalGoals');
      expect(template).toHaveProperty('conversationalExamples');
      expect(template).toHaveProperty('errorMessage');
      // avatarData is NOT in template - avatars are uploaded as separate image attachments
    });

    it('should have isPublic defaulting to false in template', () => {
      const template = JSON.parse(CHARACTER_JSON_TEMPLATE);
      expect(template.isPublic).toBe(false);
    });
  });

  describe('REQUIRED_IMPORT_FIELDS', () => {
    it('should have exactly 4 required fields', () => {
      expect(REQUIRED_IMPORT_FIELDS).toHaveLength(4);
    });

    it('should include name, slug, characterInfo, and personalityTraits', () => {
      expect(REQUIRED_IMPORT_FIELDS).toContain('name');
      expect(REQUIRED_IMPORT_FIELDS).toContain('slug');
      expect(REQUIRED_IMPORT_FIELDS).toContain('characterInfo');
      expect(REQUIRED_IMPORT_FIELDS).toContain('personalityTraits');
    });
  });
});

describe('handleImport', () => {
  const mockConfig = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    (callGatewayApi as Mock).mockReset();
  });

  describe('basic flow', () => {
    // Note: deferReply is handled by top-level interactionCreate handler

    it('should allow any user to import (no owner check)', async () => {
      const interaction = createMockInteraction();
      // Override user ID to a non-owner user
      (interaction.user as any).id = 'regular-user-456';
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      // Should proceed to call API (not blocked)
      expect(callGatewayApi).toHaveBeenCalled();
    });
  });

  describe('file type validation', () => {
    it('should reject non-JSON files by content type', async () => {
      const interaction = createMockInteraction({
        contentType: 'text/plain',
        name: 'character.txt',
      });

      await handleImport(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith('❌ File must be a JSON file (.json)');
    });

    it('should accept files with .json extension even without content type', async () => {
      const interaction = createMockInteraction({
        contentType: undefined,
        name: 'character.json',
      });
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should accept files with application/json content type', async () => {
      const interaction = createMockInteraction({
        contentType: 'application/json',
        name: 'data.json',
      });
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('file size validation', () => {
    it('should reject files larger than AVATAR_SIZE limit', async () => {
      const interaction = createMockInteraction({
        size: DISCORD_LIMITS.AVATAR_SIZE + 1,
      });

      await handleImport(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith('❌ File is too large (max 10MB)');
    });

    it('should accept files within size limit', async () => {
      const interaction = createMockInteraction({
        size: DISCORD_LIMITS.AVATAR_SIZE - 1000,
      });
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('JSON download and parsing', () => {
    it('should show error with template when fetch fails', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      await handleImport(interaction, mockConfig);

      const editReplyArg = (interaction.editReply as Mock).mock.calls[0][0];
      expect(editReplyArg).toContain('❌ Failed to parse JSON file');
      expect(editReplyArg).toContain('/character template');
    });

    it('should show error with template when JSON is invalid', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('not valid json { broken'),
      });

      await handleImport(interaction, mockConfig);

      const editReplyArg = (interaction.editReply as Mock).mock.calls[0][0];
      expect(editReplyArg).toContain('❌ Failed to parse JSON file');
      expect(editReplyArg).toContain('/character template');
    });
  });

  describe('required field validation', () => {
    it('should show error with template when name is missing', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              slug: 'test',
              characterInfo: 'info',
              personalityTraits: 'traits',
            })
          ),
      });

      await handleImport(interaction, mockConfig);

      const editReplyArg = (interaction.editReply as Mock).mock.calls[0][0];
      expect(editReplyArg).toContain('❌ Missing required fields: name');
      expect(editReplyArg).toContain('/character template');
    });

    it('should list all missing fields', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({})),
      });

      await handleImport(interaction, mockConfig);

      const editReplyArg = (interaction.editReply as Mock).mock.calls[0][0];
      expect(editReplyArg).toContain('name');
      expect(editReplyArg).toContain('slug');
      expect(editReplyArg).toContain('characterInfo');
      expect(editReplyArg).toContain('personalityTraits');
    });

    it('should treat empty string as missing', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              name: '',
              slug: 'test',
              characterInfo: 'info',
              personalityTraits: 'traits',
            })
          ),
      });

      await handleImport(interaction, mockConfig);

      const editReplyArg = (interaction.editReply as Mock).mock.calls[0][0];
      expect(editReplyArg).toContain('❌ Missing required fields: name');
    });

    it('should treat null as missing', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              name: null,
              slug: 'test',
              characterInfo: 'info',
              personalityTraits: 'traits',
            })
          ),
      });

      await handleImport(interaction, mockConfig);

      const editReplyArg = (interaction.editReply as Mock).mock.calls[0][0];
      expect(editReplyArg).toContain('❌ Missing required fields: name');
    });
  });

  describe('slug format validation', () => {
    it('should reject slugs with uppercase letters', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify(
              createValidCharacterData({
                slug: 'Test-Character',
              })
            )
          ),
      });

      await handleImport(interaction, mockConfig);

      const editReplyArg = (interaction.editReply as Mock).mock.calls[0][0];
      expect(editReplyArg).toContain('❌ Invalid slug format');
      expect(editReplyArg).toContain('lowercase letters, numbers, and hyphens');
    });

    it('should reject slugs with spaces', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify(
              createValidCharacterData({
                slug: 'test character',
              })
            )
          ),
      });

      await handleImport(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringContaining('❌ Invalid slug format')
      );
    });

    it('should reject slugs with special characters', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify(
              createValidCharacterData({
                slug: 'test_character!',
              })
            )
          ),
      });

      await handleImport(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.stringContaining('❌ Invalid slug format')
      );
    });

    it('should suggest a corrected slug', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify(
              createValidCharacterData({
                slug: 'Test Character',
              })
            )
          ),
      });

      await handleImport(interaction, mockConfig);

      const editReplyArg = (interaction.editReply as Mock).mock.calls[0][0];
      expect(editReplyArg).toContain('Example:');
      expect(editReplyArg).toContain('test-character');
    });

    it('should accept valid slugs with numbers and hyphens', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify(
              createValidCharacterData({
                slug: 'test-character-123',
              })
            )
          ),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      expect(callGatewayApi).toHaveBeenCalled();
    });
  });

  describe('API error handling', () => {
    it('should handle conflict when user does not own existing character', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      // Character exists but user doesn't own it
      mockUpdateScenario(false);

      await handleImport(interaction, mockConfig);

      const editReplyArg = (interaction.editReply as Mock).mock.calls[0][0];
      expect(editReplyArg).toContain('already exists');
      expect(editReplyArg).toContain("don't own it");
      expect(editReplyArg).toContain('test-character');
    });

    it('should handle other API errors during create', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      mockCreateScenario({
        ok: false,
        error: 'Internal server error',
        status: 500,
      });

      await handleImport(interaction, mockConfig);

      const editReplyArg = (interaction.editReply as Mock).mock.calls[0][0];
      expect(editReplyArg).toContain('❌ Failed to import character');
      expect(editReplyArg).toContain('Internal server error');
    });

    it('should truncate long error messages', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      const longError = 'x'.repeat(2000);
      mockCreateScenario({
        ok: false,
        error: longError,
        status: 400,
      });

      await handleImport(interaction, mockConfig);

      const editReplyArg = (interaction.editReply as Mock).mock.calls[0][0];
      expect(editReplyArg.length).toBeLessThan(longError.length);
    });
  });

  describe('successful import', () => {
    it('should send correct payload to API using user endpoint', async () => {
      const interaction = createMockInteraction();
      const characterData = createValidCharacterData({
        displayName: 'Test Display',
        personalityTone: 'friendly',
        personalityAge: '25',
      });
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(characterData)),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      expect(callGatewayApi).toHaveBeenCalledWith('/user/personality', {
        userId: 'owner-123',
        method: 'POST',
        body: expect.objectContaining({
          name: 'Test Character',
          slug: 'test-character',
        }),
      });
    });

    it('should include user ID in API call', async () => {
      const interaction = createMockInteraction();
      (interaction.user as any).id = 'user-789';
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      expect(callGatewayApi).toHaveBeenCalledWith(
        '/user/personality',
        expect.objectContaining({
          userId: 'user-789',
        })
      );
    });

    it('should show success embed with character name and slug', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });

      const embedArg = (interaction.editReply as Mock).mock.calls[0][0];
      const embed = embedArg.embeds[0];
      const json = embed.toJSON();
      expect(json.title).toBe('Character Imported Successfully');
      expect(json.description).toContain('Test Character');
      expect(json.description).toContain('test-character');
    });

    it('should list all imported fields in embed', async () => {
      const interaction = createMockInteraction();
      const fullCharacter = createValidCharacterData({
        displayName: 'Display',
        personalityTone: 'friendly',
        personalityAge: '25',
        personalityAppearance: 'Tall',
        personalityLikes: 'Music',
        personalityDislikes: 'Noise',
        conversationalGoals: 'Be helpful',
        conversationalExamples: 'Example',
        avatarData: 'base64data',
      });
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(fullCharacter)),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      const embedArg = (interaction.editReply as Mock).mock.calls[0][0];
      const embed = embedArg.embeds[0];
      const json = embed.toJSON();
      const fieldsField = json.fields?.find((f: any) => f.name === 'Imported Fields');
      expect(fieldsField?.value).toContain('Character Info');
      expect(fieldsField?.value).toContain('Personality Traits');
      expect(fieldsField?.value).toContain('Display Name');
      expect(fieldsField?.value).toContain('Tone');
      expect(fieldsField?.value).toContain('Age');
      expect(fieldsField?.value).toContain('Appearance');
      expect(fieldsField?.value).toContain('Likes');
      expect(fieldsField?.value).toContain('Dislikes');
      expect(fieldsField?.value).toContain('Conversational Goals');
      expect(fieldsField?.value).toContain('Conversational Examples');
      expect(fieldsField?.value).toContain('Avatar Data');
    });

    it('should only list fields that were actually provided', async () => {
      const interaction = createMockInteraction();
      // Minimal character with just required fields
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      const embedArg = (interaction.editReply as Mock).mock.calls[0][0];
      const embed = embedArg.embeds[0];
      const json = embed.toJSON();
      const fieldsField = json.fields?.find((f: any) => f.name === 'Imported Fields');
      expect(fieldsField?.value).toContain('Character Info');
      expect(fieldsField?.value).toContain('Personality Traits');
      expect(fieldsField?.value).not.toContain('Display Name');
      expect(fieldsField?.value).not.toContain('Avatar Data');
    });
  });

  describe('visibility handling', () => {
    it('should default to private (isPublic: false) when not specified', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      expect(callGatewayApi).toHaveBeenCalledWith(
        '/user/personality',
        expect.objectContaining({
          body: expect.objectContaining({
            isPublic: false,
          }),
        })
      );

      const embedArg = (interaction.editReply as Mock).mock.calls[0][0];
      const json = embedArg.embeds[0].toJSON();
      expect(json.description).toContain('🔒 Private');
    });

    it('should use isPublic: true when specified in JSON', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify(
              createValidCharacterData({
                isPublic: true,
              })
            )
          ),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      expect(callGatewayApi).toHaveBeenCalledWith(
        '/user/personality',
        expect.objectContaining({
          body: expect.objectContaining({
            isPublic: true,
          }),
        })
      );

      const embedArg = (interaction.editReply as Mock).mock.calls[0][0];
      const json = embedArg.embeds[0].toJSON();
      expect(json.description).toContain('🌐 Public');
    });

    it('should use isPublic: false when explicitly set', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify(
              createValidCharacterData({
                isPublic: false,
              })
            )
          ),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      expect(callGatewayApi).toHaveBeenCalledWith(
        '/user/personality',
        expect.objectContaining({
          body: expect.objectContaining({
            isPublic: false,
          }),
        })
      );
    });

    it('should treat non-boolean isPublic values as false', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify(
              createValidCharacterData({
                isPublic: 'yes', // String instead of boolean
              })
            )
          ),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      expect(callGatewayApi).toHaveBeenCalledWith(
        '/user/personality',
        expect.objectContaining({
          body: expect.objectContaining({
            isPublic: false,
          }),
        })
      );
    });
  });

  describe('slug normalization for non-bot-owners', () => {
    // Import commonTypes once for spying
    let isBotOwnerSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      const commonTypes = await import('@tzurot/common-types');
      isBotOwnerSpy = vi.spyOn(commonTypes, 'isBotOwner').mockReturnValue(false);
    });

    afterEach(() => {
      // Restore to default mock (bot owner = true) after each test
      isBotOwnerSpy.mockReturnValue(true);
    });

    it('should append username to slug for non-bot-owners in API payload', async () => {
      const interaction = createMockInteraction();
      (interaction.user as any).id = 'regular-user-456';
      (interaction.user as any).username = 'cooluser';
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      // Verify the normalized slug is used in the POST payload
      expect(callGatewayApi).toHaveBeenCalledWith(
        '/user/personality',
        expect.objectContaining({
          userId: 'regular-user-456',
          method: 'POST',
          body: expect.objectContaining({
            slug: 'test-character-cooluser', // Username appended
          }),
        })
      );
    });

    it('should use normalized slug for existence check', async () => {
      const interaction = createMockInteraction();
      (interaction.user as any).id = 'regular-user-456';
      (interaction.user as any).username = 'testuser';
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      // First call should check with normalized slug
      expect(callGatewayApi).toHaveBeenNthCalledWith(
        1,
        '/user/personality/test-character-testuser', // Normalized slug in URL
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should show normalized slug in success message', async () => {
      const interaction = createMockInteraction();
      (interaction.user as any).id = 'regular-user-456';
      (interaction.user as any).username = 'myuser';
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      mockCreateScenario({ ok: true, data: { id: 'new-id' } });

      await handleImport(interaction, mockConfig);

      const embedArg = (interaction.editReply as Mock).mock.calls[0][0];
      const embed = embedArg.embeds[0];
      const json = embed.toJSON();
      expect(json.description).toContain('test-character-myuser');
    });
  });

  describe('unexpected errors', () => {
    it('should handle unexpected exceptions gracefully', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      // Make callGatewayApi throw an unexpected exception (not return error result)
      (callGatewayApi as Mock).mockRejectedValue(new Error('Unexpected network failure'));

      await handleImport(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith(
        '❌ An unexpected error occurred while importing the character.\n' +
          'Check bot logs for details.'
      );
    });
  });

  describe('update existing character (upsert)', () => {
    it('should use PUT when character exists and user owns it', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      mockUpdateScenario(true, { ok: true, data: { id: 'existing-id' } });

      await handleImport(interaction, mockConfig);

      // First call should be GET to check existence
      expect(callGatewayApi).toHaveBeenNthCalledWith(1, '/user/personality/test-character', {
        userId: 'owner-123',
        method: 'GET',
      });

      // Second call should be PUT to update
      expect(callGatewayApi).toHaveBeenNthCalledWith(2, '/user/personality/test-character', {
        userId: 'owner-123',
        method: 'PUT',
        body: expect.objectContaining({
          name: 'Test Character',
          slug: 'test-character',
        }),
      });
    });

    it('should show "Updated" in success message when updating', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      mockUpdateScenario(true, { ok: true, data: { id: 'existing-id' } });

      await handleImport(interaction, mockConfig);

      const embedArg = (interaction.editReply as Mock).mock.calls[0][0];
      const embed = embedArg.embeds[0];
      const json = embed.toJSON();
      expect(json.title).toBe('Character Updated Successfully');
      expect(json.description).toContain('Updated character');
    });

    it('should reject update when user does not own the character', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      mockUpdateScenario(false); // canEdit: false, no second call

      await handleImport(interaction, mockConfig);

      // Should only make one call (GET), not try to update
      expect(callGatewayApi).toHaveBeenCalledTimes(1);

      const editReplyArg = (interaction.editReply as Mock).mock.calls[0][0];
      expect(editReplyArg).toContain('already exists');
      expect(editReplyArg).toContain("don't own it");
    });

    it('should handle API errors during update', async () => {
      const interaction = createMockInteraction();
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(createValidCharacterData())),
      });
      mockUpdateScenario(true, {
        ok: false,
        error: 'Database error',
        status: 500,
      });

      await handleImport(interaction, mockConfig);

      const editReplyArg = (interaction.editReply as Mock).mock.calls[0][0];
      expect(editReplyArg).toContain('❌ Failed to update character');
      expect(editReplyArg).toContain('Database error');
    });
  });
});
