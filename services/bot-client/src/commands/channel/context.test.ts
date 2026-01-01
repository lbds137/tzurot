/**
 * Tests for Channel Context Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { handleContext } from './context.js';

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

const mockGetChannelSettings = vi.fn();
const mockGetExtendedContextDefault = vi.fn();
const mockInvalidateChannelSettingsCache = vi.fn();
vi.mock('../../utils/GatewayClient.js', () => ({
  GatewayClient: vi.fn().mockImplementation(() => ({
    getChannelSettings: mockGetChannelSettings,
    getExtendedContextDefault: mockGetExtendedContextDefault,
  })),
  invalidateChannelSettingsCache: (...args: unknown[]) =>
    mockInvalidateChannelSettingsCache(...args),
}));

describe('Channel Context Subcommand', () => {
  const createMockInteraction = (
    action: string,
    hasPermission = true
  ): ChatInputCommandInteraction & { reply: ReturnType<typeof vi.fn>; editReply: ReturnType<typeof vi.fn>; deferReply: ReturnType<typeof vi.fn> } => {
    return {
      options: {
        getString: vi.fn().mockReturnValue(action),
      },
      channelId: 'channel-123',
      user: { id: 'user-456' },
      memberPermissions: {
        has: vi.fn().mockReturnValue(hasPermission),
      },
      reply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      deferReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction & {
      reply: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
      deferReply: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('permission check', () => {
    it('should reject users without Manage Messages permission', async () => {
      const interaction = createMockInteraction('enable', false);

      await handleContext(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('Manage Messages'),
        ephemeral: true,
      });
      expect(mockCallGatewayApi).not.toHaveBeenCalled();
    });
  });

  describe('enable action', () => {
    it('should enable extended context and invalidate cache', async () => {
      const interaction = createMockInteraction('enable');
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleContext(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/extended-context',
        expect.objectContaining({
          method: 'PATCH',
          body: { extendedContext: true },
          userId: 'user-456',
        })
      );
      expect(mockInvalidateChannelSettingsCache).toHaveBeenCalledWith('channel-123');
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Extended context enabled'),
      });
    });

    it('should handle API errors gracefully', async () => {
      const interaction = createMockInteraction('enable');
      mockCallGatewayApi.mockResolvedValue({ ok: false, error: 'Server error', status: 500 });

      await handleContext(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to enable'),
      });
      expect(mockInvalidateChannelSettingsCache).not.toHaveBeenCalled();
    });
  });

  describe('disable action', () => {
    it('should disable extended context and invalidate cache', async () => {
      const interaction = createMockInteraction('disable');
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleContext(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/extended-context',
        expect.objectContaining({
          method: 'PATCH',
          body: { extendedContext: false },
        })
      );
      expect(mockInvalidateChannelSettingsCache).toHaveBeenCalledWith('channel-123');
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Extended context disabled'),
      });
    });
  });

  describe('status action', () => {
    it('should defer reply for status check', async () => {
      const interaction = createMockInteraction('status');
      mockGetChannelSettings.mockResolvedValue({
        hasSettings: true,
        settings: { extendedContext: true },
      });
      mockGetExtendedContextDefault.mockResolvedValue(false);

      await handleContext(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });
  });

  describe('clear action', () => {
    it('should send clear request to API', async () => {
      const interaction = createMockInteraction('clear');
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });
      mockGetExtendedContextDefault.mockResolvedValue(true);

      await handleContext(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/extended-context',
        expect.objectContaining({
          method: 'PATCH',
          body: { extendedContext: null },
        })
      );
    });

    it('should invalidate cache on success', async () => {
      const interaction = createMockInteraction('clear');
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });
      mockGetExtendedContextDefault.mockResolvedValue(true);

      await handleContext(interaction);

      expect(mockInvalidateChannelSettingsCache).toHaveBeenCalledWith('channel-123');
    });

    it('should handle clear API failure', async () => {
      const interaction = createMockInteraction('clear');
      mockCallGatewayApi.mockResolvedValue({ ok: false, error: 'Not found', status: 404 });

      await handleContext(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to clear'),
      });
      expect(mockInvalidateChannelSettingsCache).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors gracefully', async () => {
      const interaction = createMockInteraction('enable');
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleContext(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('error occurred'),
        ephemeral: true,
      });
    });
  });
});
