/**
 * Tests for Character Overrides Dashboard
 *
 * Tests the interactive overrides dashboard for per-user per-personality settings.
 * Uses cascade config overrides via /user/config-overrides/ endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import {
  handleOverrides,
  handleCharacterOverridesButton,
  handleCharacterOverridesModal,
  isCharacterOverridesInteraction,
} from './overrides.js';
import type { EnvConfig, ResolvedConfigOverrides } from '@tzurot/common-types';

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
  toGatewayUser: (user: { id?: string; username?: string; globalName?: string | null }) => ({
    discordId: user.id ?? 'test-user-id',
    username: user.username ?? 'testuser',
    displayName: user.globalName ?? user.username ?? 'testuser',
  }),
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
    focusModeEnabled: false,
    crossChannelHistoryEnabled: false,
    shareLtmAcrossPersonalities: false,
    showModelFooter: true,
    voiceResponseMode: 'always' as const,
    voiceTranscriptionEnabled: true,
    elevenlabsTtsModel: 'eleven_multilingual_v2',
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
      elevenlabsTtsModel: 'hardcoded' as const,
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
      user: { id: 'user-456' },
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
  });

  describe('handleOverrides', () => {
    it('should display overrides dashboard embed', async () => {
      const context = createMockContext();
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true, data: mockPersonality })
        .mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides });

      await handleOverrides(context, mockConfig);

      // First call: fetch personality
      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/personality/aurora', {
        method: 'GET',
        user: {
          discordId: 'user-456',
          username: 'testuser',
          displayName: 'testuser',
        },
        timeout: 10000,
      });
      // Second call: resolve full cascade overrides
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/config-overrides/resolve/personality-123',
        {
          method: 'GET',
          user: { discordId: 'user-456', username: 'testuser', displayName: 'testuser' },
          timeout: 10000,
        }
      );
      expect(context.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('should include Character Override Settings title in embed', async () => {
      const context = createMockContext();
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true, data: mockPersonality })
        .mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides });

      await handleOverrides(context, mockConfig);

      const editReplyCall = context.editReply.mock.calls[0][0];
      expect(editReplyCall.embeds).toHaveLength(1);

      const embedJson = editReplyCall.embeds[0].toJSON();
      expect(embedJson.title).toBe('Character Override Settings');
    });

    it('should include character name in embed description', async () => {
      const context = createMockContext();
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true, data: mockPersonality })
        .mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides });

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
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true, data: mockPersonality })
        .mockResolvedValueOnce({ ok: true, data: resolvedWithUserOverride });

      await handleOverrides(context, mockConfig);

      const editReplyCall = context.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();
      const maxMessagesField = embedJson.fields?.find((f: { name: string }) =>
        f.name?.includes('Max Messages')
      );

      // user-personality source should show as Override (localValue extracted)
      expect(maxMessagesField?.value).toContain('Override');
    });

    it('should handle character not found', async () => {
      const context = createMockContext();
      mockCallGatewayApi.mockResolvedValue({
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
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Server error',
      });

      await handleOverrides(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to load character data'),
      });
    });

    it('should handle cascade resolve failure', async () => {
      const context = createMockContext();
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true, data: mockPersonality })
        .mockResolvedValueOnce({ ok: false, error: 'Cascade error' });

      await handleOverrides(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: '❌ Failed to fetch config settings.',
      });
    });

    it('should handle unexpected errors gracefully', async () => {
      const context = createMockContext();
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleOverrides(context, mockConfig);

      expect(context.editReply).toHaveBeenCalledWith({
        content: '❌ An error occurred while opening the overrides dashboard.',
      });
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
        user: { id: 'user-456' },
        reply: vi.fn(),
        update: vi.fn(),
        showModal: vi.fn(),
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

      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true }) // PATCH config-overrides
        .mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides }); // GET resolve

      await handleCharacterOverridesButton(interaction as unknown as ButtonInteraction);

      // Should use user-personality endpoint (not personality-tier)
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/config-overrides/personality-123',
        expect.objectContaining({
          method: 'PATCH',
          body: { crossChannelHistoryEnabled: true },
        })
      );
    });
  });

  describe('handleCharacterOverridesModal', () => {
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
      mockCallGatewayApi
        .mockResolvedValueOnce({ ok: true }) // PATCH config-overrides
        .mockResolvedValueOnce({ ok: true, data: mockResolvedOverrides }); // GET resolve

      await handleCharacterOverridesModal(interaction as never);

      // Should call PATCH on user-personality cascade endpoint
      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/config-overrides/personality-123',
        expect.objectContaining({
          method: 'PATCH',
          body: { maxMessages: 75 },
        })
      );
    });
  });
});
