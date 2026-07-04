/**
 * Tests for Admin Settings Dashboard
 *
 * Tests the interactive settings dashboard for admin settings.
 * Note: handleSettings receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeErr } from '../../test/gatewayClientStubs.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import type { GatewayResult, OwnerClient } from '@tzurot/clients';
import {
  handleSettings,
  handleAdminSettingsButton,
  handleAdminSettingsSelectMenu,
  handleAdminSettingsModal,
  isAdminSettingsInteraction,
} from './settings.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

const invalidateAdminSettingsCacheMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayServiceCalls.js', () => ({
  invalidateAdminSettingsCache: invalidateAdminSettingsCacheMock,
}));

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

interface StubClient {
  getAdminSettings: ReturnType<typeof vi.fn>;
  updateAdminSettings: ReturnType<typeof vi.fn>;
}

function createStubClient(): StubClient {
  return { getAdminSettings: vi.fn(), updateAdminSettings: vi.fn() };
}

function asOwnerClient(stub: StubClient): OwnerClient {
  return stub as unknown as OwnerClient;
}

function ok<T>(data: T): GatewayResult<T> {
  return { ok: true, data };
}

describe('Admin Settings Dashboard', () => {
  let stub: StubClient;

  const mockSettings = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    updatedBy: 'user-123',
    configDefaults: null,
    createdAt: '2025-01-15T00:00:00.000Z',
    updatedAt: '2025-01-15T00:00:00.000Z',
  };

  function createMockContext(): DeferredCommandContext & {
    editReply: ReturnType<typeof vi.fn>;
    interaction: {
      editReply: ReturnType<typeof vi.fn>;
      deferred: boolean;
      replied: boolean;
      user: { id: string };
    };
  } {
    const mockEditReply = vi.fn().mockResolvedValue({ id: 'message-123' });

    const mockInteraction = {
      editReply: mockEditReply,
      deferred: true,
      replied: false,
      user: { id: 'user-456' },
    };

    return {
      interaction: mockInteraction,
      user: { id: 'user-456' },
      guild: null,
      member: null,
      channel: null,
      channelId: 'channel-123',
      guildId: null,
      commandName: 'admin',
      isEphemeral: true,
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: () => 'settings',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext & {
      editReply: ReturnType<typeof vi.fn>;
      interaction: {
        editReply: ReturnType<typeof vi.fn>;
        deferred: boolean;
        replied: boolean;
        user: { id: string };
      };
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
    stub = createStubClient();
    clientsForMock.mockReturnValue({ ownerClient: asOwnerClient(stub) });
  });

  describe('handleSettings', () => {
    it('should display settings dashboard embed', async () => {
      const context = createMockContext();
      stub.getAdminSettings.mockResolvedValue(ok(mockSettings));

      await handleSettings(context);

      expect(stub.getAdminSettings).toHaveBeenCalled();
      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('should include Global Settings title in embed', async () => {
      const context = createMockContext();
      stub.getAdminSettings.mockResolvedValue(ok(mockSettings));

      await handleSettings(context);

      const editReplyCall = context.editReply.mock.calls[0][0];
      expect(editReplyCall.embeds).toHaveLength(1);

      const embedJson = editReplyCall.embeds[0].toJSON();
      expect(embedJson.title).toBe('Global Settings');
    });

    it('should include all 11 settings fields', async () => {
      const context = createMockContext();
      stub.getAdminSettings.mockResolvedValue(ok(mockSettings));

      await handleSettings(context);

      const editReplyCall = context.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      expect(embedJson.fields).toHaveLength(11);
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
          expect.stringContaining('Voice Transcription'),
          expect.stringContaining('Voice Response Mode'),
        ])
      );
    });

    it('should include select menu and close button', async () => {
      const context = createMockContext();
      stub.getAdminSettings.mockResolvedValue(ok(mockSettings));

      await handleSettings(context);

      const editReplyCall = context.editReply.mock.calls[0][0];
      expect(editReplyCall.components).toHaveLength(2);
    });

    it('should handle fetch failure gracefully', async () => {
      const context = createMockContext();
      stub.getAdminSettings.mockResolvedValue(makeErr(500));

      await handleSettings(context);

      expect(context.editReply).toHaveBeenCalledWith({
        content: '❌ Failed to fetch admin settings.',
      });
    });

    it('should handle unexpected errors gracefully', async () => {
      const context = createMockContext();
      stub.getAdminSettings.mockRejectedValue(new Error('Network error'));

      await handleSettings(context);

      expect(context.editReply).toHaveBeenCalledWith({
        content: 'An error occurred while opening the settings dashboard.',
      });
    });

    it('should not respond again if already replied', async () => {
      const context = createMockContext();
      Object.defineProperty(context.interaction, 'replied', {
        get: () => true,
        configurable: true,
      });
      stub.getAdminSettings.mockRejectedValue(new Error('Network error'));

      await handleSettings(context);

      expect(context.editReply).not.toHaveBeenCalled();
    });
  });

  describe('isAdminSettingsInteraction', () => {
    it('should return true for admin settings custom IDs', () => {
      expect(isAdminSettingsInteraction('admin-settings::select::global')).toBe(true);
      expect(isAdminSettingsInteraction('admin-settings::set::global::maxMessages:auto')).toBe(
        true
      );
      expect(isAdminSettingsInteraction('admin-settings::back::global')).toBe(true);
      expect(isAdminSettingsInteraction('admin-settings::close::global')).toBe(true);
    });

    it('should return false for non-admin settings custom IDs', () => {
      expect(isAdminSettingsInteraction('channel-settings::select::chan-123')).toBe(false);
      expect(isAdminSettingsInteraction('character-settings::set::aurora')).toBe(false);
      expect(isAdminSettingsInteraction('admin::servers::list')).toBe(false);
    });

    it('should return false for empty custom ID', () => {
      expect(isAdminSettingsInteraction('')).toBe(false);
    });
  });

  describe('handleAdminSettingsButton', () => {
    it('should ignore non-admin-settings interactions', async () => {
      const interaction = createMockButtonInteraction(
        'channel-settings::set::chan-123::enabled:true'
      );

      await handleAdminSettingsButton(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });

    it('should handle API failure gracefully', async () => {
      const interaction = {
        customId: 'admin-settings::set::global::maxMessages:auto',
        user: { id: 'user-456' },
        reply: vi.fn(),
        update: vi.fn(),
        showModal: vi.fn(),
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
      };

      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-456',
          entityId: 'global',
          data: {
            maxMessages: { localValue: 50, effectiveValue: 50, source: 'hardcoded' },
            maxAge: { localValue: 7200, effectiveValue: 7200, source: 'hardcoded' },
            maxImages: { localValue: 5, effectiveValue: 5, source: 'hardcoded' },
          },
          view: 'setting',
          activeSetting: 'maxMessages',
        },
      });

      stub.updateAdminSettings.mockResolvedValue(makeErr(403, 'Permission denied'));

      await handleAdminSettingsButton(interaction as unknown as ButtonInteraction);

      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Permission denied'),
        })
      );
      // On a failed update the cache must NOT be invalidated — the old values
      // are still authoritative.
      expect(invalidateAdminSettingsCacheMock).not.toHaveBeenCalled();
    });

    it('should handle unknown setting ID', async () => {
      const interaction = {
        customId: 'admin-settings::set::global::unknownSetting:value',
        user: { id: 'user-456' },
        reply: vi.fn(),
        update: vi.fn(),
        showModal: vi.fn(),
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
      };

      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-456',
          entityId: 'global',
          data: {
            maxMessages: { localValue: 50, effectiveValue: 50, source: 'hardcoded' },
            maxAge: { localValue: 7200, effectiveValue: 7200, source: 'hardcoded' },
            maxImages: { localValue: 5, effectiveValue: 5, source: 'hardcoded' },
          },
          view: 'setting',
          activeSetting: 'unknownSetting',
        },
      });

      await handleAdminSettingsButton(interaction as unknown as ButtonInteraction);

      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Unknown setting'),
        })
      );
    });
  });

  describe('handleAdminSettingsSelectMenu', () => {
    it('should ignore non-admin-settings interactions', async () => {
      const interaction = createMockSelectMenuInteraction(
        'channel-settings::select::chan-123',
        'enabled'
      );

      await handleAdminSettingsSelectMenu(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });
  });

  describe('handleAdminSettingsModal', () => {
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
        entityId: 'global',
        data: {
          maxMessages: { localValue: 50, effectiveValue: 50, source: 'hardcoded' },
          maxAge: { localValue: 7200, effectiveValue: 7200, source: 'hardcoded' },
          maxImages: { localValue: 5, effectiveValue: 5, source: 'hardcoded' },
        },
        view: 'setting',
        activeSetting: settingId,
      },
    });

    it('should ignore non-admin-settings modal interactions', async () => {
      const interaction = createMockModalInteraction(
        'channel-settings::modal::chan-123::enabled',
        '50'
      );

      await handleAdminSettingsModal(interaction as never);

      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should update maxMessages setting', async () => {
      const interaction = createMockModalInteraction(
        'admin-settings::modal::global::maxMessages',
        '75'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      stub.updateAdminSettings.mockResolvedValue(
        ok({ ...mockSettings, configDefaults: { maxMessages: 75 } })
      );

      await handleAdminSettingsModal(interaction as never);

      expect(stub.updateAdminSettings).toHaveBeenCalledWith({ maxMessages: 75 });
      // Service-read cache is invalidated on a successful update so readers
      // (e.g. VoiceMessageProcessor) pick up the new defaults promptly.
      expect(invalidateAdminSettingsCacheMock).toHaveBeenCalled();
    });

    it('should update maxAge setting with duration string (2h)', async () => {
      const interaction = createMockModalInteraction('admin-settings::modal::global::maxAge', '2h');

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      stub.updateAdminSettings.mockResolvedValue(
        ok({ ...mockSettings, configDefaults: { maxAge: 7200 } })
      );

      await handleAdminSettingsModal(interaction as never);

      expect(stub.updateAdminSettings).toHaveBeenCalledWith({ maxAge: 7200 });
    });

    it('should update maxAge setting to "off" (disabled)', async () => {
      const interaction = createMockModalInteraction(
        'admin-settings::modal::global::maxAge',
        'off'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      stub.updateAdminSettings.mockResolvedValue(
        ok({ ...mockSettings, configDefaults: { maxAge: null } })
      );

      await handleAdminSettingsModal(interaction as never);

      expect(stub.updateAdminSettings).toHaveBeenCalledWith({ maxAge: null });
    });

    it('should clear maxAge override when set to "auto"', async () => {
      const interaction = createMockModalInteraction(
        'admin-settings::modal::global::maxAge',
        'auto'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      stub.updateAdminSettings.mockResolvedValue(ok({ ...mockSettings, configDefaults: null }));

      await handleAdminSettingsModal(interaction as never);

      // For global settings, auto means clear the override.
      expect(stub.updateAdminSettings).toHaveBeenCalledWith({ maxAge: null });
    });

    it('should update maxImages setting', async () => {
      const interaction = createMockModalInteraction(
        'admin-settings::modal::global::maxImages',
        '10'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxImages'));
      stub.updateAdminSettings.mockResolvedValue(
        ok({ ...mockSettings, configDefaults: { maxImages: 10 } })
      );

      await handleAdminSettingsModal(interaction as never);

      expect(stub.updateAdminSettings).toHaveBeenCalledWith({ maxImages: 10 });
    });

    it('should clear maxImages override when set to "auto"', async () => {
      const interaction = createMockModalInteraction(
        'admin-settings::modal::global::maxImages',
        'auto'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxImages'));
      stub.updateAdminSettings.mockResolvedValue(ok({ ...mockSettings, configDefaults: null }));

      await handleAdminSettingsModal(interaction as never);

      expect(stub.updateAdminSettings).toHaveBeenCalledWith({ maxImages: null });
    });

    it('should clear maxMessages override when set to "auto"', async () => {
      const interaction = createMockModalInteraction(
        'admin-settings::modal::global::maxMessages',
        'auto'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      stub.updateAdminSettings.mockResolvedValue(ok({ ...mockSettings, configDefaults: null }));

      await handleAdminSettingsModal(interaction as never);

      expect(stub.updateAdminSettings).toHaveBeenCalledWith({ maxMessages: null });
    });

    it('should handle network error gracefully', async () => {
      const interaction = createMockModalInteraction(
        'admin-settings::modal::global::maxMessages',
        '50'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      stub.updateAdminSettings.mockRejectedValue(new Error('Network error'));

      await handleAdminSettingsModal(interaction as never);

      expect(stub.updateAdminSettings).toHaveBeenCalled();
      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });
});
