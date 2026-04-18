/**
 * Tests for User Default Settings Dashboard
 *
 * Tests the interactive settings dashboard for user-default config overrides.
 * Note: handleDefaultsEdit receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import {
  handleDefaultsEdit,
  handleUserDefaultsButton,
  handleUserDefaultsSelectMenu,
  handleUserDefaultsModal,
  isUserDefaultsInteraction,
} from './edit.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { HARDCODED_CONFIG_DEFAULTS } from '@tzurot/common-types';

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
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  GATEWAY_TIMEOUTS: { AUTOCOMPLETE: 2500, DEFERRED: 10000 },
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

vi.mock('../../../utils/dashboard/SessionManager.js', () => ({
  getSessionManager: vi.fn(() => mockSessionManager),
  DashboardSessionManager: {
    getInstance: vi.fn(() => mockSessionManager),
  },
}));

describe('User Default Settings Dashboard', () => {
  const mockResolveDefaultsResponse = {
    maxMessages: HARDCODED_CONFIG_DEFAULTS.maxMessages,
    maxAge: HARDCODED_CONFIG_DEFAULTS.maxAge,
    maxImages: HARDCODED_CONFIG_DEFAULTS.maxImages,
    focusModeEnabled: HARDCODED_CONFIG_DEFAULTS.focusModeEnabled,
    crossChannelHistoryEnabled: HARDCODED_CONFIG_DEFAULTS.crossChannelHistoryEnabled,
    shareLtmAcrossPersonalities: HARDCODED_CONFIG_DEFAULTS.shareLtmAcrossPersonalities,
    memoryScoreThreshold: HARDCODED_CONFIG_DEFAULTS.memoryScoreThreshold,
    memoryLimit: HARDCODED_CONFIG_DEFAULTS.memoryLimit,
    sources: {
      maxMessages: 'hardcoded',
      maxAge: 'hardcoded',
      maxImages: 'hardcoded',
      focusModeEnabled: 'hardcoded',
      crossChannelHistoryEnabled: 'hardcoded',
      shareLtmAcrossPersonalities: 'hardcoded',
      memoryScoreThreshold: 'hardcoded',
      memoryLimit: 'hardcoded',
    },
    userOverrides: null,
  };

  /**
   * Create a mock DeferredCommandContext for testing handleDefaultsEdit.
   *
   * Note: createSettingsDashboard receives context.interaction directly and calls
   * interaction.editReply(), so the mock interaction must have editReply too.
   */
  function createMockContext(): DeferredCommandContext & {
    editReply: ReturnType<typeof vi.fn>;
    interaction: { editReply: ReturnType<typeof vi.fn>; deferred: boolean; replied: boolean };
  } {
    const mockEditReply = vi.fn().mockResolvedValue({ id: 'message-123' });

    const mockInteraction = {
      editReply: mockEditReply,
      deferred: true,
      replied: false,
    };

    return {
      interaction: mockInteraction,
      user: { id: 'user-456' },
      guild: null,
      member: null,
      channel: null,
      channelId: 'channel-123',
      guildId: null,
      commandName: 'settings',
      isEphemeral: true,
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: () => 'edit',
      getSubcommandGroup: () => 'defaults',
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext & {
      editReply: ReturnType<typeof vi.fn>;
      interaction: { editReply: ReturnType<typeof vi.fn>; deferred: boolean; replied: boolean };
    };
  }

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
  });

  describe('handleDefaultsEdit', () => {
    it('should display settings dashboard embed', async () => {
      const context = createMockContext();
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: mockResolveDefaultsResponse,
      });

      await handleDefaultsEdit(context);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/config-overrides/resolve-defaults', {
        method: 'GET',
        user: {
          discordId: 'user-456',
          username: 'testuser',
          displayName: 'testuser',
        },
        timeout: 10000,
      });
      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('should include "Your Default Settings" title in embed', async () => {
      const context = createMockContext();
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: mockResolveDefaultsResponse,
      });

      await handleDefaultsEdit(context);

      const editReplyCall = context.editReply.mock.calls[0][0];
      expect(editReplyCall.embeds).toHaveLength(1);

      const embedJson = editReplyCall.embeds[0].toJSON();
      expect(embedJson.title).toBe('Your Default Settings');
    });

    it('should include all 10 settings fields', async () => {
      const context = createMockContext();
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: mockResolveDefaultsResponse,
      });

      await handleDefaultsEdit(context);

      const editReplyCall = context.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      expect(embedJson.fields).toHaveLength(10);
      expect(embedJson.fields.map((f: { name: string }) => f.name)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Max Messages'),
          expect.stringContaining('Max Age'),
          expect.stringContaining('Max Images'),
          expect.stringContaining('Focus Mode'),
          expect.stringContaining('Cross-Channel History'),
          expect.stringContaining('Share Memories'),
          expect.stringContaining('Memory Relevance'),
          expect.stringContaining('Memory Limit'),
          expect.stringContaining('Model Footer'),
          expect.stringContaining('Voice Response Mode'),
        ])
      );
    });

    it('should include select menu and close button', async () => {
      const context = createMockContext();
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: mockResolveDefaultsResponse,
      });

      await handleDefaultsEdit(context);

      const editReplyCall = context.editReply.mock.calls[0][0];
      expect(editReplyCall.components).toHaveLength(2);
    });

    it('should display description note about defaults', async () => {
      const context = createMockContext();
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: mockResolveDefaultsResponse,
      });

      await handleDefaultsEdit(context);

      const editReplyCall = context.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();
      expect(embedJson.description).toContain(
        'These defaults apply across all personalities unless overridden.'
      );
    });

    it('should handle API failure with fallback data', async () => {
      const context = createMockContext();
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Server error',
        status: 500,
      });

      await handleDefaultsEdit(context);

      // Should still display dashboard with hardcoded defaults as fallback
      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('should handle unexpected errors gracefully', async () => {
      const context = createMockContext();
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleDefaultsEdit(context);

      expect(context.editReply).toHaveBeenCalledWith({
        content: '❌ An error occurred while opening the default settings dashboard.',
      });
    });

    it('should not respond again if already replied', async () => {
      const context = createMockContext();
      Object.defineProperty(context.interaction, 'replied', {
        get: () => true,
        configurable: true,
      });
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleDefaultsEdit(context);

      expect(context.editReply).not.toHaveBeenCalled();
    });

    it('should correctly map user overrides to localValue', async () => {
      const context = createMockContext();
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          ...mockResolveDefaultsResponse,
          maxMessages: 30,
          sources: { ...mockResolveDefaultsResponse.sources, maxMessages: 'user-default' },
          userOverrides: { maxMessages: 30 },
        },
      });

      await handleDefaultsEdit(context);

      // Dashboard should display with override indicator
      const editReplyCall = context.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();
      // The maxMessages field should show the override value
      const maxMessagesField = embedJson.fields.find((f: { name: string }) =>
        f.name.includes('Max Messages')
      );
      expect(maxMessagesField).toBeDefined();
      expect(maxMessagesField.value).toContain('30');
    });
  });

  describe('isUserDefaultsInteraction', () => {
    it('should return true for user-defaults-settings custom IDs', () => {
      expect(isUserDefaultsInteraction('user-defaults-settings::select::user-456')).toBe(true);
      expect(
        isUserDefaultsInteraction('user-defaults-settings::set::user-456::maxMessages:auto')
      ).toBe(true);
      expect(isUserDefaultsInteraction('user-defaults-settings::back::user-456')).toBe(true);
      expect(isUserDefaultsInteraction('user-defaults-settings::close::user-456')).toBe(true);
    });

    it('should return false for non-user-defaults custom IDs', () => {
      expect(isUserDefaultsInteraction('admin-settings::select::global')).toBe(false);
      expect(isUserDefaultsInteraction('channel-settings::set::chan-123')).toBe(false);
      expect(isUserDefaultsInteraction('character-settings::set::aurora')).toBe(false);
    });

    it('should return false for empty custom ID', () => {
      expect(isUserDefaultsInteraction('')).toBe(false);
    });
  });

  describe('handleUserDefaultsButton', () => {
    it('should ignore non-user-defaults interactions', async () => {
      const interaction = createMockButtonInteraction('admin-settings::set::global::enabled:true');

      await handleUserDefaultsButton(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });

    it('should handle API failure gracefully', async () => {
      const interaction = {
        customId: 'user-defaults-settings::set::user-456::maxMessages:auto',
        user: { id: 'user-456' },
        reply: vi.fn(),
        update: vi.fn(),
        showModal: vi.fn(),
      };

      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-456',
          entityId: 'user-456',
          data: {
            maxMessages: { localValue: 50, effectiveValue: 50, source: 'hardcoded' },
            maxAge: { localValue: null, effectiveValue: null, source: 'hardcoded' },
            maxImages: { localValue: 5, effectiveValue: 5, source: 'hardcoded' },
          },
          view: 'setting',
          activeSetting: 'maxMessages',
        },
      });

      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Server error',
        status: 500,
      });

      await handleUserDefaultsButton(interaction as unknown as ButtonInteraction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Server error'),
        })
      );
    });

    it('should handle unknown setting ID', async () => {
      const interaction = {
        customId: 'user-defaults-settings::set::user-456::unknownSetting:value',
        user: { id: 'user-456' },
        reply: vi.fn(),
        update: vi.fn(),
        showModal: vi.fn(),
      };

      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-456',
          entityId: 'user-456',
          data: {
            maxMessages: { localValue: 50, effectiveValue: 50, source: 'hardcoded' },
          },
          view: 'setting',
          activeSetting: 'unknownSetting',
        },
      });

      await handleUserDefaultsButton(interaction as unknown as ButtonInteraction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Unknown setting'),
        })
      );
    });
  });

  describe('handleUserDefaultsSelectMenu', () => {
    it('should ignore non-user-defaults interactions', async () => {
      const interaction = createMockSelectMenuInteraction(
        'admin-settings::select::global',
        'maxMessages'
      );

      await handleUserDefaultsSelectMenu(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });
  });

  describe('handleUserDefaultsModal', () => {
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
        user: {
          discordId: 'user-456',
          username: 'testuser',
          displayName: 'testuser',
        },
        entityId: 'user-456',
        data: {
          maxMessages: { localValue: 50, effectiveValue: 50, source: 'hardcoded' },
          maxAge: { localValue: null, effectiveValue: null, source: 'hardcoded' },
          maxImages: { localValue: 5, effectiveValue: 5, source: 'hardcoded' },
        },
        view: 'setting',
        activeSetting: settingId,
      },
    });

    it('should ignore non-user-defaults modal interactions', async () => {
      const interaction = createMockModalInteraction(
        'admin-settings::modal::global::maxMessages',
        '50'
      );

      await handleUserDefaultsModal(interaction as never);

      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should update maxMessages setting', async () => {
      const interaction = createMockModalInteraction(
        'user-defaults-settings::modal::user-456::maxMessages',
        '30'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true, data: { configDefaults: { maxMessages: 30 } } })
        .mockResolvedValueOnce({ ok: true, data: mockResolveDefaultsResponse });

      await handleUserDefaultsModal(interaction as never);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/config-overrides/defaults', {
        method: 'PATCH',
        body: { maxMessages: 30 },
        user: {
          discordId: 'user-456',
          username: 'testuser',
          displayName: 'testuser',
        },
        timeout: 10000,
      });
    });

    it('should update maxAge setting with duration string', async () => {
      const interaction = createMockModalInteraction(
        'user-defaults-settings::modal::user-456::maxAge',
        '2h'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true, data: { configDefaults: { maxAge: 7200 } } })
        .mockResolvedValueOnce({ ok: true, data: mockResolveDefaultsResponse });

      await handleUserDefaultsModal(interaction as never);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/config-overrides/defaults', {
        method: 'PATCH',
        body: { maxAge: 7200 },
        user: {
          discordId: 'user-456',
          username: 'testuser',
          displayName: 'testuser',
        },
        timeout: 10000,
      });
    });

    it('should clear override when set to "auto"', async () => {
      const interaction = createMockModalInteraction(
        'user-defaults-settings::modal::user-456::maxMessages',
        'auto'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true, data: { configDefaults: null } })
        .mockResolvedValueOnce({ ok: true, data: mockResolveDefaultsResponse });

      await handleUserDefaultsModal(interaction as never);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/config-overrides/defaults', {
        method: 'PATCH',
        body: { maxMessages: null },
        user: {
          discordId: 'user-456',
          username: 'testuser',
          displayName: 'testuser',
        },
        timeout: 10000,
      });
    });

    it('should handle network error gracefully', async () => {
      const interaction = createMockModalInteraction(
        'user-defaults-settings::modal::user-456::maxMessages',
        '50'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      // Should not throw
      await handleUserDefaultsModal(interaction as never);

      expect(mockCallGatewayApi).toHaveBeenCalled();
      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });
});
