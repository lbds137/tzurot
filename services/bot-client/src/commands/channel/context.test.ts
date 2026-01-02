/**
 * Tests for Channel Context Subcommand
 *
 * @see docs/standards/TRI_STATE_PATTERN.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionFlagsBits, EmbedBuilder } from 'discord.js';
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
  mockGetAdminSettings,
  mockGetExtendedContextDefault,
  mockInvalidateChannelSettingsCache,
} = vi.hoisted(() => ({
  mockGetChannelSettings: vi.fn(),
  mockGetAdminSettings: vi.fn(),
  mockGetExtendedContextDefault: vi.fn(),
  mockInvalidateChannelSettingsCache: vi.fn(),
}));

vi.mock('../../utils/GatewayClient.js', () => ({
  GatewayClient: class MockGatewayClient {
    getChannelSettings = mockGetChannelSettings;
    getAdminSettings = mockGetAdminSettings;
    getExtendedContextDefault = mockGetExtendedContextDefault;
  },
  invalidateChannelSettingsCache: mockInvalidateChannelSettingsCache,
}));

describe('Channel Context Subcommand', () => {
  const createMockInteraction = (
    action: string,
    hasPermission = true,
    options: { value?: number | null; duration?: string | null } = {}
  ): ChatInputCommandInteraction & {
    reply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    deferred: boolean;
    replied: boolean;
  } => {
    return {
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'action') return action;
          if (name === 'duration') return options.duration ?? null;
          return null;
        }),
        getInteger: vi.fn((name: string) => {
          if (name === 'value') return options.value ?? null;
          return null;
        }),
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

  const createMockAdminSettings = (overrides = {}) => ({
    extendedContextDefault: true,
    extendedContextMaxMessages: 20,
    extendedContextMaxAge: 7200,
    extendedContextMaxImages: 5,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default admin settings
    mockGetAdminSettings.mockResolvedValue(createMockAdminSettings());
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
    it('should show status with embed and all settings', async () => {
      const interaction = createMockInteraction('status');
      mockGetChannelSettings.mockResolvedValue({
        hasSettings: true,
        settings: {
          extendedContext: true,
          extendedContextMaxMessages: 50,
          extendedContextMaxAge: 3600,
          extendedContextMaxImages: 10,
        },
      });

      await handleContext(interaction);

      expect(mockGetChannelSettings).toHaveBeenCalledWith('channel-123');
      expect(mockGetAdminSettings).toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });
    });

    it('should handle missing admin settings gracefully', async () => {
      const interaction = createMockInteraction('status');
      mockGetChannelSettings.mockResolvedValue({ hasSettings: false, settings: null });
      mockGetAdminSettings.mockResolvedValue(null);

      await handleContext(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to fetch global settings'),
      });
    });

    it('should show channel settings with global fallback', async () => {
      const interaction = createMockInteraction('status');
      mockGetChannelSettings.mockResolvedValue({
        hasSettings: true,
        settings: {
          extendedContext: null, // Use global default
          extendedContextMaxMessages: 30, // Channel override
          extendedContextMaxAge: null, // Use global default
          extendedContextMaxImages: null, // Use global default
        },
      });
      mockGetAdminSettings.mockResolvedValue(
        createMockAdminSettings({
          extendedContextDefault: true,
          extendedContextMaxMessages: 20,
          extendedContextMaxAge: 7200,
          extendedContextMaxImages: 5,
        })
      );

      await handleContext(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
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

  describe('set-max-messages action', () => {
    it('should show current value when no value provided', async () => {
      const interaction = createMockInteraction('set-max-messages', true, { value: null });
      mockGetChannelSettings.mockResolvedValue({
        hasSettings: true,
        settings: { extendedContextMaxMessages: 50 },
      });

      await handleContext(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max Messages'),
      });
    });

    it('should update max messages with valid value', async () => {
      const interaction = createMockInteraction('set-max-messages', true, { value: 50 });
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleContext(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/extended-context',
        expect.objectContaining({
          method: 'PATCH',
          body: { extendedContextMaxMessages: 50 },
        })
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max messages set to 50'),
      });
    });

    it('should set to auto when value is 0', async () => {
      const interaction = createMockInteraction('set-max-messages', true, { value: 0 });
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleContext(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/extended-context',
        expect.objectContaining({
          body: { extendedContextMaxMessages: null },
        })
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Auto'),
      });
    });
  });

  describe('set-max-age action', () => {
    it('should show current value when no duration provided', async () => {
      const interaction = createMockInteraction('set-max-age', true, { duration: null });
      mockGetChannelSettings.mockResolvedValue({
        hasSettings: true,
        settings: { extendedContextMaxAge: 7200 },
      });

      await handleContext(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max Age'),
      });
    });

    it('should update max age with valid duration', async () => {
      const interaction = createMockInteraction('set-max-age', true, { duration: '2h' });
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleContext(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/extended-context',
        expect.objectContaining({
          method: 'PATCH',
          body: { extendedContextMaxAge: 7200 },
        })
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max age set to'),
      });
    });

    it('should set to auto when duration is "auto"', async () => {
      const interaction = createMockInteraction('set-max-age', true, { duration: 'auto' });
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleContext(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/extended-context',
        expect.objectContaining({
          body: { extendedContextMaxAge: null },
        })
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Auto'),
      });
    });

    it('should reject invalid duration format', async () => {
      const interaction = createMockInteraction('set-max-age', true, { duration: 'invalid' });

      await handleContext(interaction);

      expect(mockCallGatewayApi).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Invalid duration'),
      });
    });
  });

  describe('set-max-images action', () => {
    it('should show current value when no value provided', async () => {
      const interaction = createMockInteraction('set-max-images', true, { value: null });
      mockGetChannelSettings.mockResolvedValue({
        hasSettings: true,
        settings: { extendedContextMaxImages: 10 },
      });

      await handleContext(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max Images'),
      });
    });

    it('should update max images with valid value', async () => {
      const interaction = createMockInteraction('set-max-images', true, { value: 10 });
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleContext(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/extended-context',
        expect.objectContaining({
          method: 'PATCH',
          body: { extendedContextMaxImages: 10 },
        })
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max images set to 10'),
      });
    });

    it('should set to 0 (disable images) when value is 0', async () => {
      const interaction = createMockInteraction('set-max-images', true, { value: 0 });
      mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

      await handleContext(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/channel/channel-123/extended-context',
        expect.objectContaining({
          body: { extendedContextMaxImages: 0 },
        })
      );
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Max images set to 0'),
      });
    });

    it('should reject invalid max images value', async () => {
      const interaction = createMockInteraction('set-max-images', true, { value: 25 });

      await handleContext(interaction);

      expect(mockCallGatewayApi).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('between 0 and 20'),
      });
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
