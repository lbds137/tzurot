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
});
