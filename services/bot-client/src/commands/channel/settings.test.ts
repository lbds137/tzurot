/**
 * Tests for Channel Context Dashboard
 *
 * Tests the interactive settings dashboard for channel context settings.
 *
 * This command uses deferralMode: 'ephemeral' which means:
 * - Framework calls deferReply before execute()
 * - Execute receives a DeferredCommandContext (not raw interaction)
 * - Tests must mock the context, not the interaction directly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  handleContext,
  handleChannelContextButton,
  handleChannelContextSelectMenu,
  handleChannelContextModal,
  isChannelContextInteraction,
} from './settings.js';

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
}));

// Mock GatewayClient - use vi.hoisted() for proper mock hoisting
const { mockGetChannelSettings, mockInvalidateChannelSettingsCache } = vi.hoisted(() => ({
  mockGetChannelSettings: vi.fn(),
  mockInvalidateChannelSettingsCache: vi.fn(),
}));

vi.mock('../../utils/GatewayClient.js', () => ({
  GatewayClient: class MockGatewayClient {
    getChannelSettings = mockGetChannelSettings;
  },
  invalidateChannelSettingsCache: mockInvalidateChannelSettingsCache,
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

describe('Channel Context Dashboard', () => {
  const mockChannelSettings = {
    settings: {
      activatedPersonalityId: 'personality-123',
    },
    activatedPersonalityId: 'personality-123',
  };

  /**
   * Create a mock DeferredCommandContext for testing.
   * The context wraps the interaction and provides type-safe methods.
   *
   * Note: createSettingsDashboard uses interaction.editReply directly,
   * so we need to mock that on the interaction object.
   */
  const createMockContext = (hasPermission = true): DeferredCommandContext => {
    // Mock editReply that can be shared
    const mockEditReply = vi.fn().mockResolvedValue({ id: 'message-123' });

    // Mock the underlying interaction - createSettingsDashboard uses this
    const mockInteraction = {
      deferred: true,
      replied: false,
      editReply: mockEditReply,
    };

    // Create mock context that mirrors DeferredCommandContext
    return {
      interaction: mockInteraction,
      user: { id: 'user-456' },
      guild: null,
      member: {
        permissions: {
          has: vi.fn().mockReturnValue(hasPermission),
        },
      },
      channel: null,
      channelId: 'channel-123',
      guildId: 'guild-123',
      commandName: 'channel',
      isEphemeral: true,
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: () => 'settings',
      getSubcommandGroup: () => null,
      // Context's editReply also uses the shared mock for consistency
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  };

  const createMockButtonInteraction = (
    customId: string
  ): ButtonInteraction & {
    deferUpdate: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    message: { id: string };
  } => {
    return {
      customId,
      user: { id: 'user-456' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      message: { id: 'message-123' },
    } as unknown as ButtonInteraction & {
      deferUpdate: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
      message: { id: string };
    };
  };

  const createMockSelectMenuInteraction = (
    customId: string,
    value: string
  ): StringSelectMenuInteraction & {
    deferUpdate: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    message: { id: string };
    values: string[];
  } => {
    return {
      customId,
      user: { id: 'user-456' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      message: { id: 'message-123' },
      values: [value],
    } as unknown as StringSelectMenuInteraction & {
      deferUpdate: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
      message: { id: string };
      values: string[];
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: resolve endpoint returns hardcoded defaults
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        maxMessages: 50,
        maxAge: null,
        maxImages: 10,
        memoryScoreThreshold: 0.5,
        memoryLimit: 20,
        focusModeEnabled: false,
        crossChannelHistoryEnabled: false,
        shareLtmAcrossPersonalities: false,
        sources: {
          maxMessages: 'hardcoded',
          maxAge: 'hardcoded',
          maxImages: 'hardcoded',
          memoryScoreThreshold: 'hardcoded',
          memoryLimit: 'hardcoded',
          focusModeEnabled: 'hardcoded',
          crossChannelHistoryEnabled: 'hardcoded',
          shareLtmAcrossPersonalities: 'hardcoded',
        },
      },
    });
  });

  describe('handleContext', () => {
    it('should require Manage Messages permission', async () => {
      const context = createMockContext(false);

      await handleContext(context);

      expect(context.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Manage Messages'),
      });
    });

    it('should display settings dashboard embed with permission', async () => {
      const context = createMockContext(true);
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleContext(context);

      expect(mockGetChannelSettings).toHaveBeenCalledWith('channel-123');
      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('should include Channel Settings title in embed', async () => {
      const context = createMockContext(true);
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleContext(context);

      const editReplyCall = (context.editReply as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(editReplyCall.embeds).toHaveLength(1);

      const embedJson = editReplyCall.embeds[0].toJSON();
      expect(embedJson.title).toBe('Channel Settings');
    });

    it('should include channel mention in embed description', async () => {
      const context = createMockContext(true);
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleContext(context);

      const editReplyCall = (context.editReply as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      expect(embedJson.description).toContain('<#channel-123>');
    });

    it('should include all 8 settings fields (extended context + memory)', async () => {
      const context = createMockContext(true);
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleContext(context);

      const editReplyCall = (context.editReply as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      // Both extended context and memory settings are shown at channel tier
      expect(embedJson.fields).toHaveLength(8);
      const fieldNames = embedJson.fields.map((f: { name: string }) => f.name);
      expect(fieldNames).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Max Messages'),
          expect.stringContaining('Max Age'),
          expect.stringContaining('Max Images'),
          expect.stringContaining('Focus Mode'),
          expect.stringContaining('Cross-Channel History'),
          expect.stringContaining('Share Memories'),
          expect.stringContaining('Memory Relevance'),
          expect.stringContaining('Memory Limit'),
        ])
      );
    });

    it('should handle no activated personality gracefully', async () => {
      const context = createMockContext(true);
      // Channel has no activated personality
      mockGetChannelSettings.mockResolvedValue({ settings: {} });

      await handleContext(context);

      // Should still display the dashboard (resolve is skipped, uses fallbacks)
      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('should use channel overrides with hardcoded defaults when no personality activated', async () => {
      const context = createMockContext(true);
      // No personality activated
      mockGetChannelSettings.mockResolvedValue({ settings: {} });
      // Channel has local overrides for maxMessages
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { configOverrides: { maxMessages: 25 } },
      });

      await handleContext(context);

      const editReplyCall = (context.editReply as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      // maxMessages should show the channel override value
      const maxMsgField = embedJson.fields.find((f: { name: string }) =>
        f.name.includes('Max Messages')
      );
      expect(maxMsgField).toBeDefined();
      // The channel override (25) should be reflected in the display
      expect(maxMsgField.value).toContain('25');
      // Override indicator shown (local value is set)
      expect(maxMsgField.value).toContain('Override');

      // Fields without overrides should show hardcoded defaults with Auto indicator
      const maxImgField = embedJson.fields.find((f: { name: string }) =>
        f.name.includes('Max Images')
      );
      expect(maxImgField).toBeDefined();
      expect(maxImgField.value).toContain('Auto');
    });

    it('should use fallback values when resolve endpoint fails', async () => {
      const context = createMockContext(true);
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);
      // Resolve endpoint returns error
      mockCallGatewayApi.mockResolvedValue({ ok: false, error: 'Not found' });

      await handleContext(context);

      // Should still display the dashboard with fallback data
      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
        })
      );
    });

    it('should handle unexpected errors gracefully', async () => {
      const context = createMockContext(true);
      mockGetChannelSettings.mockRejectedValue(new Error('Network error'));

      await handleContext(context);

      expect(context.editReply).toHaveBeenCalledWith({
        content: 'An error occurred while opening the context settings dashboard.',
      });
    });

    it('should not respond again if already replied', async () => {
      const context = createMockContext(true);
      // The interaction's `replied` property is checked in the error handler
      Object.defineProperty(context.interaction, 'replied', {
        get: () => true,
        configurable: true,
      });
      mockGetChannelSettings.mockRejectedValue(new Error('Network error'));

      await handleContext(context);

      // editReply should not be called when interaction.replied is true
      expect(context.editReply).not.toHaveBeenCalled();
    });
  });

  describe('isChannelContextInteraction', () => {
    it('should return true for channel context custom IDs', () => {
      expect(isChannelContextInteraction('channel-settings::select::chan-123')).toBe(true);
      expect(isChannelContextInteraction('channel-settings::set::chan-123::maxMessages:auto')).toBe(
        true
      );
      expect(isChannelContextInteraction('channel-settings::back::chan-123')).toBe(true);
      expect(isChannelContextInteraction('channel-settings::close::chan-123')).toBe(true);
    });

    it('should return false for non-channel-context custom IDs', () => {
      expect(isChannelContextInteraction('character-settings::select::aurora')).toBe(false);
      expect(isChannelContextInteraction('admin-settings::set::global')).toBe(false);
      // channel::list is channel list pagination, not settings
      expect(isChannelContextInteraction('channel::list::1::date')).toBe(false);
    });

    it('should return false for empty custom ID', () => {
      expect(isChannelContextInteraction('')).toBe(false);
    });
  });

  describe('handleChannelContextButton', () => {
    it('should ignore non-channel-context interactions', async () => {
      const interaction = createMockButtonInteraction('admin-settings::set::global::enabled:true');

      await handleChannelContextButton(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });

    it('should handle API failure gracefully', async () => {
      const interaction = {
        customId: 'channel-settings::set::channel-123::maxMessages:auto',
        user: { id: 'user-456' },
        reply: vi.fn(),
        update: vi.fn(),
        showModal: vi.fn(),
      };

      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-456',
          entityId: 'channel-123',
          data: {
            maxMessages: { localValue: null, effectiveValue: 50, source: 'global' },
            maxAge: { localValue: null, effectiveValue: 7200, source: 'global' },
            maxImages: { localValue: null, effectiveValue: 5, source: 'global' },
          },
          view: 'setting',
          activeSetting: 'maxMessages',
        },
      });

      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Server error',
      });

      await handleChannelContextButton(interaction as unknown as ButtonInteraction);

      // On failure, handler returns early and doesn't call editReply
      expect(interaction.update).not.toHaveBeenCalled();
    });
  });

  describe('handleChannelContextSelectMenu', () => {
    it('should ignore non-channel-context interactions', async () => {
      const interaction = createMockSelectMenuInteraction(
        'admin-settings::select::global',
        'enabled'
      );

      await handleChannelContextSelectMenu(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });
  });

  describe('handleChannelContextModal', () => {
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

    const createSessionWithSetting = (settingId: string) => ({
      data: {
        userId: 'user-456',
        entityId: 'channel-123',
        data: {
          maxMessages: { localValue: null, effectiveValue: 50, source: 'global' },
          maxAge: { localValue: null, effectiveValue: 7200, source: 'global' },
          maxImages: { localValue: null, effectiveValue: 5, source: 'global' },
        },
        view: 'setting',
        activeSetting: settingId,
      },
    });

    it('should ignore non-channel-context modal interactions', async () => {
      const interaction = createMockModalInteraction(
        'admin-settings::modal::global::enabled',
        '50'
      );

      await handleChannelContextModal(interaction as never);

      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should update maxMessages setting via config-overrides endpoint', async () => {
      const interaction = createMockModalInteraction(
        'channel-settings::modal::channel-123::maxMessages',
        '75'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      mockCallGatewayApi.mockResolvedValue({ ok: true });
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleChannelContextModal(interaction as never);

      // Should use new config-overrides endpoint with flat body shape
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/config-overrides',
        expect.objectContaining({
          method: 'PATCH',
          body: { maxMessages: 75 },
        })
      );
    });

    it('should update maxAge setting with duration string (2h)', async () => {
      const interaction = createMockModalInteraction(
        'channel-settings::modal::channel-123::maxAge',
        '2h'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      mockCallGatewayApi.mockResolvedValue({ ok: true });
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleChannelContextModal(interaction as never);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/config-overrides',
        expect.objectContaining({
          method: 'PATCH',
          body: { maxAge: 7200 },
        })
      );
    });

    it('should update maxAge setting to "off" (disabled)', async () => {
      const interaction = createMockModalInteraction(
        'channel-settings::modal::channel-123::maxAge',
        'off'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      mockCallGatewayApi.mockResolvedValue({ ok: true });
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleChannelContextModal(interaction as never);

      // "off" maps to -1 in the modal, mapSettingToApiUpdate converts -1 → null
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/config-overrides',
        expect.objectContaining({
          method: 'PATCH',
          body: { maxAge: null },
        })
      );
    });

    it('should update maxImages setting', async () => {
      const interaction = createMockModalInteraction(
        'channel-settings::modal::channel-123::maxImages',
        '10'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxImages'));
      mockCallGatewayApi.mockResolvedValue({ ok: true });
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleChannelContextModal(interaction as never);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/config-overrides',
        expect.objectContaining({
          method: 'PATCH',
          body: { maxImages: 10 },
        })
      );
    });

    it('should invalidate cache after successful update', async () => {
      const interaction = createMockModalInteraction(
        'channel-settings::modal::channel-123::maxMessages',
        '50'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      mockCallGatewayApi.mockResolvedValue({ ok: true });
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleChannelContextModal(interaction as never);

      expect(mockInvalidateChannelSettingsCache).toHaveBeenCalledWith('channel-123');
    });

    it('should handle network error gracefully', async () => {
      const interaction = createMockModalInteraction(
        'channel-settings::modal::channel-123::maxMessages',
        '50'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleChannelContextModal(interaction as never);

      // When update fails, handler returns early - verify interaction.editReply wasn't called
      expect(interaction.editReply).not.toHaveBeenCalled();
    });

    it('should handle API error response gracefully', async () => {
      const interaction = createMockModalInteraction(
        'channel-settings::modal::channel-123::maxMessages',
        '50'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      // First call is PATCH (returns error), second would be resolve (not called)
      mockCallGatewayApi.mockResolvedValue({ ok: false, error: 'Validation failed' });

      await handleChannelContextModal(interaction as never);

      // Cache should NOT be invalidated on failure
      expect(mockInvalidateChannelSettingsCache).not.toHaveBeenCalled();
    });
  });
});
