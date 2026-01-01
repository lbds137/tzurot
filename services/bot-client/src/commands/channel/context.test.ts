/**
 * Tests for Channel Context Subcommand
 *
 * @see docs/standards/TRI_STATE_PATTERN.md
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

// Use vi.hoisted to ensure mock functions are available before vi.mock hoisting
const {
  mockGetChannelSettings,
  mockGetExtendedContextDefault,
  mockInvalidateChannelSettingsCache,
} = vi.hoisted(() => ({
  mockGetChannelSettings: vi.fn(),
  mockGetExtendedContextDefault: vi.fn(),
  mockInvalidateChannelSettingsCache: vi.fn(),
}));

vi.mock('../../utils/GatewayClient.js', () => ({
  GatewayClient: class MockGatewayClient {
    getChannelSettings = mockGetChannelSettings;
    getExtendedContextDefault = mockGetExtendedContextDefault;
  },
  invalidateChannelSettingsCache: mockInvalidateChannelSettingsCache,
}));

describe('Channel Context Subcommand', () => {
  const createMockInteraction = (
    action: string,
    hasPermission = true
  ): ChatInputCommandInteraction & {
    reply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    deferred: boolean;
    replied: boolean;
  } => {
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
      // Top-level interactionCreate handler already defers
      deferred: true,
      replied: false,
    } as unknown as ChatInputCommandInteraction & {
      reply: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
      deferred: boolean;
      replied: boolean;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('permission check', () => {
    it('should reject users without Manage Messages permission', async () => {
      const interaction = createMockInteraction('enable', false);

      await handleContext(interaction);

      // Uses editReply since top-level handler already deferred
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Manage Messages'),
      });
      expect(mockCallGatewayApi).not.toHaveBeenCalled();
    });
  });

  describe('enable action (force ON)', () => {
    it('should enable extended context and invalidate cache', async () => {
      const interaction = createMockInteraction('enable');
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleContext(interaction);

      // Note: deferReply is handled by top-level interactionCreate handler
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
        content: expect.stringContaining('set to On'),
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

  describe('disable action (force OFF)', () => {
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
        content: expect.stringContaining('set to Off'),
      });
    });
  });

  describe('status action', () => {
    it('should show status with channel override ON', async () => {
      const interaction = createMockInteraction('status');
      mockGetChannelSettings.mockResolvedValue({
        hasSettings: true,
        settings: { extendedContext: true },
      });
      mockGetExtendedContextDefault.mockResolvedValue(false);

      await handleContext(interaction);

      // Note: deferReply is handled by top-level interactionCreate handler
      expect(mockGetChannelSettings).toHaveBeenCalledWith('channel-123');
      expect(mockGetExtendedContextDefault).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringMatching(
          /Extended Context for this channel[\s\S]*Setting: \*\*On\*\*/
        ),
      });
    });

    it('should show status with channel override OFF', async () => {
      const interaction = createMockInteraction('status');
      mockGetChannelSettings.mockResolvedValue({
        hasSettings: true,
        settings: { extendedContext: false },
      });
      mockGetExtendedContextDefault.mockResolvedValue(true);

      await handleContext(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringMatching(/Setting: \*\*Off\*\*/),
      });
    });

    it('should show status with AUTO using global default (enabled)', async () => {
      const interaction = createMockInteraction('status');
      mockGetChannelSettings.mockResolvedValue({
        hasSettings: false,
        settings: null,
      });
      mockGetExtendedContextDefault.mockResolvedValue(true);

      await handleContext(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringMatching(
          /Setting: \*\*Auto\*\*[\s\S]*\*\*enabled\*\* \(from global\)/
        ),
      });
    });

    it('should show status with AUTO using global default (disabled)', async () => {
      const interaction = createMockInteraction('status');
      mockGetChannelSettings.mockResolvedValue({
        hasSettings: true,
        settings: { extendedContext: null },
      });
      mockGetExtendedContextDefault.mockResolvedValue(false);

      await handleContext(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringMatching(
          /Setting: \*\*Auto\*\*[\s\S]*\*\*disabled\*\* \(from global\)/
        ),
      });
    });
  });

  describe('auto action (follow global)', () => {
    it('should send null to API for auto mode', async () => {
      const interaction = createMockInteraction('auto');
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });
      mockGetExtendedContextDefault.mockResolvedValue(true);

      await handleContext(interaction);

      // Note: deferReply is handled by top-level interactionCreate handler
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/extended-context',
        expect.objectContaining({
          method: 'PATCH',
          body: { extendedContext: null },
        })
      );
    });

    it('should invalidate cache on success', async () => {
      const interaction = createMockInteraction('auto');
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });
      mockGetExtendedContextDefault.mockResolvedValue(true);

      await handleContext(interaction);

      expect(mockInvalidateChannelSettingsCache).toHaveBeenCalledWith('channel-123');
    });

    it('should show effective value from global after setting auto', async () => {
      const interaction = createMockInteraction('auto');
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });
      mockGetExtendedContextDefault.mockResolvedValue(true);

      await handleContext(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringMatching(/set to Auto[\s\S]*Currently: \*\*enabled\*\*/),
      });
    });

    it('should handle auto API failure', async () => {
      const interaction = createMockInteraction('auto');
      mockCallGatewayApi.mockResolvedValue({ ok: false, error: 'Not found', status: 404 });

      await handleContext(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to set auto'),
      });
      expect(mockInvalidateChannelSettingsCache).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors with editReply', async () => {
      const interaction = createMockInteraction('enable');
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleContext(interaction);

      // Uses editReply since top-level handler already deferred
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('error occurred'),
      });
    });

    it('should not respond again if already replied', async () => {
      const interaction = createMockInteraction('enable');
      // Simulate already having replied
      Object.defineProperty(interaction, 'replied', {
        get: () => true,
        configurable: true,
      });
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleContext(interaction);

      // Should not call editReply again since already replied
      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });
});
