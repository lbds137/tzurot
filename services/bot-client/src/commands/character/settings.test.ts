/**
 * Tests for Character Settings Dashboard
 *
 * Tests the interactive settings dashboard for character settings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction, ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import {
  handleSettings,
  handleCharacterSettingsButton,
  handleCharacterSettingsSelectMenu,
  isCharacterSettingsInteraction,
} from './settings.js';
import type { EnvConfig } from '@tzurot/common-types';

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

// Mock getAdminSettings
const mockGetAdminSettings = vi.fn();
vi.mock('../../utils/GatewayClient.js', () => ({
  GatewayClient: class MockGatewayClient {
    getAdminSettings = mockGetAdminSettings;
  },
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
      extendedContext: null,
      extendedContextMaxMessages: null,
      extendedContextMaxAge: null,
      extendedContextMaxImages: null,
      ownerId: 'user-456',
    },
  };

  const mockAdminSettings = {
    extendedContextDefault: true,
    extendedContextMaxMessages: 50,
    extendedContextMaxAge: 7200,
    extendedContextMaxImages: 5,
  };

  const mockConfig: EnvConfig = {} as EnvConfig;

  const createMockInteraction = (): ChatInputCommandInteraction & {
    reply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    deferred: boolean;
    replied: boolean;
    options: {
      getString: ReturnType<typeof vi.fn>;
    };
  } => {
    return {
      options: {
        getString: vi.fn().mockReturnValue('aurora'),
      },
      user: { id: 'user-456' },
      reply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue({ id: 'message-123' }),
      deferred: true,
      replied: false,
    } as unknown as ChatInputCommandInteraction & {
      reply: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
      deferred: boolean;
      replied: boolean;
      options: {
        getString: ReturnType<typeof vi.fn>;
      };
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

  describe('handleSettings', () => {
    it('should display settings dashboard embed', async () => {
      const interaction = createMockInteraction();
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: mockPersonality,
      });
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleSettings(interaction, mockConfig);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/personality/aurora', {
        method: 'GET',
        userId: 'user-456',
      });
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('should include Character Settings title in embed', async () => {
      const interaction = createMockInteraction();
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: mockPersonality,
      });
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleSettings(interaction, mockConfig);

      const editReplyCall = interaction.editReply.mock.calls[0][0];
      expect(editReplyCall.embeds).toHaveLength(1);

      const embedJson = editReplyCall.embeds[0].toJSON();
      expect(embedJson.title).toBe('Character Settings');
    });

    it('should include character name in embed description', async () => {
      const interaction = createMockInteraction();
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: mockPersonality,
      });
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleSettings(interaction, mockConfig);

      const editReplyCall = interaction.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      expect(embedJson.description).toContain('Aurora');
    });

    it('should include all 4 settings fields', async () => {
      const interaction = createMockInteraction();
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: mockPersonality,
      });
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleSettings(interaction, mockConfig);

      const editReplyCall = interaction.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      expect(embedJson.fields).toHaveLength(4);
    });

    it('should handle character not found', async () => {
      const interaction = createMockInteraction();
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Not found',
      });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('not found'),
      });
    });

    it('should handle API errors gracefully', async () => {
      const interaction = createMockInteraction();
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Server error',
      });

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to fetch character'),
      });
    });

    it('should handle admin settings fetch failure', async () => {
      const interaction = createMockInteraction();
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: mockPersonality,
      });
      mockGetAdminSettings.mockResolvedValue(null);

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'Failed to fetch global settings.',
      });
    });

    it('should handle unexpected errors gracefully', async () => {
      const interaction = createMockInteraction();
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: 'An error occurred while opening the settings dashboard.',
      });
    });

    it('should not respond again if already replied', async () => {
      const interaction = createMockInteraction();
      Object.defineProperty(interaction, 'replied', {
        get: () => true,
        configurable: true,
      });
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleSettings(interaction, mockConfig);

      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });

  describe('isCharacterSettingsInteraction', () => {
    it('should return true for character settings custom IDs', () => {
      expect(isCharacterSettingsInteraction('personality-settings::select::aurora')).toBe(true);
      expect(isCharacterSettingsInteraction('personality-settings::set::aurora::enabled:true')).toBe(
        true
      );
      expect(isCharacterSettingsInteraction('personality-settings::back::aurora')).toBe(true);
      expect(isCharacterSettingsInteraction('personality-settings::close::aurora')).toBe(true);
    });

    it('should return false for non-character settings custom IDs', () => {
      expect(isCharacterSettingsInteraction('channel-context::select::chan-123')).toBe(false);
      expect(isCharacterSettingsInteraction('admin-settings::set::global')).toBe(false);
      expect(isCharacterSettingsInteraction('character::edit::my-char')).toBe(false);
    });

    it('should return false for empty custom ID', () => {
      expect(isCharacterSettingsInteraction('')).toBe(false);
    });
  });

  describe('handleCharacterSettingsButton', () => {
    it('should ignore non-character-settings interactions', async () => {
      const interaction = createMockButtonInteraction('channel-context::set::chan-123::enabled:true');

      await handleCharacterSettingsButton(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });
  });

  describe('handleCharacterSettingsSelectMenu', () => {
    it('should ignore non-character-settings interactions', async () => {
      const interaction = createMockSelectMenuInteraction(
        'channel-context::select::chan-123',
        'enabled'
      );

      await handleCharacterSettingsSelectMenu(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });
  });
});
