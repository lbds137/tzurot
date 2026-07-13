/**
 * Tests for Channel Settings Dashboard
 *
 * Tests the interactive settings dashboard for the /channel settings subcommand
 * (which manages channel-tier cascade settings: context window, memory, display, voice).
 *
 * This command uses deferralMode: 'ephemeral' which means:
 * - Framework calls deferReply before execute()
 * - Execute receives a DeferredCommandContext (not raw interaction)
 * - Tests must mock the context, not the interaction directly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  handleChannelSettings,
  handleChannelSettingsButton,
  handleChannelSettingsModal,
  isChannelSettingsInteraction,
} from './settings.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

// Mock dependencies
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

// Mock gateway service calls - use vi.hoisted() for proper mock hoisting
const { mockGetChannelSettings, mockInvalidateChannelSettingsCache } = vi.hoisted(() => ({
  mockGetChannelSettings: vi.fn(),
  mockInvalidateChannelSettingsCache: vi.fn(),
}));

vi.mock('../../utils/gatewayServiceCalls.js', () => ({
  getChannelSettingsCached: mockGetChannelSettings,
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

interface UserClientStub {
  getChannelConfigOverrides: ReturnType<typeof vi.fn>;
  updateChannelConfigOverrides: ReturnType<typeof vi.fn>;
  resolveCascade: ReturnType<typeof vi.fn>;
  resolveUserDefaults: ReturnType<typeof vi.fn>;
}

function createStub(): UserClientStub {
  return {
    getChannelConfigOverrides: vi.fn(),
    updateChannelConfigOverrides: vi.fn(),
    resolveCascade: vi.fn(),
    resolveUserDefaults: vi.fn(),
  };
}

/**
 * Default hardcoded-source resolved data shape used by most tests that
 * don't otherwise care about cascade values.
 */
function defaultResolvedData() {
  return {
    maxMessages: 50,
    maxAge: null,
    maxImages: 10,
    memoryScoreThreshold: 0.5,
    memoryLimit: 20,
    focusModeEnabled: false,
    crossChannelHistoryEnabled: false,
    shareLtmAcrossPersonalities: false,
    showModelFooter: true,
    voiceResponseMode: 'always',
    voiceTranscriptionEnabled: true,
    sources: {
      maxMessages: 'hardcoded',
      maxAge: 'hardcoded',
      maxImages: 'hardcoded',
      memoryScoreThreshold: 'hardcoded',
      memoryLimit: 'hardcoded',
      focusModeEnabled: 'hardcoded',
      crossChannelHistoryEnabled: 'hardcoded',
      shareLtmAcrossPersonalities: 'hardcoded',
      showModelFooter: 'hardcoded',
      voiceResponseMode: 'hardcoded',
      voiceTranscriptionEnabled: 'hardcoded',
    },
  };
}

