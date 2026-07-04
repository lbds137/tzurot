/**
 * Tests for Character Settings Dashboard
 *
 * Tests the interactive settings dashboard for character settings.
 * Uses cascade config overrides via /user/config-overrides/ endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import {
  handleSettings,
  handleCharacterSettingsButton,
  handleCharacterSettingsModal,
  isCharacterSettingsInteraction,
} from './settings.js';
import type { EnvConfig } from '@tzurot/common-types/config/config';
import type { ResolvedConfigOverrides } from '@tzurot/common-types/schemas/api/configOverrides';

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
  resolvePersonalityCascade: ReturnType<typeof vi.fn>;
  updatePersonalityConfigDefaults: ReturnType<typeof vi.fn>;
}

const stub: StubUserClient = {
  getPersonality: vi.fn(),
  resolvePersonalityCascade: vi.fn(),
  updatePersonalityConfigDefaults: vi.fn(),
};

// `handleSettings` (entry) calls `getPersonality` + `resolvePersonalityCascade`
// via `clientsFor`. Button/modal handlers funnel through `settingsUpdateFactory`,
// which now also uses `clientsFor` to call `updatePersonalityConfigDefaults` +
// `resolvePersonalityCascade`. Single transport mocked.
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({
    userClient: stub as unknown as import('@tzurot/clients').UserClient,
  })),
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
      ownerId: 'user-456',
    },
  };

  const mockResolvedOverrides: ResolvedConfigOverrides = {
    maxMessages: 50,
    maxAge: 7200,
    maxImages: 5,
    memoryScoreThreshold: 0.5,
    memoryLimit: 20,
    focusModeEnabled: false,
    crossChannelHistoryEnabled: false,
    shareLtmAcrossPersonalities: false,
    showModelFooter: true,
    voiceResponseMode: 'always' as const,
    voiceTranscriptionEnabled: true,
    sources: {
      maxMessages: 'personality',
      maxAge: 'personality',
      maxImages: 'personality',
      memoryScoreThreshold: 'personality',
      memoryLimit: 'personality',
      focusModeEnabled: 'personality',
      crossChannelHistoryEnabled: 'personality',
      shareLtmAcrossPersonalities: 'personality',
      showModelFooter: 'hardcoded',
      voiceResponseMode: 'hardcoded' as const,
      voiceTranscriptionEnabled: 'hardcoded' as const,
    },
  };

  const mockConfig: EnvConfig = {} as EnvConfig;

  const createMockContext = (): Parameters<typeof handleSettings>[0] & {
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
    } as unknown as Parameters<typeof handleSettings>[0] & {
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
    stub.resolvePersonalityCascade.mockReset();
    stub.updatePersonalityConfigDefaults.mockReset();
  });

  describe('handleSettings', () => {
    it('should display settings dashboard embed', async () => {
      const context = createMockContext();
      stub.getPersonality.mockResolvedValue({ ok: true, data: mockPersonality });
      stub.resolvePersonalityCascade.mockResolvedValue({ ok: true, data: mockResolvedOverrides });

      await handleSettings(context, mockConfig);

      expect(stub.getPersonality).toHaveBeenCalledWith('aurora');
      expect(stub.resolvePersonalityCascade).toHaveBeenCalledWith('personality-123');
      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('should include Character Settings title in embed', async () => {
      const context = createMockContext();
      stub.getPersonality.mockResolvedValue({ ok: true, data: mockPersonality });
      stub.resolvePersonalityCascade.mockResolvedValue({ ok: true, data: mockResolvedOverrides });

      await handleSettings(context, mockConfig);

      const editReplyCall = context.editReply.mock.calls[0][0];
      expect(editReplyCall.embeds).toHaveLength(1);

      const embedJson = editReplyCall.embeds[0].toJSON();
      expect(embedJson.title).toBe('Character Settings');
    });

    it('should include character name in embed description', async () => {
      const context = createMockContext();
      stub.getPersonality.mockResolvedValue({ ok: true, data: mockPersonality });
      stub.resolvePersonalityCascade.mockResolvedValue({ ok: true, data: mockResolvedOverrides });

      await handleSettings(context, mockConfig);

      const editReplyCall = context.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      expect(embedJson.description).toContain('Aurora');
    });

    it('should include all 10 settings fields', async () => {
      const context = createMockContext();
      stub.getPersonality.mockResolvedValue({ ok: true, data: mockPersonality });
      stub.resolvePersonalityCascade.mockResolvedValue({ ok: true, data: mockResolvedOverrides });

      await handleSettings(context, mockConfig);

      const editReplyCall = context.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      expect(embedJson.fields).toHaveLength(10);
    });

    it('should extract personality-tier overrides as local values', async () => {
      const context = createMockContext();
      const resolvedWithPersonalityOverride: ResolvedConfigOverrides = {
        ...mockResolvedOverrides,
        maxMessages: 75,
        sources: {
          ...mockResolvedOverrides.sources,
          maxMessages: 'personality',
        },
      };
      stub.getPersonality.mockResolvedValue({ ok: true, data: mockPersonality });
      stub.resolvePersonalityCascade.mockResolvedValue({
        ok: true,
        data: resolvedWithPersonalityOverride,
      });

      await handleSettings(context, mockConfig);

      const editReplyCall = context.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();
      const maxMessagesField = embedJson.fields?.find((f: { name: string }) =>
        f.name?.includes('Max Messages')
      );

      // personality source should show as Override (localValue extracted)
      expect(maxMessagesField?.value).toContain('Override');
    });

    it('should handle character not found', async () => {
      const context = createMockContext();
      stub.getPersonality.mockResolvedValue({ ok: false, status: 404, error: 'Not found' });

      await handleSettings(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('not found'),
      });
    });

    it('should handle API errors gracefully', async () => {
      const context = createMockContext();
      stub.getPersonality.mockResolvedValue({ ok: false, status: 500, error: 'Server error' });

      await handleSettings(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to load character data'),
      });
    });

    it('should handle cascade resolve failure', async () => {
      const context = createMockContext();
      stub.getPersonality.mockResolvedValue({ ok: true, data: mockPersonality });
      stub.resolvePersonalityCascade.mockResolvedValue({ ok: false, error: 'Cascade error' });

      await handleSettings(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: '❌ Failed to fetch config settings.',
      });
    });

    it('should handle unexpected errors gracefully', async () => {
      const context = createMockContext();
      stub.getPersonality.mockRejectedValue(new Error('Network error'));

      await handleSettings(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: '❌ An error occurred while opening the settings dashboard.',
      });
    });

    it('should show error message on network failure', async () => {
      const context = createMockContext();
      stub.getPersonality.mockRejectedValue(new Error('Network error'));

      await handleSettings(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: '❌ An error occurred while opening the settings dashboard.',
      });
    });
  });

  describe('isCharacterSettingsInteraction', () => {
    it('should return true for character settings custom IDs', () => {
      expect(isCharacterSettingsInteraction('character-settings::select::aurora')).toBe(true);
      expect(
        isCharacterSettingsInteraction('character-settings::set::aurora::maxMessages:auto')
      ).toBe(true);
      expect(isCharacterSettingsInteraction('character-settings::back::aurora')).toBe(true);
      expect(isCharacterSettingsInteraction('character-settings::close::aurora')).toBe(true);
    });

    it('should return false for non-character settings custom IDs', () => {
      expect(isCharacterSettingsInteraction('channel-settings::select::chan-123')).toBe(false);
      expect(isCharacterSettingsInteraction('admin-settings::set::global')).toBe(false);
      // character::edit is the character editor, not settings
      expect(isCharacterSettingsInteraction('character::edit::my-char')).toBe(false);
    });

    it('should return false for empty custom ID', () => {
      expect(isCharacterSettingsInteraction('')).toBe(false);
    });
  });

  describe('handleCharacterSettingsButton', () => {
    it('should update crossChannelHistoryEnabled via set button', async () => {
      const interaction = {
        customId: 'character-settings::set::personality-123::crossChannelHistoryEnabled:true',
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

      stub.updatePersonalityConfigDefaults.mockResolvedValueOnce({ ok: true });
      stub.resolvePersonalityCascade.mockResolvedValueOnce({
        ok: true,
        data: mockResolvedOverrides,
      });

      await handleCharacterSettingsButton(interaction as unknown as ButtonInteraction);

      expect(stub.updatePersonalityConfigDefaults).toHaveBeenCalledWith('personality-123', {
        crossChannelHistoryEnabled: true,
      });
    });

    it('should update shareLtmAcrossPersonalities via set button', async () => {
      const interaction = {
        customId: 'character-settings::set::personality-123::shareLtmAcrossPersonalities:true',
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
          activeSetting: 'shareLtmAcrossPersonalities',
        },
      });

      stub.updatePersonalityConfigDefaults.mockResolvedValueOnce({ ok: true });
      stub.resolvePersonalityCascade.mockResolvedValueOnce({
        ok: true,
        data: mockResolvedOverrides,
      });

      await handleCharacterSettingsButton(interaction as unknown as ButtonInteraction);

      expect(stub.updatePersonalityConfigDefaults).toHaveBeenCalledWith('personality-123', {
        shareLtmAcrossPersonalities: true,
      });
    });

    it('should handle permission denied (401) response', async () => {
      // Entity ID now uses slug::personalityId format
      const interaction = {
        customId: 'character-settings::set::personality-123::maxMessages:auto',
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
          },
          view: 'setting',
          activeSetting: 'maxMessages',
        },
      });

      stub.updatePersonalityConfigDefaults.mockResolvedValue({
        ok: false,
        status: 401,
        error: 'Unauthorized',
      });

      await handleCharacterSettingsButton(interaction as unknown as ButtonInteraction);

      // The settings framework shows "Failed to update: {error}" via followUp (post-defer).
      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to update'),
        })
      );
    });

    it('should handle character not found (404) response', async () => {
      const interaction = {
        customId: 'character-settings::set::personality-123::maxMessages:auto',
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
          },
          view: 'setting',
          activeSetting: 'maxMessages',
        },
      });

      stub.updatePersonalityConfigDefaults.mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Not found',
      });

      await handleCharacterSettingsButton(interaction as unknown as ButtonInteraction);

      // The settings framework shows "Failed to update: {error}" via followUp (post-defer).
      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to update'),
        })
      );
    });
  });

  describe('handleCharacterSettingsModal', () => {
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

    // Entity ID is now slug::personalityId
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

    it('should update maxMessages setting via cascade endpoint', async () => {
      const interaction = createMockModalInteraction(
        'character-settings::modal::personality-123::maxMessages',
        '75'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      stub.updatePersonalityConfigDefaults.mockResolvedValueOnce({ ok: true });
      stub.resolvePersonalityCascade.mockResolvedValueOnce({
        ok: true,
        data: mockResolvedOverrides,
      });

      await handleCharacterSettingsModal(interaction as never);

      // Should call the typed-client method with the correct field
      expect(stub.updatePersonalityConfigDefaults).toHaveBeenCalledWith('personality-123', {
        maxMessages: 75,
      });
    });

    it('should update maxAge setting with duration string (2h)', async () => {
      const interaction = createMockModalInteraction(
        'character-settings::modal::personality-123::maxAge',
        '2h'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      stub.updatePersonalityConfigDefaults.mockResolvedValueOnce({ ok: true });
      stub.resolvePersonalityCascade.mockResolvedValueOnce({
        ok: true,
        data: mockResolvedOverrides,
      });

      await handleCharacterSettingsModal(interaction as never);

      expect(stub.updatePersonalityConfigDefaults).toHaveBeenCalledWith('personality-123', {
        maxAge: 7200,
      });
    });

    it('should update maxAge setting to "off" (disabled)', async () => {
      const interaction = createMockModalInteraction(
        'character-settings::modal::personality-123::maxAge',
        'off'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      stub.updatePersonalityConfigDefaults.mockResolvedValueOnce({ ok: true });
      stub.resolvePersonalityCascade.mockResolvedValueOnce({
        ok: true,
        data: mockResolvedOverrides,
      });

      await handleCharacterSettingsModal(interaction as never);

      // "off" maps to null in cascade config overrides
      expect(stub.updatePersonalityConfigDefaults).toHaveBeenCalledWith('personality-123', {
        maxAge: null,
      });
    });

    it('should set maxAge to auto (null) when auto selected', async () => {
      const interaction = createMockModalInteraction(
        'character-settings::modal::personality-123::maxAge',
        'auto'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxAge'));
      stub.updatePersonalityConfigDefaults.mockResolvedValueOnce({ ok: true });
      stub.resolvePersonalityCascade.mockResolvedValueOnce({
        ok: true,
        data: mockResolvedOverrides,
      });

      await handleCharacterSettingsModal(interaction as never);

      // "auto" means inherit (null) — inherit from lower cascade tier
      expect(stub.updatePersonalityConfigDefaults).toHaveBeenCalledWith('personality-123', {
        maxAge: null,
      });
    });

    it('should update maxImages setting via cascade endpoint', async () => {
      const interaction = createMockModalInteraction(
        'character-settings::modal::personality-123::maxImages',
        '10'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxImages'));
      stub.updatePersonalityConfigDefaults.mockResolvedValueOnce({ ok: true });
      stub.resolvePersonalityCascade.mockResolvedValueOnce({
        ok: true,
        data: mockResolvedOverrides,
      });

      await handleCharacterSettingsModal(interaction as never);

      expect(stub.updatePersonalityConfigDefaults).toHaveBeenCalledWith('personality-123', {
        maxImages: 10,
      });
    });

    it('should handle refresh failure after update', async () => {
      const interaction = createMockModalInteraction(
        'character-settings::modal::personality-123::maxMessages',
        '50'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      stub.updatePersonalityConfigDefaults.mockResolvedValueOnce({ ok: true });
      stub.resolvePersonalityCascade.mockResolvedValueOnce({ ok: false, error: 'Fetch failed' });

      await handleCharacterSettingsModal(interaction as never);

      // When refresh fails, handler should not call editReply (preserves state)
      expect(interaction.editReply).not.toHaveBeenCalled();
    });

    it('should handle thrown error in update handler gracefully', async () => {
      const interaction = createMockModalInteraction(
        'character-settings::modal::personality-123::maxMessages',
        '50'
      );

      mockSessionManager.get.mockReturnValue(createSessionWithSetting('maxMessages'));
      stub.updatePersonalityConfigDefaults.mockRejectedValueOnce(new Error('Network error'));

      await handleCharacterSettingsModal(interaction as never);

      // Error is caught — handler should not propagate
      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });
});
