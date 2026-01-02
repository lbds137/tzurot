/**
 * Tests for Character Settings Dashboard
 *
 * Tests the interactive settings dashboard for character settings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import {
  handleSettings,
  handleCharacterSettingsButton,
  handleCharacterSettingsSelectMenu,
  handleCharacterSettingsModal,
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
      expect(
        isCharacterSettingsInteraction('personality-settings::set::aurora::enabled:true')
      ).toBe(true);
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
      const interaction = createMockButtonInteraction(
        'channel-context::set::chan-123::enabled:true'
      );

      await handleCharacterSettingsButton(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });

    it('should call update handler when setting enabled to true', async () => {
      const interaction = {
        customId: 'personality-settings::set::aurora::enabled:true',
        user: { id: 'user-456' },
        reply: vi.fn(),
        update: vi.fn(),
        showModal: vi.fn(),
      };

      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-456',
          entityId: 'aurora',
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

      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true }) // PUT request
        .mockResolvedValueOnce({ ok: true, data: mockPersonality }); // GET refresh
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleCharacterSettingsButton(interaction as unknown as ButtonInteraction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/personality/aurora',
        expect.objectContaining({
          method: 'PUT',
          body: { extendedContext: true },
        })
      );
    });

    it('should handle setting enabled to auto (null)', async () => {
      const interaction = {
        customId: 'personality-settings::set::aurora::enabled:auto',
        user: { id: 'user-456' },
        reply: vi.fn(),
        update: vi.fn(),
        showModal: vi.fn(),
      };

      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-456',
          entityId: 'aurora',
          data: {
            enabled: { localValue: true, effectiveValue: true, source: 'personality' },
            maxMessages: { localValue: null, effectiveValue: 50, source: 'global' },
            maxAge: { localValue: null, effectiveValue: 7200, source: 'global' },
            maxImages: { localValue: null, effectiveValue: 5, source: 'global' },
          },
          view: 'setting',
          activeSetting: 'enabled',
        },
      });

      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, data: mockPersonality });
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleCharacterSettingsButton(interaction as unknown as ButtonInteraction);

      // For personality settings, auto means null (inherit)
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/personality/aurora',
        expect.objectContaining({
          method: 'PUT',
          body: { extendedContext: null },
        })
      );
    });

    it('should handle permission denied (401) response', async () => {
      const interaction = {
        customId: 'personality-settings::set::aurora::enabled:true',
        user: { id: 'user-456' },
        reply: vi.fn(),
        update: vi.fn(),
        showModal: vi.fn(),
      };

      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-456',
          entityId: 'aurora',
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
        status: 401,
        error: 'Unauthorized',
      });

      await handleCharacterSettingsButton(interaction as unknown as ButtonInteraction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('permission'),
        })
      );
    });

    it('should handle character not found (404) response', async () => {
      const interaction = {
        customId: 'personality-settings::set::aurora::enabled:true',
        user: { id: 'user-456' },
        reply: vi.fn(),
        update: vi.fn(),
        showModal: vi.fn(),
      };

      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-456',
          entityId: 'aurora',
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
        status: 404,
        error: 'Not found',
      });

      await handleCharacterSettingsButton(interaction as unknown as ButtonInteraction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('not found'),
        })
      );
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

    const createSessionWithSetting = (settingId: string) => ({
      data: {
        userId: 'user-456',
        entityId: 'aurora',
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

    it('should ignore non-character-settings modal interactions', async () => {
      const interaction = createMockModalInteraction(
        'admin-settings::modal::global::enabled',
        '50'
      );

      await handleCharacterSettingsModal(interaction as never);

      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should update maxMessages setting', async () => {
      const interaction = createMockModalInteraction(
        'personality-settings::modal::aurora::maxMessages',
        '75'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, data: mockPersonality });
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleCharacterSettingsModal(interaction as never);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/personality/aurora',
        expect.objectContaining({
          method: 'PUT',
          body: { extendedContextMaxMessages: 75 },
        })
      );
    });

    it('should update maxAge setting with duration string (2h)', async () => {
      const interaction = createMockModalInteraction(
        'personality-settings::modal::aurora::maxAge',
        '2h'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, data: mockPersonality });
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleCharacterSettingsModal(interaction as never);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/personality/aurora',
        expect.objectContaining({
          method: 'PUT',
          body: { extendedContextMaxAge: 7200 },
        })
      );
    });

    it('should update maxAge setting to "off" (disabled)', async () => {
      const interaction = createMockModalInteraction(
        'personality-settings::modal::aurora::maxAge',
        'off'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, data: mockPersonality });
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleCharacterSettingsModal(interaction as never);

      // "off" maps to null in DB for personality settings
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/personality/aurora',
        expect.objectContaining({
          method: 'PUT',
          body: { extendedContextMaxAge: null },
        })
      );
    });

    it('should set maxAge to auto (null) when empty', async () => {
      const interaction = createMockModalInteraction(
        'personality-settings::modal::aurora::maxAge',
        'auto'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, data: mockPersonality });
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleCharacterSettingsModal(interaction as never);

      // "auto" means inherit (null)
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/personality/aurora',
        expect.objectContaining({
          method: 'PUT',
          body: { extendedContextMaxAge: null },
        })
      );
    });

    it('should update maxImages setting', async () => {
      const interaction = createMockModalInteraction(
        'personality-settings::modal::aurora::maxImages',
        '10'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxImages'));
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, data: mockPersonality });
      mockGetAdminSettings.mockResolvedValue(mockAdminSettings);

      await handleCharacterSettingsModal(interaction as never);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/personality/aurora',
        expect.objectContaining({
          method: 'PUT',
          body: { extendedContextMaxImages: 10 },
        })
      );
    });

    it('should handle refresh failure after update', async () => {
      const interaction = createMockModalInteraction(
        'personality-settings::modal::aurora::maxMessages',
        '50'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true }) // PUT succeeds
        .mockResolvedValueOnce({ ok: false, error: 'Fetch failed' }); // GET fails

      await handleCharacterSettingsModal(interaction as never);

      // When refresh fails, handler should not call editReply (preserves state)
      expect(interaction.editReply).not.toHaveBeenCalled();
    });

    it('should handle admin settings fetch failure after update', async () => {
      const interaction = createMockModalInteraction(
        'personality-settings::modal::aurora::maxMessages',
        '50'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true }) // PUT succeeds
        .mockResolvedValueOnce({ ok: true, data: mockPersonality }); // GET succeeds
      mockGetAdminSettings.mockResolvedValue(null); // Admin settings fails

      await handleCharacterSettingsModal(interaction as never);

      // When admin settings fetch fails, handler should not call editReply
      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });
});
