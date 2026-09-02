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
  clearChannelConfigOverrides: ReturnType<typeof vi.fn>;
  resolveChannelCascade: ReturnType<typeof vi.fn>;
}

function createStub(): UserClientStub {
  return {
    getChannelConfigOverrides: vi.fn(),
    updateChannelConfigOverrides: vi.fn(),
    clearChannelConfigOverrides: vi.fn(),
    resolveChannelCascade: vi.fn(),
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
      crossChannelHistoryEnabled: 'hardcoded',
      shareLtmAcrossPersonalities: 'hardcoded',
      showModelFooter: 'hardcoded',
      voiceResponseMode: 'hardcoded',
      voiceTranscriptionEnabled: 'hardcoded',
    },
    parentValues: {
      maxMessages: 50,
      maxAge: null,
      maxImages: 10,
      memoryScoreThreshold: 0.5,
      memoryLimit: 20,
      crossChannelHistoryEnabled: false,
      shareLtmAcrossPersonalities: false,
      showModelFooter: true,
      voiceResponseMode: 'always',
      voiceTranscriptionEnabled: true,
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
    // memberPermissions (channel-scoped, overwrite-aware) is the authority for
    // BOTH the open-time check and the per-click recheck — see settings.ts.
    const mockInteraction = {
      deferred: true,
      replied: false,
      editReply: mockEditReply,
      user: { id: '123456789' },
      memberPermissions: { has: vi.fn().mockReturnValue(hasPermission) },
    };

    // Create mock context that mirrors DeferredCommandContext
    return {
      interaction: mockInteraction,
      user: { id: '123456789' },
      guild: null,
      // Present because a real guild context has it, but deliberately
      // permissive: if the open-time check ever regresses to this guild-wide
      // source, the permission test below fails instead of passing silently.
      member: {
        permissions: {
          has: vi.fn().mockReturnValue(true),
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

    // Default: resolve endpoint returns hardcoded defaults
    stub.resolveChannelCascade.mockResolvedValue(makeOk(defaultResolvedData()));
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
      // The channel-scoping contract is the load-bearing argument: the cascade
      // must resolve for THIS channel with the ACTIVATED personality.
      expect(stub.resolveChannelCascade).toHaveBeenCalledWith('channel-123', {
        personalityId: 'personality-123',
      });
      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('renders IDENTICAL Current/Parent values for two moderators with different personal overrides', async () => {
      // Two different Discord users viewing the SAME channel. The stub
      // returns the same channel-scoped resolution regardless of who calls —
      // exactly the invariant the channel-scoped resolve endpoint enforces:
      // the dashboard never draws on the VIEWING moderator's own tiers.
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);

      const buildContextFor = (discordUserId: string): DeferredCommandContext => {
        const mockEditReply = vi.fn().mockResolvedValue({ id: `message-${discordUserId}` });
        const mockInteraction = {
          deferred: true,
          replied: false,
          editReply: mockEditReply,
          user: { id: discordUserId },
          memberPermissions: { has: vi.fn().mockReturnValue(true) },
        };
        return {
          interaction: mockInteraction,
          user: { id: discordUserId },
          guild: null,
          member: { permissions: { has: vi.fn().mockReturnValue(true) } },
          channel: null,
          channelId: 'channel-123',
          guildId: 'guild-123',
          commandName: 'channel',
          isEphemeral: true,
          getOption: vi.fn(),
          getRequiredOption: vi.fn(),
          getSubcommand: () => 'settings',
          getSubcommandGroup: () => null,
          editReply: mockEditReply,
          followUp: vi.fn(),
          deleteReply: vi.fn(),
        } as unknown as DeferredCommandContext;
      };

      const moderatorA = buildContextFor('mod-a-111');
      const moderatorB = buildContextFor('mod-b-222');

      await handleChannelSettings(moderatorA);
      await handleChannelSettings(moderatorB);

      const fieldsFor = (context: DeferredCommandContext) => {
        const call = (context.editReply as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
          embeds: Array<{ toJSON: () => { fields: unknown } }>;
        };
        return call.embeds[0].toJSON().fields;
      };

      expect(fieldsFor(moderatorA)).toEqual(fieldsFor(moderatorB));
      // Both calls resolved through the same channel-scoped endpoint with the
      // same arguments — never a per-viewer resolution.
      expect(stub.resolveChannelCascade).toHaveBeenNthCalledWith(1, 'channel-123', {
        personalityId: 'personality-123',
      });
      expect(stub.resolveChannelCascade).toHaveBeenNthCalledWith(2, 'channel-123', {
        personalityId: 'personality-123',
      });
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
          expect.stringContaining('Cross-Channel History'),
          expect.stringContaining('Share Memories'),
          expect.stringContaining('Share Chat History'),
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

      // Still resolves through the channel-scoped endpoint — personalityId is
      // just undefined, never a fallback to a different client method.
      expect(stub.resolveChannelCascade).toHaveBeenCalledWith('channel-123', {
        personalityId: undefined,
      });

      // Should still display the dashboard
      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('renders the channel own override correctly (Current AND Parent) when no personality activated', async () => {
      const context = createMockContext(true);
      // No character activated
      mockGetChannelSettings.mockResolvedValue({ settings: {} });
      // resolveChannelCascade already folds the channel tier into the
      // resolution — maxMessages resolves to the CHANNEL's own override (25),
      // sourced 'channel', with the tier it overrode (admin's 75) as parent.
      stub.resolveChannelCascade.mockResolvedValue(
        makeOk({
          maxMessages: 25,
          maxAge: null,
          maxImages: 10,
          memoryScoreThreshold: 0.5,
          memoryLimit: 20,
          crossChannelHistoryEnabled: false,
          shareLtmAcrossPersonalities: false,
          showModelFooter: true,
          voiceResponseMode: 'always',
          voiceTranscriptionEnabled: true,
          sources: {
            maxMessages: 'channel',
            maxAge: 'hardcoded',
            maxImages: 'hardcoded',
            memoryScoreThreshold: 'hardcoded',
            memoryLimit: 'hardcoded',
            crossChannelHistoryEnabled: 'hardcoded',
            shareLtmAcrossPersonalities: 'hardcoded',
            showModelFooter: 'hardcoded',
            voiceResponseMode: 'hardcoded',
            voiceTranscriptionEnabled: 'hardcoded',
          },
          parentValues: {
            maxMessages: 75,
            maxAge: null,
            maxImages: 10,
            memoryScoreThreshold: 0.5,
            memoryLimit: 20,
            crossChannelHistoryEnabled: false,
            shareLtmAcrossPersonalities: false,
            showModelFooter: true,
            voiceResponseMode: 'always',
            voiceTranscriptionEnabled: true,
          },
        })
      );
      // Channel has its own local override of maxMessages — same value the
      // resolver already folded in above.
      stub.getChannelConfigOverrides.mockResolvedValue(
        makeOk({ configOverrides: { maxMessages: 25 } })
      );

      await handleChannelSettings(context);

      // Current value: the channel's own override (25), NOT the admin value
      // it outranks — this is the exact bug this dashboard fix closes.
      const storedSession = mockSessionManager.set.mock.calls[0][0] as {
        data: {
          data: { maxMessages: { effectiveValue: number; source: string; parentValue: number } };
        };
      };
      const maxMessages = storedSession.data.data.maxMessages;
      expect(maxMessages.effectiveValue).toBe(25);
      expect(maxMessages.source).toBe('channel');
      // Parent value: what maxMessages would resolve to with the channel's
      // own override removed — the admin tier it overrode.
      expect(maxMessages.parentValue).toBe(75);

      const editReplyCall = (context.editReply as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      const maxMsgField = embedJson.fields.find((f: { name: string }) =>
        f.name.includes('Max Messages')
      );
      expect(maxMsgField).toBeDefined();
      expect(maxMsgField.value).toContain('25');
      expect(maxMsgField.value).toContain('Override');

      // Fields with no channel override still show the Auto indicator — the
      // channel-scoped resolve changes which tiers feed the value, not how an
      // un-overridden field renders.
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
      stub.resolveChannelCascade.mockResolvedValue(makeErr(404, 'Not found'));
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
    // `permitted` mirrors a real guild interaction's memberPermissions: the
    // mutation handlers re-check Manage Messages on every click, so a fixture
    // omitting it would read as a demoted moderator and deny everything.
    const createButtonInteraction = (customId: string, permitted = true) => ({
      customId,
      user: { id: '123456789' },
      memberPermissions: { has: vi.fn().mockReturnValue(permitted) },
      reply: vi.fn(),
      update: vi.fn(),
      showModal: vi.fn(),
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    });

    const settingViewSession = () => ({
      data: {
        userId: '123456789',
        entityId: 'channel-123',
        entityName: '<#channel-123>',
        data: {
          maxMessages: { localValue: null, effectiveValue: 50, source: 'admin' },
          maxAge: { localValue: null, effectiveValue: 7200, source: 'admin' },
          maxImages: { localValue: null, effectiveValue: 5, source: 'admin' },
        },
        view: 'setting',
        activeSetting: 'maxMessages',
      },
    });

    it('binds the channelId end-to-end: a set click updates THAT channel and re-renders', async () => {
      // The happy path through the real factory chain — the channelId from the
      // customId must be the one crossing the seam into the gateway client.
      const interaction = createButtonInteraction(
        'channel-settings::set::channel-123::maxMessages:auto'
      );
      mockSessionManager.get.mockReturnValue(settingViewSession());
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);
      stub.updateChannelConfigOverrides.mockResolvedValue(makeOk({ configOverrides: {} }));

      await handleChannelSettingsButton(interaction as unknown as ButtonInteraction);

      expect(stub.updateChannelConfigOverrides).toHaveBeenCalledWith(
        'channel-123',
        expect.any(Object)
      );
      expect(mockInvalidateChannelSettingsCache).toHaveBeenCalledWith('channel-123');
      // Fresh data refetched and the dashboard re-rendered.
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array), components: expect.any(Array) })
      );
      expect(interaction.followUp).not.toHaveBeenCalled();
    });

    it('surfaces the generic message when the update THROWS (catch branch)', async () => {
      const interaction = createButtonInteraction(
        'channel-settings::set::channel-123::maxMessages:auto'
      );
      mockSessionManager.get.mockReturnValue(settingViewSession());
      stub.updateChannelConfigOverrides.mockRejectedValue(new Error('network down'));

      await handleChannelSettingsButton(interaction as unknown as ButtonInteraction);

      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('unexpected error, please try again'),
        })
      );
    });

    it('reset first click shows the Tier-A confirm without clearing anything', async () => {
      const interaction = createButtonInteraction('channel-settings::reset::channel-123');
      mockSessionManager.get.mockReturnValue(settingViewSession());

      await handleChannelSettingsButton(interaction as unknown as ButtonInteraction);

      // Confirm gate: nothing cleared yet, and the surface routes to
      // reset-confirm / reset-cancel.
      expect(stub.clearChannelConfigOverrides).not.toHaveBeenCalled();
      const call = interaction.editReply.mock.calls[0][0] as {
        components: Array<{ toJSON: () => { components: Array<{ custom_id: string }> } }>;
      };
      expect(call.components[0].toJSON().components.map(b => b.custom_id)).toEqual([
        'channel-settings::reset-cancel::channel-123',
        'channel-settings::reset-confirm::channel-123',
      ]);
    });

    it('reset-confirm is REFUSED when Manage Messages was revoked mid-session', async () => {
      // The dashboard-open check happened while the user still had the
      // permission; the session outlives the revocation, so the click has to
      // re-check. Reset clears every override, so this is the worst one to let
      // through.
      const interaction = createButtonInteraction(
        'channel-settings::reset-confirm::channel-123',
        false
      );
      mockSessionManager.get.mockReturnValue(settingViewSession());
      stub.clearChannelConfigOverrides.mockResolvedValue(makeOk({ cleared: true }));

      await handleChannelSettingsButton(interaction as unknown as ButtonInteraction);

      expect(stub.clearChannelConfigOverrides).not.toHaveBeenCalled();
      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Manage Messages') })
      );
    });

    it('a set click is REFUSED when Manage Messages was revoked mid-session', async () => {
      const interaction = createButtonInteraction(
        'channel-settings::set::channel-123::maxMessages:auto',
        false
      );
      mockSessionManager.get.mockReturnValue(settingViewSession());

      await handleChannelSettingsButton(interaction as unknown as ButtonInteraction);

      expect(stub.updateChannelConfigOverrides).not.toHaveBeenCalled();
      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Manage Messages') })
      );
    });

    it('reset-confirm clears the channel overrides and re-renders from fresh data', async () => {
      const interaction = createButtonInteraction('channel-settings::reset-confirm::channel-123');
      mockSessionManager.get.mockReturnValue(settingViewSession());
      mockGetChannelSettings.mockResolvedValue(mockChannelSettings);
      stub.clearChannelConfigOverrides.mockResolvedValue(makeOk({ cleared: true }));

      await handleChannelSettingsButton(interaction as unknown as ButtonInteraction);

      expect(stub.clearChannelConfigOverrides).toHaveBeenCalledWith('channel-123');
      expect(mockInvalidateChannelSettingsCache).toHaveBeenCalledWith('channel-123');
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array), components: expect.any(Array) })
      );
      expect(interaction.followUp).not.toHaveBeenCalled();
    });

    it('reset-confirm failure notifies ephemerally without touching the dashboard', async () => {
      const interaction = createButtonInteraction('channel-settings::reset-confirm::channel-123');
      mockSessionManager.get.mockReturnValue(settingViewSession());
      stub.clearChannelConfigOverrides.mockResolvedValue(makeErr(500, 'Server error'));

      await handleChannelSettingsButton(interaction as unknown as ButtonInteraction);

      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Server error') })
      );
      expect(interaction.editReply).not.toHaveBeenCalled();
    });

    it('should handle API failure gracefully', async () => {
      const interaction = {
        customId: 'channel-settings::set::channel-123::maxMessages:auto',
        user: { id: '123456789' },
        memberPermissions: { has: vi.fn().mockReturnValue(true) },
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
    const createMockModalInteraction = (
      customId: string,
      inputValue: string,
      permitted = true
    ) => ({
      customId,
      user: { id: '123456789' },
      // Modal submits route through the same update handler, so they get the
      // same Manage Messages recheck.
      memberPermissions: { has: vi.fn().mockReturnValue(permitted) },
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

    it('a modal submit is REFUSED when Manage Messages was revoked mid-session', async () => {
      // The modal path shares createUpdateHandler's closure with the buttons,
      // so it inherits the recheck — pinned here so a future modal-specific
      // wiring change cannot quietly bypass it.
      // '2h', not raw seconds: maxAge parses as a duration string, and an
      // invalid value is rejected by client-side validation BEFORE the update
      // handler runs — which would make this test pass/fail for the wrong reason.
      const interaction = createMockModalInteraction(
        'channel-settings::modal::channel-123::maxAge',
        '2h',
        false
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));

      await handleChannelSettingsModal(interaction as never);

      expect(stub.updateChannelConfigOverrides).not.toHaveBeenCalled();
      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Manage Messages') })
      );
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
