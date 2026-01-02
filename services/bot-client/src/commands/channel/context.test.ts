/**
 * Tests for Channel Context Dashboard
 *
 * Tests the interactive settings dashboard for channel context settings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import {
  handleContext,
  handleChannelContextButton,
  handleChannelContextSelectMenu,
  handleChannelContextModal,
  isChannelContextInteraction,
} from './context.js';

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
const { mockGetChannelSettings, mockGetAdminSettings, mockInvalidateChannelSettingsCache } =
  vi.hoisted(() => ({
    mockGetChannelSettings: vi.fn(),
    mockGetAdminSettings: vi.fn(),
    mockInvalidateChannelSettingsCache: vi.fn(),
  }));

vi.mock('../../utils/GatewayClient.js', () => ({
  GatewayClient: class MockGatewayClient {
    getChannelSettings = mockGetChannelSettings;
    getAdminSettings = mockGetAdminSettings;
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
      extendedContext: null,
      extendedContextMaxMessages: null,
      extendedContextMaxAge: null,
      extendedContextMaxImages: null,
    },
  };

  const mockAdminSettings = {
    extendedContextDefault: true,
    extendedContextMaxMessages: 50,
    extendedContextMaxAge: 7200,
    extendedContextMaxImages: 5,
  };

  const createMockInteraction = (
    hasPermission = true
  ): ChatInputCommandInteraction & {
    reply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    deferred: boolean;
    replied: boolean;
  } => {
    return {
      channelId: 'channel-123',
      user: { id: 'user-456' },
      memberPermissions: {
        has: vi.fn().mockReturnValue(hasPermission),
      },
      reply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue({ id: 'message-123' }),
      deferred: true,
      replied: false,
    } as unknown as ChatInputCommandInteraction & {
      reply: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
      deferred: boolean;
      replied: boolean;
    };
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
  });

  describe('handleContext', () => {
    it('should require Manage Messages permission', async () => {
      const interaction = createMockInteraction(false);

      await handleContext(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Manage Messages'),
      });
    });

    it('should display settings dashboard embed with permission', async () => {
      const interaction = createMockInteraction(true);
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleContext(interaction);

      expect(mockGetChannelSettings).toHaveBeenCalledWith('channel-123');
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('should include Channel Settings title in embed', async () => {
      const interaction = createMockInteraction(true);
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleContext(interaction);

      const editReplyCall = interaction.editReply.mock.calls[0][0];
      expect(editReplyCall.embeds).toHaveLength(1);

      const embedJson = editReplyCall.embeds[0].toJSON();
      expect(embedJson.title).toBe('Channel Settings');
    });

    it('should include channel mention in embed description', async () => {
      const interaction = createMockInteraction(true);
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleContext(interaction);

      const editReplyCall = interaction.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      expect(embedJson.description).toContain('<#channel-123>');
    });

    it('should include all 4 settings fields', async () => {
      const interaction = createMockInteraction(true);
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleContext(interaction);

      const editReplyCall = interaction.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      expect(embedJson.fields).toHaveLength(4);
    });

    it('should handle admin settings fetch failure', async () => {
      const interaction = createMockInteraction(true);
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);
      mockGetAdminSettings.mockResolvedValue(null);

      await handleContext(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Failed to fetch global settings.',
      });
    });

    it('should handle unexpected errors gracefully', async () => {
      const interaction = createMockInteraction(true);
      mockGetChannelSettings.mockRejectedValue(new Error('Network error'));

      await handleContext(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'An error occurred while opening the context settings dashboard.',
      });
    });

    it('should not respond again if already replied', async () => {
      const interaction = createMockInteraction(true);
      Object.defineProperty(interaction, 'replied', {
        get: () => true,
        configurable: true,
      });
      mockGetChannelSettings.mockRejectedValue(new Error('Network error'));

      await handleContext(interaction);

      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });

  describe('isChannelContextInteraction', () => {
    it('should return true for channel context custom IDs', () => {
      expect(isChannelContextInteraction('channel-context::select::chan-123')).toBe(true);
      expect(isChannelContextInteraction('channel-context::set::chan-123::enabled:true')).toBe(
        true
      );
      expect(isChannelContextInteraction('channel-context::back::chan-123')).toBe(true);
      expect(isChannelContextInteraction('channel-context::close::chan-123')).toBe(true);
    });

    it('should return false for non-channel-context custom IDs', () => {
      expect(isChannelContextInteraction('personality-settings::select::aurora')).toBe(false);
      expect(isChannelContextInteraction('admin-settings::set::global')).toBe(false);
      expect(isChannelContextInteraction('character::edit::my-char')).toBe(false);
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

    it('should call update handler when setting enabled to true', async () => {
      const interaction = {
        customId: 'channel-context::set::channel-123::enabled:true',
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
            enabled: { localValue: null, effectiveValue: true, source: 'global' },
            maxMessages: { localValue: null, effectiveValue: 50, source: 'global' },
            maxAge: { localValue: null, effectiveValue: 7200, source: 'global' },
            maxImages: { localValue: null, effectiveValue: 5, source: 'global' },
          },
          view: 'setting',
          activeSetting: 'enabled',
        },
      });

      mockCallGatewayApi.mockResolvedValue({ ok: true });
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleChannelContextButton(interaction as unknown as ButtonInteraction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/extended-context',
        expect.objectContaining({
          method: 'PATCH',
          body: { extendedContext: true },
        })
      );
    });

    it('should handle setting enabled to auto (null)', async () => {
      const interaction = {
        customId: 'channel-context::set::channel-123::enabled:auto',
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
            enabled: { localValue: true, effectiveValue: true, source: 'channel' },
            maxMessages: { localValue: null, effectiveValue: 50, source: 'global' },
            maxAge: { localValue: null, effectiveValue: 7200, source: 'global' },
            maxImages: { localValue: null, effectiveValue: 5, source: 'global' },
          },
          view: 'setting',
          activeSetting: 'enabled',
        },
      });

      mockCallGatewayApi.mockResolvedValue({ ok: true });
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleChannelContextButton(interaction as unknown as ButtonInteraction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/extended-context',
        expect.objectContaining({
          method: 'PATCH',
          body: { extendedContext: null },
        })
      );
    });

    it('should handle API failure gracefully', async () => {
      const interaction = {
        customId: 'channel-context::set::channel-123::enabled:true',
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
            enabled: { localValue: null, effectiveValue: true, source: 'global' },
            maxMessages: { localValue: null, effectiveValue: 50, source: 'global' },
            maxAge: { localValue: null, effectiveValue: 7200, source: 'global' },
            maxImages: { localValue: null, effectiveValue: 5, source: 'global' },
          },
          view: 'setting',
          activeSetting: 'enabled',
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
          enabled: { localValue: null, effectiveValue: true, source: 'global' },
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

    it('should update maxMessages setting', async () => {
      const interaction = createMockModalInteraction(
        'channel-context::modal::channel-123::maxMessages',
        '75'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      mockCallGatewayApi.mockResolvedValue({ ok: true });
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleChannelContextModal(interaction as never);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/extended-context',
        expect.objectContaining({
          method: 'PATCH',
          body: { extendedContextMaxMessages: 75 },
        })
      );
    });

    it('should update maxAge setting with duration string (2h)', async () => {
      const interaction = createMockModalInteraction(
        'channel-context::modal::channel-123::maxAge',
        '2h'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      mockCallGatewayApi.mockResolvedValue({ ok: true });
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleChannelContextModal(interaction as never);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/extended-context',
        expect.objectContaining({
          method: 'PATCH',
          body: { extendedContextMaxAge: 7200 },
        })
      );
    });

    it('should update maxAge setting to "off" (disabled)', async () => {
      const interaction = createMockModalInteraction(
        'channel-context::modal::channel-123::maxAge',
        'off'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      mockCallGatewayApi.mockResolvedValue({ ok: true });
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleChannelContextModal(interaction as never);

      // "off" maps to null for channel settings
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/extended-context',
        expect.objectContaining({
          method: 'PATCH',
          body: { extendedContextMaxAge: null },
        })
      );
    });

    it('should update maxImages setting', async () => {
      const interaction = createMockModalInteraction(
        'channel-context::modal::channel-123::maxImages',
        '10'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxImages'));
      mockCallGatewayApi.mockResolvedValue({ ok: true });
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleChannelContextModal(interaction as never);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/extended-context',
        expect.objectContaining({
          method: 'PATCH',
          body: { extendedContextMaxImages: 10 },
        })
      );
    });

    it('should invalidate cache after successful update', async () => {
      const interaction = createMockModalInteraction(
        'channel-context::modal::channel-123::maxMessages',
        '50'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      mockCallGatewayApi.mockResolvedValue({ ok: true });
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleChannelContextModal(interaction as never);

      expect(mockInvalidateChannelSettingsCache).toHaveBeenCalledWith('channel-123');
    });

    it('should handle network error gracefully', async () => {
      const interaction = createMockModalInteraction(
        'channel-context::modal::channel-123::maxMessages',
        '50'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleChannelContextModal(interaction as never);

      // When update fails, handler returns early
      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });
});