describe('Channel Settings Dashboard', () => {
  let stub: UserClientStub;

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
      user: { id: '123456789' },
    };

    // Create mock context that mirrors DeferredCommandContext
    return {
      interaction: mockInteraction,
      user: { id: '123456789' },
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

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });

    // Default: resolve endpoints return hardcoded defaults
    stub.resolveCascade.mockResolvedValue(makeOk(defaultResolvedData()));
    stub.resolveUserDefaults.mockResolvedValue(makeOk(defaultResolvedData()));
    stub.getChannelConfigOverrides.mockResolvedValue(makeOk({ configOverrides: null }));
    stub.updateChannelConfigOverrides.mockResolvedValue(makeOk({ configOverrides: {} }));
  });

  describe('handleChannelSettings', () => {
    it('should require Manage Messages permission', async () => {
      const context = createMockContext(false);

      await handleChannelSettings(context);

      expect(context.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Manage Messages'),
      });
    });

    it('should display settings dashboard embed with permission', async () => {
      const context = createMockContext(true);
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleChannelSettings(context);

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

      await handleChannelSettings(context);

      const editReplyCall = (context.editReply as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(editReplyCall.embeds).toHaveLength(1);

      const embedJson = editReplyCall.embeds[0].toJSON();
      expect(embedJson.title).toBe('Channel Settings');
    });

    it('should include channel mention in embed description', async () => {
      const context = createMockContext(true);
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleChannelSettings(context);

      const editReplyCall = (context.editReply as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      expect(embedJson.description).toContain('<#channel-123>');
    });

    it('should include all 10 settings fields (extended context + memory + display + voice)', async () => {
      const context = createMockContext(true);
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleChannelSettings(context);

      const editReplyCall = (context.editReply as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      // Both extended context and memory settings are shown at channel tier
      expect(embedJson.fields).toHaveLength(10);
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
          expect.stringContaining('Model Footer'),
          expect.stringContaining('Voice Response Mode'),
        ])
      );
    });

    it('should handle no activated personality gracefully', async () => {
      const context = createMockContext(true);
      // Channel has no activated personality
      mockGetChannelSettings.mockResolvedValue({ settings: {} });

      await handleChannelSettings(context);

      // Should call resolveUserDefaults as fallback (not resolveCascade which needs personalityId)
      expect(stub.resolveUserDefaults).toHaveBeenCalled();
      expect(stub.resolveCascade).not.toHaveBeenCalled();

      // Should still display the dashboard
      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('should show admin overrides via resolve-defaults when no personality activated', async () => {
      const context = createMockContext(true);
      // No character activated
      mockGetChannelSettings.mockResolvedValue({ settings: {} });
      // resolveUserDefaults returns admin-sourced maxMessages
      stub.resolveUserDefaults.mockResolvedValue(
        makeOk({
          maxMessages: 75,
          maxAge: null,
          maxImages: 10,
          memoryScoreThreshold: 0.5,
          memoryLimit: 20,
          focusModeEnabled: false,
          crossChannelHistoryEnabled: false,
          shareLtmAcrossPersonalities: false,
          showModelFooter: true,
          voiceResponseMode: 'always',
          voiceTranscriptionEnabled: true,
          sources: {
            maxMessages: 'admin',
            maxAge: 'hardcoded',
            maxImages: 'hardcoded',
            memoryScoreThreshold: 'hardcoded',
            memoryLimit: 'hardcoded',
            focusModeEnabled: 'hardcoded',
            crossChannelHistoryEnabled: 'hardcoded',
            shareLtmAcrossPersonalities: 'hardcoded',
            showModelFooter: 'hardcoded',
            voiceResponseMode: 'hardcoded',
            voiceTranscriptionEnabled: 'hardcoded',
          },
          userOverrides: null,
        })
      );
      // Channel has its own local override of maxMessages
      stub.getChannelConfigOverrides.mockResolvedValue(
        makeOk({ configOverrides: { maxMessages: 25 } })
      );

      await handleChannelSettings(context);

      const editReplyCall = (context.editReply as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      // maxMessages: effective value from cascade is 75 (admin), with local override badge
      const maxMsgField = embedJson.fields.find((f: { name: string }) =>
        f.name.includes('Max Messages')
      );
      expect(maxMsgField).toBeDefined();
      expect(maxMsgField.value).toContain('75');
      expect(maxMsgField.value).toContain('Override');

      // Fields without overrides should show Auto indicator
      const maxImgField = embedJson.fields.find((f: { name: string }) =>
        f.name.includes('Max Images')
      );
      expect(maxImgField).toBeDefined();
      expect(maxImgField.value).toContain('Auto');

      // Info note about no personality activated
      expect(embedJson.description).toContain('No character activated');
    });

    it('should use fallback values when resolve endpoint fails', async () => {
      const context = createMockContext(true);
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);
      // Resolve endpoint returns error
      stub.resolveCascade.mockResolvedValue(makeErr(404, 'Not found'));
      stub.getChannelConfigOverrides.mockResolvedValue(makeErr(404, 'Not found'));

      await handleChannelSettings(context);

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

      await handleChannelSettings(context);

      expect(context.editReply).toHaveBeenCalledWith({
        content: '❌ Failed to open the context settings dashboard. Please try again.',
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

      await handleChannelSettings(context);

      // editReply should not be called when interaction.replied is true
      expect(context.editReply).not.toHaveBeenCalled();
    });
  });

  describe('isChannelSettingsInteraction', () => {
    it('should return true for channel settings custom IDs', () => {
      expect(isChannelSettingsInteraction('channel-settings::select::chan-123')).toBe(true);
      expect(
        isChannelSettingsInteraction('channel-settings::set::chan-123::maxMessages:auto')
      ).toBe(true);
      expect(isChannelSettingsInteraction('channel-settings::back::chan-123')).toBe(true);
      expect(isChannelSettingsInteraction('channel-settings::close::chan-123')).toBe(true);
    });

    it('should return false for non-channel-settings custom IDs', () => {
      expect(isChannelSettingsInteraction('character-settings::select::aurora')).toBe(false);
      expect(isChannelSettingsInteraction('admin-settings::set::global')).toBe(false);
      // channel::list is channel list pagination, not settings
      expect(isChannelSettingsInteraction('channel::list::1::date')).toBe(false);
    });

    it('should return false for empty custom ID', () => {
      expect(isChannelSettingsInteraction('')).toBe(false);
    });
  });

  describe('handleChannelSettingsButton', () => {
    it('should handle API failure gracefully', async () => {
      const interaction = {
        customId: 'channel-settings::set::channel-123::maxMessages:auto',
        user: { id: '123456789' },
        reply: vi.fn(),
        update: vi.fn(),
        showModal: vi.fn(),
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
      };

      mockSessionManager.get.mockReturnValue({
        data: {
          // Ownership keys on session.userId (SettingsSession), which must match
          // interaction.user.id for the handler to proceed past the owner guard.
          userId: '123456789',
          entityId: 'channel-123',
          data: {
            maxMessages: { localValue: null, effectiveValue: 50, source: 'admin' },
            maxAge: { localValue: null, effectiveValue: 7200, source: 'admin' },
            maxImages: { localValue: null, effectiveValue: 5, source: 'admin' },
          },
          view: 'setting',
          activeSetting: 'maxMessages',
        },
      });

      stub.updateChannelConfigOverrides.mockResolvedValue(makeErr(500, 'Server error'));

      await handleChannelSettingsButton(interaction as unknown as ButtonInteraction);

      // Post-defer: a failed update surfaces via followUp (the router already acked).
      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Server error'),
        })
      );
      expect(interaction.update).not.toHaveBeenCalled();
    });
  });

  describe('handleChannelSettingsModal', () => {
    const createMockModalInteraction = (customId: string, inputValue: string) => ({
      customId,
      user: { id: '123456789' },
      fields: {
        getTextInputValue: vi.fn().mockReturnValue(inputValue),
      },
      reply: vi.fn(),
      update: vi.fn(),
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn(),
      followUp: vi.fn().mockResolvedValue(undefined),
    });

    const createSessionWithSetting = (settingId: string) => ({
      data: {
        user: {
          discordId: '123456789',
          username: 'testuser',
          displayName: 'testuser',
        },
        entityId: 'channel-123',
        data: {
          maxMessages: { localValue: null, effectiveValue: 50, source: 'admin' },
          maxAge: { localValue: null, effectiveValue: 7200, source: 'admin' },
          maxImages: { localValue: null, effectiveValue: 5, source: 'admin' },
        },
        view: 'setting',
        activeSetting: settingId,
      },
    });

    it('should update maxMessages setting via config-overrides endpoint', async () => {
      const interaction = createMockModalInteraction(
        'channel-settings::modal::channel-123::maxMessages',
        '75'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      stub.updateChannelConfigOverrides.mockResolvedValue(makeOk({ configOverrides: {} }));
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleChannelSettingsModal(interaction as never);

      // Should use the typed userClient method with channelId + flat body
      expect(stub.updateChannelConfigOverrides).toHaveBeenCalledWith('channel-123', {
        maxMessages: 75,
      });
    });

    it('should update maxAge setting with duration string (2h)', async () => {
      const interaction = createMockModalInteraction(
        'channel-settings::modal::channel-123::maxAge',
        '2h'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      stub.updateChannelConfigOverrides.mockResolvedValue(makeOk({ configOverrides: {} }));
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleChannelSettingsModal(interaction as never);

      expect(stub.updateChannelConfigOverrides).toHaveBeenCalledWith('channel-123', {
        maxAge: 7200,
      });
    });

    it('should update maxAge setting to "off" (disabled)', async () => {
      const interaction = createMockModalInteraction(
        'channel-settings::modal::channel-123::maxAge',
        'off'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      stub.updateChannelConfigOverrides.mockResolvedValue(makeOk({ configOverrides: {} }));
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleChannelSettingsModal(interaction as never);

      // "off" maps to -1 in the modal and travels as the wire OFF sentinel — the
      // gateway persists it as stored null (explicit terminal OFF, not a clear).
      expect(stub.updateChannelConfigOverrides).toHaveBeenCalledWith('channel-123', {
        maxAge: -1,
      });
    });

    it('should update maxImages setting', async () => {
      const interaction = createMockModalInteraction(
        'channel-settings::modal::channel-123::maxImages',
        '10'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxImages'));
      stub.updateChannelConfigOverrides.mockResolvedValue(makeOk({ configOverrides: {} }));
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleChannelSettingsModal(interaction as never);

      expect(stub.updateChannelConfigOverrides).toHaveBeenCalledWith('channel-123', {
        maxImages: 10,
      });
    });

    it('should invalidate cache after successful update', async () => {
      const interaction = createMockModalInteraction(
        'channel-settings::modal::channel-123::maxMessages',
        '50'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      stub.updateChannelConfigOverrides.mockResolvedValue(makeOk({ configOverrides: {} }));
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      await handleChannelSettingsModal(interaction as never);

      expect(mockInvalidateChannelSettingsCache).toHaveBeenCalledWith('channel-123');
    });

    it('should handle network error gracefully', async () => {
      const interaction = createMockModalInteraction(
        'channel-settings::modal::channel-123::maxMessages',
        '50'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      stub.updateChannelConfigOverrides.mockRejectedValue(new Error('Network error'));

      await handleChannelSettingsModal(interaction as never);

      // When update fails, handler returns early - verify interaction.editReply wasn't called
      expect(interaction.editReply).not.toHaveBeenCalled();
    });

    it('should handle API error response gracefully', async () => {
      const interaction = createMockModalInteraction(
        'channel-settings::modal::channel-123::maxMessages',
        '50'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      // PATCH returns error
      stub.updateChannelConfigOverrides.mockResolvedValue(makeErr(400, 'Validation failed'));

      await handleChannelSettingsModal(interaction as never);

      // Cache should NOT be invalidated on failure
      expect(mockInvalidateChannelSettingsCache).not.toHaveBeenCalled();
    });
  });
});
