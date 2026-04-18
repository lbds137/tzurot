/**
 * Tests for Character Settings Dashboard
 *
 * Tests the interactive settings dashboard for character settings.
 * Uses cascade config overrides via /user/config-overrides/ endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import {
  handleSettings,
  handleCharacterSettingsButton,
  handleCharacterSettingsModal,
  isCharacterSettingsInteraction,
} from './settings.js';
import type { EnvConfig, ResolvedConfigOverrides } from '@tzurot/common-types';

// Mock dependencies
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  toGatewayUser: (user: { id?: string; username?: string; globalName?: string | null }) => ({
    discordId: user.id ?? 'test-user-id',
    username: user.username ?? 'testuser',
    displayName: user.globalName ?? user.username ?? 'testuser',
  }),
}));

// Mock the session manager
const mockSessionManager = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../utils/dashboard/SessionManager.js', () => ({
  getSessionManager: vi.fn(() => mockSessionManager),
  DashboardSessionManager: {
    getInstance: vi.fn(() => mockSessionManager),
  },
}));

describe('Character Settings Dashboard', () => {
  const mockPersonality = {
    personality: {
      id: 'personality-123',
      name: 'Aurora',
      slug: 'aurora',
      ownerId: 'user-456',
    },
  };

  const mockResolvedOverrides: ResolvedConfigOverrides = {
    maxMessages: 50,
    maxAge: 7200,
    maxImages: 5,
    memoryScoreThreshold: 0.5,
    memoryLimit: 20,
    focusModeEnabled: false,
    crossChannelHistoryEnabled: false,
    shareLtmAcrossPersonalities: false,
    showModelFooter: true,
    voiceResponseMode: 'always' as const,
    voiceTranscriptionEnabled: true,
    elevenlabsTtsModel: 'eleven_multilingual_v2',
    sources: {
      maxMessages: 'personality',
      maxAge: 'personality',
      maxImages: 'personality',
      memoryScoreThreshold: 'personality',
      memoryLimit: 'personality',
      focusModeEnabled: 'personality',
      crossChannelHistoryEnabled: 'personality',
      shareLtmAcrossPersonalities: 'personality',
      showModelFooter: 'hardcoded',
      voiceResponseMode: 'hardcoded' as const,
      voiceTranscriptionEnabled: 'hardcoded' as const,
      elevenlabsTtsModel: 'hardcoded' as const,
    },
  };

  const mockConfig: EnvConfig = {} as EnvConfig;

  const createMockContext = (): Parameters<typeof handleSettings>[0] & {
    editReply: ReturnType<typeof vi.fn>;
    interaction: {
      deferred: boolean;
      replied: boolean;
      channelId: string;
      editReply: ReturnType<typeof vi.fn>;
      options: {
        getString: ReturnType<typeof vi.fn>;
      };
    };
  } => {
    const mockEditReply = vi.fn().mockResolvedValue({ id: 'message-123' });
    return {
      interaction: {
        options: {
          getString: vi.fn().mockReturnValue('aurora'),
        },
        channelId: 'channel-789',
        deferred: true,
        replied: false,
        editReply: mockEditReply,
      },
      user: { id: 'user-456' },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleSettings>[0] & {
      editReply: ReturnType<typeof vi.fn>;
      interaction: {
        deferred: boolean;
        replied: boolean;
        channelId: string;
        editReply: ReturnType<typeof vi.fn>;
        options: {
          getString: ReturnType<typeof vi.fn>;
        };
      };
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleSettings', () => {
    it('should display settings dashboard embed', async () => {
      const context = createMockContext();
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true, data: mockPersonality })
        .mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides });

      await handleSettings(context, mockConfig);

      // First call: fetch personality
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/personality/aurora', {
        method: 'GET',
        user: {
          discordId: 'user-456',
          username: 'testuser',
          displayName: 'testuser',
        },
        timeout: 10000,
      });
      // Second call: resolve 3-tier cascade (hardcoded → admin → personality)
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/config-overrides/resolve-personality/personality-123',
        {
          method: 'GET',
          user: { discordId: 'user-456', username: 'testuser', displayName: 'testuser' },
          timeout: 10000,
        }
      );
      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('should include Character Settings title in embed', async () => {
      const context = createMockContext();
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true, data: mockPersonality })
        .mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides });

      await handleSettings(context, mockConfig);

      const editReplyCall = context.editReply.mock.calls[0][0];
      expect(editReplyCall.embeds).toHaveLength(1);

      const embedJson = editReplyCall.embeds[0].toJSON();
      expect(embedJson.title).toBe('Character Settings');
    });

    it('should include character name in embed description', async () => {
      const context = createMockContext();
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true, data: mockPersonality })
        .mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides });

      await handleSettings(context, mockConfig);

      const editReplyCall = context.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      expect(embedJson.description).toContain('Aurora');
    });

    it('should include all 10 settings fields', async () => {
      const context = createMockContext();
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true, data: mockPersonality })
        .mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides });

      await handleSettings(context, mockConfig);

      const editReplyCall = context.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      expect(embedJson.fields).toHaveLength(10);
    });

    it('should extract personality-tier overrides as local values', async () => {
      const context = createMockContext();
      const resolvedWithPersonalityOverride: ResolvedConfigOverrides = {
        ...mockResolvedOverrides,
        maxMessages: 75,
        sources: {
          ...mockResolvedOverrides.sources,
          maxMessages: 'personality',
        },
      };
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true, data: mockPersonality })
        .mockResolvedValueOnce({ ok: true, data: resolvedWithPersonalityOverride });

      await handleSettings(context, mockConfig);

      const editReplyCall = context.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();
      const maxMessagesField = embedJson.fields?.find((f: { name: string }) =>
        f.name?.includes('Max Messages')
      );

      // personality source should show as Override (localValue extracted)
      expect(maxMessagesField?.value).toContain('Override');
    });

    it('should handle character not found', async () => {
      const context = createMockContext();
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Not found',
      });

      await handleSettings(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('not found'),
      });
    });

    it('should handle API errors gracefully', async () => {
      const context = createMockContext();
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Server error',
      });

      await handleSettings(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to load character data'),
      });
    });

    it('should handle cascade resolve failure', async () => {
      const context = createMockContext();
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true, data: mockPersonality })
        .mockResolvedValueOnce({ ok: false, error: 'Cascade error' });

      await handleSettings(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: '❌ Failed to fetch config settings.',
      });
    });

    it('should handle unexpected errors gracefully', async () => {
      const context = createMockContext();
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleSettings(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: '❌ An error occurred while opening the settings dashboard.',
      });
    });

    it('should show error message on network failure', async () => {
      const context = createMockContext();
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleSettings(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: '❌ An error occurred while opening the settings dashboard.',
      });
    });
  });

  describe('isCharacterSettingsInteraction', () => {
    it('should return true for character settings custom IDs', () => {
      expect(isCharacterSettingsInteraction('character-settings::select::aurora')).toBe(true);
      expect(
        isCharacterSettingsInteraction('character-settings::set::aurora::maxMessages:auto')
      ).toBe(true);
      expect(isCharacterSettingsInteraction('character-settings::back::aurora')).toBe(true);
      expect(isCharacterSettingsInteraction('character-settings::close::aurora')).toBe(true);
    });

    it('should return false for non-character settings custom IDs', () => {
      expect(isCharacterSettingsInteraction('channel-settings::select::chan-123')).toBe(false);
      expect(isCharacterSettingsInteraction('admin-settings::set::global')).toBe(false);
      // character::edit is the character editor, not settings
      expect(isCharacterSettingsInteraction('character::edit::my-char')).toBe(false);
    });

    it('should return false for empty custom ID', () => {
      expect(isCharacterSettingsInteraction('')).toBe(false);
    });
  });

  describe('handleCharacterSettingsButton', () => {
    it('should update crossChannelHistoryEnabled via set button', async () => {
      const interaction = {
        customId: 'character-settings::set::personality-123::crossChannelHistoryEnabled:true',
        user: { id: 'user-456' },
        reply: vi.fn(),
        update: vi.fn(),
        showModal: vi.fn(),
      };

      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-456',
          entityId: 'personality-123',
          data: {
            maxMessages: { localValue: null, effectiveValue: 50, source: 'personality' },
            maxAge: { localValue: null, effectiveValue: 7200, source: 'personality' },
            maxImages: { localValue: null, effectiveValue: 5, source: 'personality' },
            crossChannelHistoryEnabled: {
              localValue: null,
              effectiveValue: false,
              source: 'hardcoded',
            },
            shareLtmAcrossPersonalities: {
              localValue: null,
              effectiveValue: false,
              source: 'hardcoded',
            },
          },
          view: 'setting',
          activeSetting: 'crossChannelHistoryEnabled',
        },
      });

      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true }) // PATCH config-overrides
        .mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides }); // GET resolve

      await handleCharacterSettingsButton(interaction as unknown as ButtonInteraction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/config-overrides/personality/personality-123',
        expect.objectContaining({
          method: 'PATCH',
          body: { crossChannelHistoryEnabled: true },
        })
      );
    });

    it('should update shareLtmAcrossPersonalities via set button', async () => {
      const interaction = {
        customId: 'character-settings::set::personality-123::shareLtmAcrossPersonalities:true',
        user: { id: 'user-456' },
        reply: vi.fn(),
        update: vi.fn(),
        showModal: vi.fn(),
      };

      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-456',
          entityId: 'personality-123',
          data: {
            maxMessages: { localValue: null, effectiveValue: 50, source: 'personality' },
            maxAge: { localValue: null, effectiveValue: 7200, source: 'personality' },
            maxImages: { localValue: null, effectiveValue: 5, source: 'personality' },
            crossChannelHistoryEnabled: {
              localValue: null,
              effectiveValue: false,
              source: 'hardcoded',
            },
            shareLtmAcrossPersonalities: {
              localValue: null,
              effectiveValue: false,
              source: 'hardcoded',
            },
          },
          view: 'setting',
          activeSetting: 'shareLtmAcrossPersonalities',
        },
      });

      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true }) // PATCH config-overrides
        .mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides }); // GET resolve

      await handleCharacterSettingsButton(interaction as unknown as ButtonInteraction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/config-overrides/personality/personality-123',
        expect.objectContaining({
          method: 'PATCH',
          body: { shareLtmAcrossPersonalities: true },
        })
      );
    });

    it('should handle permission denied (401) response', async () => {
      // Entity ID now uses slug::personalityId format
      const interaction = {
        customId: 'character-settings::set::personality-123::maxMessages:auto',
        user: { id: 'user-456' },
        reply: vi.fn(),
        update: vi.fn(),
        showModal: vi.fn(),
      };

      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-456',
          entityId: 'personality-123',
          data: {
            maxMessages: { localValue: null, effectiveValue: 50, source: 'personality' },
            maxAge: { localValue: null, effectiveValue: 7200, source: 'personality' },
            maxImages: { localValue: null, effectiveValue: 5, source: 'personality' },
          },
          view: 'setting',
          activeSetting: 'maxMessages',
        },
      });

      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 401,
        error: 'Unauthorized',
      });

      await handleCharacterSettingsButton(interaction as unknown as ButtonInteraction);

      // The settings framework shows "Failed to update: {error}"
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to update'),
        })
      );
    });

    it('should handle character not found (404) response', async () => {
      const interaction = {
        customId: 'character-settings::set::personality-123::maxMessages:auto',
        user: { id: 'user-456' },
        reply: vi.fn(),
        update: vi.fn(),
        showModal: vi.fn(),
      };

      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-456',
          entityId: 'personality-123',
          data: {
            maxMessages: { localValue: null, effectiveValue: 50, source: 'personality' },
            maxAge: { localValue: null, effectiveValue: 7200, source: 'personality' },
            maxImages: { localValue: null, effectiveValue: 5, source: 'personality' },
          },
          view: 'setting',
          activeSetting: 'maxMessages',
        },
      });

      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Not found',
      });

      await handleCharacterSettingsButton(interaction as unknown as ButtonInteraction);

      // The settings framework shows "Failed to update: {error}"
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to update'),
        })
      );
    });
  });

  describe('handleCharacterSettingsModal', () => {
    const createMockModalInteraction = (customId: string, inputValue: string) => ({
      customId,
      user: { id: 'user-456' },
      fields: {
        getTextInputValue: vi.fn().mockReturnValue(inputValue),
      },
      reply: vi.fn(),
      update: vi.fn(),
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    });

    // Entity ID is now slug::personalityId
    const createSessionWithSetting = (settingId: string) => ({
      data: {
        userId: 'user-456',
        entityId: 'personality-123',
        data: {
          maxMessages: { localValue: null, effectiveValue: 50, source: 'personality' },
          maxAge: { localValue: null, effectiveValue: 7200, source: 'personality' },
          maxImages: { localValue: null, effectiveValue: 5, source: 'personality' },
        },
        view: 'setting',
        activeSetting: settingId,
      },
    });

    it('should update maxMessages setting via cascade endpoint', async () => {
      const interaction = createMockModalInteraction(
        'character-settings::modal::personality-123::maxMessages',
        '75'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true }) // PATCH config-overrides
        .mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides }); // GET resolve

      await handleCharacterSettingsModal(interaction as never);

      // Should call PATCH on cascade endpoint with correct field
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/config-overrides/personality/personality-123',
        expect.objectContaining({
          method: 'PATCH',
          body: { maxMessages: 75 },
        })
      );
    });

    it('should update maxAge setting with duration string (2h)', async () => {
      const interaction = createMockModalInteraction(
        'character-settings::modal::personality-123::maxAge',
        '2h'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides });

      await handleCharacterSettingsModal(interaction as never);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/config-overrides/personality/personality-123',
        expect.objectContaining({
          method: 'PATCH',
          body: { maxAge: 7200 },
        })
      );
    });

    it('should update maxAge setting to "off" (disabled)', async () => {
      const interaction = createMockModalInteraction(
        'character-settings::modal::personality-123::maxAge',
        'off'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides });

      await handleCharacterSettingsModal(interaction as never);

      // "off" maps to null in cascade config overrides
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/config-overrides/personality/personality-123',
        expect.objectContaining({
          method: 'PATCH',
          body: { maxAge: null },
        })
      );
    });

    it('should set maxAge to auto (null) when auto selected', async () => {
      const interaction = createMockModalInteraction(
        'character-settings::modal::personality-123::maxAge',
        'auto'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides });

      await handleCharacterSettingsModal(interaction as never);

      // "auto" means inherit (null) — inherit from lower cascade tier
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/config-overrides/personality/personality-123',
        expect.objectContaining({
          method: 'PATCH',
          body: { maxAge: null },
        })
      );
    });

    it('should update maxImages setting via cascade endpoint', async () => {
      const interaction = createMockModalInteraction(
        'character-settings::modal::personality-123::maxImages',
        '10'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxImages'));
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides });

      await handleCharacterSettingsModal(interaction as never);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/config-overrides/personality/personality-123',
        expect.objectContaining({
          method: 'PATCH',
          body: { maxImages: 10 },
        })
      );
    });

    it('should handle refresh failure after update', async () => {
      const interaction = createMockModalInteraction(
        'character-settings::modal::personality-123::maxMessages',
        '50'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true }) // PATCH succeeds
        .mockResolvedValueOnce({ ok: false, error: 'Fetch failed' }); // resolve fails

      await handleCharacterSettingsModal(interaction as never);

      // When refresh fails, handler should not call editReply (preserves state)
      expect(interaction.editReply).not.toHaveBeenCalled();
    });

    it('should handle thrown error in update handler gracefully', async () => {
      const interaction = createMockModalInteraction(
        'character-settings::modal::personality-123::maxMessages',
        '50'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      mockCallGatewayApi.mockRejectedValueOnce(new Error('Network error'));

      await handleCharacterSettingsModal(interaction as never);

      // Error is caught — handler should not propagate
      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });
});
