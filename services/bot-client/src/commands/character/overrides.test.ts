/**
 * Tests for Character Overrides Dashboard
 *
 * Tests the interactive overrides dashboard for per-user per-character settings.
 * Uses cascade config overrides via /user/config-overrides/ endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import {
  CHARACTER_OVERRIDES_CONFIG,
  handleOverrides,
  handleCharacterOverridesButton,
  handleCharacterOverridesModal,
  isCharacterOverridesInteraction,
} from './overrides.js';
import type { EnvConfig } from '@tzurot/common-types/config/config';
import type { ResolvedConfigOverrides } from '@tzurot/common-types/schemas/api/configOverrides';
import type { UserClient } from '@tzurot/clients';
import {
  EXTENDED_CONTEXT_SETTINGS,
  MEMORY_SETTINGS,
  DISPLAY_SETTINGS,
  VOICE_CASCADE_SETTINGS,
  buildCascadePages,
} from '../../utils/dashboard/settings/settingsConfig.js';
import { buildSettingsCustomId } from '../../utils/dashboard/settings/types.js';

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

interface StubUserClient {
  getPersonality: ReturnType<typeof vi.fn>;
  resolveCascade: ReturnType<typeof vi.fn>;
  updatePersonalityOverrides: ReturnType<typeof vi.fn>;
}

const stub: StubUserClient = {
  getPersonality: vi.fn(),
  resolveCascade: vi.fn(),
  updatePersonalityOverrides: vi.fn(),
};

// Single transport: `handleOverrides` (entry) calls `getPersonality` +
// `resolveCascade` via `clientsFor`. Button/modal handlers funnel through
// `settingsUpdateFactory`, which also uses `clientsFor` to call
// `updatePersonalityOverrides` + `resolveCascade`.
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
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

describe('Character Overrides Dashboard', () => {
  const mockPersonality = {
    personality: {
      id: 'personality-123',
      name: 'Aurora',
      slug: 'aurora',
      ownerId: 'user-456',
    },
  };

  const mockResolvedOverrides: ResolvedConfigOverrides = {
    maxMessages: 50,
    maxAge: 7200,
    maxImages: 5,
    memoryScoreThreshold: 0.5,
    memoryLimit: 20,
    crossChannelHistoryEnabled: false,
    crossChannelRenderMode: 'both',
    crossChannelMaxMessages: null,
    sameChannelRenderMode: 'both',
    sameChannelVerbatimExchanges: 10,
    shareLtmAcrossPersonalities: false,
    showModelFooter: true,
    voiceResponseMode: 'always' as const,
    voiceTranscriptionEnabled: true,
    shareHistoryAcrossPersonalities: 'always' as const,
    sources: {
      maxMessages: 'personality',
      maxAge: 'personality',
      maxImages: 'personality',
      memoryScoreThreshold: 'personality',
      memoryLimit: 'personality',
      crossChannelHistoryEnabled: 'personality',
      crossChannelRenderMode: 'personality',
      crossChannelMaxMessages: 'personality',
      sameChannelRenderMode: 'personality',
      sameChannelVerbatimExchanges: 'personality',
      shareLtmAcrossPersonalities: 'personality',
      showModelFooter: 'hardcoded',
      voiceResponseMode: 'hardcoded' as const,
      voiceTranscriptionEnabled: 'hardcoded' as const,
      shareHistoryAcrossPersonalities: 'hardcoded' as const,
    },
    parentValues: {
      maxMessages: 50,
      maxAge: null,
      maxImages: 10,
      memoryScoreThreshold: 0.5,
      memoryLimit: 20,
      crossChannelHistoryEnabled: false,
      crossChannelRenderMode: 'both',
      crossChannelMaxMessages: null,
      sameChannelRenderMode: 'both',
      sameChannelVerbatimExchanges: 10,
      shareLtmAcrossPersonalities: false,
      showModelFooter: true,
      voiceResponseMode: 'always',
      voiceTranscriptionEnabled: true,
      shareHistoryAcrossPersonalities: 'always',
    },
  };

  const mockConfig: EnvConfig = {} as EnvConfig;

  const createMockContext = (): Parameters<typeof handleOverrides>[0] & {
    editReply: ReturnType<typeof vi.fn>;
    interaction: {
      deferred: boolean;
      replied: boolean;
      channelId: string;
      editReply: ReturnType<typeof vi.fn>;
      options: {
        getString: ReturnType<typeof vi.fn>;
      };
    };
  } => {
    const mockEditReply = vi.fn().mockResolvedValue({ id: 'message-123' });
    return {
      interaction: {
        options: {
          getString: vi.fn().mockReturnValue('aurora'),
        },
        channelId: 'channel-789',
        deferred: true,
        replied: false,
        editReply: mockEditReply,
      },
      user: { id: 'user-456', username: 'testuser' },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleOverrides>[0] & {
      editReply: ReturnType<typeof vi.fn>;
      interaction: {
        deferred: boolean;
        replied: boolean;
        channelId: string;
        editReply: ReturnType<typeof vi.fn>;
        options: {
          getString: ReturnType<typeof vi.fn>;
        };
      };
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    stub.getPersonality.mockReset();
    stub.resolveCascade.mockReset();
    stub.updatePersonalityOverrides.mockReset();
  });

  describe('handleOverrides', () => {
    it('should display overrides dashboard embed', async () => {
      const context = createMockContext();
      stub.getPersonality.mockResolvedValue({ ok: true, data: mockPersonality });
      stub.resolveCascade.mockResolvedValue({ ok: true, data: mockResolvedOverrides });

      await handleOverrides(context, mockConfig);

      expect(stub.getPersonality).toHaveBeenCalledWith('aurora');
      expect(stub.resolveCascade).toHaveBeenCalledWith('personality-123');
      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('should include Character Override Settings title in embed', async () => {
      const context = createMockContext();
      stub.getPersonality.mockResolvedValue({ ok: true, data: mockPersonality });
      stub.resolveCascade.mockResolvedValue({ ok: true, data: mockResolvedOverrides });

      await handleOverrides(context, mockConfig);

      const editReplyCall = context.editReply.mock.calls[0][0];
      expect(editReplyCall.embeds).toHaveLength(1);
      const embedJson = editReplyCall.embeds[0].toJSON();
      // 3 concern pages is under the index-landing threshold: opens on page 1.
      expect(embedJson.title).toBe('Character Override Settings · Memory');
      const labels = editReplyCall.components[1]
        .toJSON()
        .components.map((c: { label?: string }) => c.label);
      expect(labels).toEqual(['Prev', '1/3', 'Next', 'Index']);
    });

    it('should include character name in embed description', async () => {
      const context = createMockContext();
      stub.getPersonality.mockResolvedValue({ ok: true, data: mockPersonality });
      stub.resolveCascade.mockResolvedValue({ ok: true, data: mockResolvedOverrides });

      await handleOverrides(context, mockConfig);

      const editReplyCall = context.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();
      expect(embedJson.description).toContain('Aurora');
    });

    it('should extract user-personality overrides as local values', async () => {
      const context = createMockContext();
      const resolvedWithUserOverride: ResolvedConfigOverrides = {
        ...mockResolvedOverrides,
        maxMessages: 75,
        sources: {
          ...mockResolvedOverrides.sources,
          maxMessages: 'user-personality',
        },
      };
      stub.getPersonality.mockResolvedValue({ ok: true, data: mockPersonality });
      stub.resolveCascade.mockResolvedValue({ ok: true, data: resolvedWithUserOverride });

      await handleOverrides(context, mockConfig);

      // Max Messages lives on page 2 (Context & Display): press Next through
      // the real router, then match the field by its exact name — a substring
      // match would also hit Cross-Channel Max Messages.
      const stored = mockSessionManager.set.mock.calls.at(-1)?.[0];
      mockSessionManager.get.mockReturnValue({ data: stored.data });
      const next = {
        customId: 'character-overrides::page::personality-123::next',
        user: { id: 'user-456' },
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
      };
      await handleCharacterOverridesButton(next as unknown as ButtonInteraction);
      const embedJson = next.editReply.mock.calls[0][0].embeds[0].toJSON();
      expect(embedJson.title).toBe('Character Override Settings · Context & Display');
      const maxMessagesField = embedJson.fields?.find(
        (f: { name: string }) => f.name === '💬 Max Messages'
      );
      expect(maxMessagesField?.value).toContain('Override');
    });

    it('should handle character not found', async () => {
      const context = createMockContext();
      stub.getPersonality.mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Not found',
      });

      await handleOverrides(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('not found'),
      });
    });

    it('should handle API errors gracefully', async () => {
      const context = createMockContext();
      stub.getPersonality.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Server error',
      });

      await handleOverrides(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to load the character'),
      });
    });

    it('should handle cascade resolve failure', async () => {
      const context = createMockContext();
      stub.getPersonality.mockResolvedValue({ ok: true, data: mockPersonality });
      stub.resolveCascade.mockResolvedValue({ ok: false, error: 'Cascade error' });

      await handleOverrides(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: '❌ Failed to load the config settings. Please try again.',
      });
    });

    it('should handle unexpected errors gracefully', async () => {
      const context = createMockContext();
      stub.getPersonality.mockRejectedValue(new Error('Network error'));

      await handleOverrides(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: '❌ Failed to open the overrides dashboard. Please try again.',
      });
    });
  });

  describe('concern-page split (flat → Memory · Context & Display · Voice)', () => {
    // The pre-split flat list. The split regroups these; it adds and drops none.
    const PRE_SPLIT_IDS = [
      ...EXTENDED_CONTEXT_SETTINGS,
      ...MEMORY_SETTINGS,
      ...DISPLAY_SETTINGS,
      ...VOICE_CASCADE_SETTINGS,
    ].map(s => s.id);
    const CASCADE_TIER = buildCascadePages(VOICE_CASCADE_SETTINGS);

    it('keeps the settings set identical to the pre-split flat list', () => {
      const ids = CHARACTER_OVERRIDES_CONFIG.settings.map(s => s.id);
      expect([...ids].sort()).toEqual([...PRE_SPLIT_IDS].sort());
      expect(ids).toEqual(CASCADE_TIER.settings.map(s => s.id));
    });

    it("uses the cascade tiers' concern pages, every setting on exactly one page", () => {
      expect(CHARACTER_OVERRIDES_CONFIG.pages).toEqual(CASCADE_TIER.pages);
      expect(CHARACTER_OVERRIDES_CONFIG.pages?.map(p => p.label)).toEqual([
        'Memory',
        'Context & Display',
        'Voice',
      ]);
      const paged = (CHARACTER_OVERRIDES_CONFIG.pages ?? []).flatMap(p => p.settingIds);
      expect([...paged].sort()).toEqual([...PRE_SPLIT_IDS].sort());
    });
  });

  describe('Reset page / Reset all', () => {
    const PERSONALITY_UUID = '765a9b5a-857f-5822-bc60-37cc8aada4ac';

    const memoryPageSession = (extraData: Record<string, unknown> = {}) => ({
      data: {
        userId: 'user-456',
        entityId: PERSONALITY_UUID,
        entityName: 'Aurora',
        data: {
          crossChannelHistoryEnabled: {
            localValue: true,
            hasLocalOverride: true,
            effectiveValue: true,
            source: 'user-personality',
            parentValue: false,
          },
          shareLtmAcrossPersonalities: {
            localValue: true,
            hasLocalOverride: true,
            effectiveValue: true,
            source: 'user-personality',
            parentValue: false,
          },
          ...extraData,
        },
        view: 'overview',
        page: 0,
      },
    });

    const buttonInteraction = (customId: string) =>
      ({
        customId,
        user: { id: 'user-456', username: 'testuser' },
        deferUpdate: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
      }) as unknown as ButtonInteraction & {
        deferUpdate: ReturnType<typeof vi.fn>;
        editReply: ReturnType<typeof vi.fn>;
        followUp: ReturnType<typeof vi.fn>;
      };

    beforeEach(() => {
      stub.resolveCascade.mockResolvedValue({ ok: true, data: mockResolvedOverrides });
    });

    it("Reset page clears exactly the page's locally-set settings in one PATCH", async () => {
      mockSessionManager.get.mockReturnValue(memoryPageSession());
      const customId = buildSettingsCustomId(
        'character-overrides',
        'reset-confirm',
        PERSONALITY_UUID,
        'page:memory'
      );
      const interaction = buttonInteraction(customId);
      stub.updatePersonalityOverrides.mockResolvedValueOnce({ ok: true });

      await handleCharacterOverridesButton(interaction);

      expect(stub.updatePersonalityOverrides).toHaveBeenCalledTimes(1);
      expect(stub.updatePersonalityOverrides).toHaveBeenCalledWith(PERSONALITY_UUID, {
        crossChannelHistoryEnabled: null,
        shareLtmAcrossPersonalities: null,
      });
      const rendered = interaction.editReply.mock.calls[0][0].embeds[0].toJSON();
      expect(rendered.title).toContain('Memory');
    });

    it('Reset all clears every locally-set setting across pages in one PATCH', async () => {
      mockSessionManager.get.mockReturnValue(
        memoryPageSession({
          maxMessages: {
            localValue: 25,
            hasLocalOverride: true,
            effectiveValue: 25,
            source: 'user-personality',
            parentValue: 50,
          },
        })
      );
      const customId = buildSettingsCustomId(
        'character-overrides',
        'reset-confirm',
        PERSONALITY_UUID,
        'all'
      );
      const interaction = buttonInteraction(customId);
      stub.updatePersonalityOverrides.mockResolvedValueOnce({ ok: true });

      await handleCharacterOverridesButton(interaction);

      expect(stub.updatePersonalityOverrides).toHaveBeenCalledTimes(1);
      expect(stub.updatePersonalityOverrides).toHaveBeenCalledWith(PERSONALITY_UUID, {
        crossChannelHistoryEnabled: null,
        shareLtmAcrossPersonalities: null,
        maxMessages: null,
      });
      const rendered = interaction.editReply.mock.calls[0][0].embeds[0].toJSON();
      expect(rendered.title).toBe('Character Override Settings · Index');
    });
  });

  describe('isCharacterOverridesInteraction', () => {
    it('should return true for character overrides custom IDs', () => {
      expect(isCharacterOverridesInteraction('character-overrides::select::aurora')).toBe(true);
      expect(
        isCharacterOverridesInteraction('character-overrides::set::aurora::maxMessages:auto')
      ).toBe(true);
      expect(isCharacterOverridesInteraction('character-overrides::back::aurora')).toBe(true);
      expect(isCharacterOverridesInteraction('character-overrides::close::aurora')).toBe(true);
    });

    it('should return false for non-character overrides custom IDs', () => {
      expect(isCharacterOverridesInteraction('character-settings::select::aurora')).toBe(false);
      expect(isCharacterOverridesInteraction('channel-settings::select::chan-123')).toBe(false);
      expect(isCharacterOverridesInteraction('admin-settings::set::global')).toBe(false);
    });

    it('should return false for empty custom ID', () => {
      expect(isCharacterOverridesInteraction('')).toBe(false);
    });
  });

  describe('handleCharacterOverridesButton', () => {
    it('should update setting via user-personality cascade endpoint', async () => {
      const interaction = {
        customId: 'character-overrides::set::personality-123::crossChannelHistoryEnabled:true',
        user: { id: 'user-456', username: 'testuser' },
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
          entityId: 'personality-123',
          data: {
            maxMessages: { localValue: null, effectiveValue: 50, source: 'personality' },
            maxAge: { localValue: null, effectiveValue: 7200, source: 'personality' },
            maxImages: { localValue: null, effectiveValue: 5, source: 'personality' },
            crossChannelHistoryEnabled: {
              localValue: null,
              effectiveValue: false,
              source: 'hardcoded',
            },
            shareLtmAcrossPersonalities: {
              localValue: null,
              effectiveValue: false,
              source: 'hardcoded',
            },
          },
          view: 'setting',
          activeSetting: 'crossChannelHistoryEnabled',
        },
      });

      stub.updatePersonalityOverrides.mockResolvedValueOnce({ ok: true });
      stub.resolveCascade.mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides });

      await handleCharacterOverridesButton(interaction as unknown as ButtonInteraction);

      expect(stub.updatePersonalityOverrides).toHaveBeenCalledWith('personality-123', {
        crossChannelHistoryEnabled: true,
      });
    });
  });

  describe('handleCharacterOverridesModal', () => {
    const createMockModalInteraction = (customId: string, inputValue: string) => ({
      customId,
      user: { id: 'user-456', username: 'testuser' },
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
        entityId: 'personality-123',
        data: {
          maxMessages: { localValue: null, effectiveValue: 50, source: 'personality' },
          maxAge: { localValue: null, effectiveValue: 7200, source: 'personality' },
          maxImages: { localValue: null, effectiveValue: 5, source: 'personality' },
        },
        view: 'setting',
        activeSetting: settingId,
      },
    });

    it('should update maxMessages setting via user-personality cascade endpoint', async () => {
      const interaction = createMockModalInteraction(
        'character-overrides::modal::personality-123::maxMessages',
        '75'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      stub.updatePersonalityOverrides.mockResolvedValueOnce({ ok: true });
      stub.resolveCascade.mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides });

      await handleCharacterOverridesModal(interaction as never);

      expect(stub.updatePersonalityOverrides).toHaveBeenCalledWith('personality-123', {
        maxMessages: 75,
      });
    });
  });
});
