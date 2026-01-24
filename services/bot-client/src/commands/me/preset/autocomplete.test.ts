/**
 * Tests for Preset Command Autocomplete Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleAutocomplete } from './autocomplete.js';
import type { AutocompleteInteraction, User } from 'discord.js';
import {
  mockListLlmConfigsResponse,
  mockLlmConfigSummary,
  mockListWalletKeysResponse,
} from '@tzurot/common-types';

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

// Mock the gateway client
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

// Mock the autocomplete cache
const mockGetCachedPersonalities = vi.fn();
vi.mock('../../../utils/autocomplete/autocompleteCache.js', () => ({
  getCachedPersonalities: (...args: unknown[]) => mockGetCachedPersonalities(...args),
}));

import { callGatewayApi } from '../../../utils/userGatewayClient.js';
import { UNLOCK_MODELS_VALUE } from './autocomplete.js';
import type { PersonalitySummary } from '@tzurot/common-types';

// Helper to create mock personality with required fields
function mockPersonality(overrides: Partial<PersonalitySummary>): PersonalitySummary {
  const isOwned = overrides.isOwned ?? true;
  return {
    id: 'p1',
    name: 'TestBot',
    displayName: null,
    slug: 'testbot',
    isOwned,
    isPublic: false,
    ownerId: null,
    ownerDiscordId: null,
    permissions: { canEdit: isOwned, canDelete: isOwned },
    ...overrides,
  };
}

// Helper to mock both config and wallet APIs for config autocomplete tests
function mockConfigApis(
  configs: ReturnType<typeof mockLlmConfigSummary>[],
  hasActiveWallet: boolean
) {
  vi.mocked(callGatewayApi).mockImplementation((path: string) => {
    if (path === '/user/llm-config') {
      return Promise.resolve({ ok: true, data: { configs } });
    }
    if (path === '/wallet/list') {
      return Promise.resolve({
        ok: true,
        data: mockListWalletKeysResponse(hasActiveWallet ? [{ isActive: true }] : []),
      });
    }
    return Promise.resolve({ ok: false, error: 'Unknown path', status: 404 });
  });
}

describe('handleAutocomplete', () => {
  let mockInteraction: AutocompleteInteraction;
  let mockUser: User;

  beforeEach(() => {
    vi.clearAllMocks();

    mockUser = {
      id: 'user-123',
    } as User;

    mockInteraction = {
      user: mockUser,
      guildId: 'guild-123',
      commandName: 'model',
      options: {
        getFocused: vi.fn(),
        getSubcommand: vi.fn().mockReturnValue('set'),
      },
      respond: vi.fn().mockResolvedValue(undefined),
    } as unknown as AutocompleteInteraction;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('personality autocomplete', () => {
    it('should respond with filtered personalities with visibility and slug', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'personality',
        value: 'test',
      });
      mockGetCachedPersonalities.mockResolvedValue([
        mockPersonality({
          id: 'p1',
          name: 'TestBot',
          displayName: 'Test Bot',
          slug: 'testbot',
          isOwned: true,
          isPublic: false,
        }),
        mockPersonality({
          id: 'p2',
          name: 'OtherBot',
          displayName: null,
          slug: 'otherbot',
          isOwned: false,
          isPublic: true,
        }),
      ]);

      await handleAutocomplete(mockInteraction);

      expect(mockGetCachedPersonalities).toHaveBeenCalledWith('user-123');
      // 🔒 = owned + private, includes slug in parentheses, value is id (model override API expects ID)
      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: '🔒 Test Bot (testbot)', value: 'p1' },
      ]);
    });

    it('should use name when displayName is null', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'personality',
        value: '',
      });
      mockGetCachedPersonalities.mockResolvedValue([
        mockPersonality({
          id: 'p1',
          name: 'TestBot',
          displayName: null,
          slug: 'testbot',
          isOwned: true,
          isPublic: false,
        }),
      ]);

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: '🔒 TestBot (testbot)', value: 'p1' },
      ]);
    });

    it('should filter by slug', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'personality',
        value: 'lil',
      });
      mockGetCachedPersonalities.mockResolvedValue([
        mockPersonality({
          id: 'p1',
          name: 'Lilith',
          displayName: 'Lilith Bot',
          slug: 'lilith',
          isOwned: true,
          isPublic: true,
        }),
        mockPersonality({
          id: 'p2',
          name: 'Other',
          displayName: 'Other Bot',
          slug: 'other',
          isOwned: false,
          isPublic: true,
        }),
      ]);

      await handleAutocomplete(mockInteraction);

      // 🌍 = PUBLIC (owned + public personality)
      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: '🌍 Lilith Bot (lilith)', value: 'p1' },
      ]);
    });

    it('should show 📖 icon for public personalities not owned', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'personality',
        value: '',
      });
      mockGetCachedPersonalities.mockResolvedValue([
        mockPersonality({
          id: 'p1',
          name: 'SharedBot',
          displayName: 'Shared Bot',
          slug: 'sharedbot',
          isOwned: false,
          isPublic: true,
        }),
      ]);

      await handleAutocomplete(mockInteraction);

      // 📖 = not owned (read-only)
      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: '📖 Shared Bot (sharedbot)', value: 'p1' },
      ]);
    });

    it('should respond with empty array on API error', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'personality',
        value: 'test',
      });
      mockGetCachedPersonalities.mockRejectedValue(new Error('Cache error'));

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });

    it('should limit results to 25', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'personality',
        value: '',
      });
      const manyPersonalities = Array.from({ length: 30 }, (_, i) =>
        mockPersonality({
          id: `p${i}`,
          name: `Personality${i}`,
          displayName: null,
          slug: `personality${i}`,
          isOwned: true,
          isPublic: false,
        })
      );
      mockGetCachedPersonalities.mockResolvedValue(manyPersonalities);

      await handleAutocomplete(mockInteraction);

      const respondCall = vi.mocked(mockInteraction.respond).mock.calls[0][0];
      expect(respondCall).toHaveLength(25);
    });
  });

  describe('config autocomplete', () => {
    it('should respond with filtered configs for users with wallet', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'claude',
      });
      mockConfigApis(
        [
          mockLlmConfigSummary({
            id: 'c1',
            name: 'Claude Config',
            model: 'anthropic/claude-sonnet-4',
            isGlobal: true,
            isOwned: false,
          }),
          mockLlmConfigSummary({
            id: 'c2',
            name: 'GPT Config',
            model: 'openai/gpt-4',
            isGlobal: true,
            isOwned: false,
          }),
        ],
        true // has wallet
      );

      await handleAutocomplete(mockInteraction);

      expect(callGatewayApi).toHaveBeenCalledWith('/user/llm-config', { userId: 'user-123' });
      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: '🌐⭐ Claude Config · claude-sonnet-4', value: 'c1' },
      ]);
    });

    it('should filter by model name', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'gpt',
      });
      mockConfigApis(
        [
          mockLlmConfigSummary({
            id: 'c1',
            name: 'Claude Config',
            model: 'anthropic/claude-sonnet-4',
            isGlobal: true,
            isOwned: false,
          }),
          mockLlmConfigSummary({
            id: 'c2',
            name: 'GPT Config',
            model: 'openai/gpt-4',
            isGlobal: true,
            isOwned: false,
          }),
        ],
        true
      );

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: '🌐⭐ GPT Config · gpt-4', value: 'c2' },
      ]);
    });

    it('should filter by description', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'fast',
      });
      mockConfigApis(
        [
          mockLlmConfigSummary({
            id: 'c1',
            name: 'Claude Config',
            description: 'Fast and cheap',
            model: 'anthropic/claude-sonnet-4',
            isGlobal: true,
            isOwned: false,
          }),
          mockLlmConfigSummary({
            id: 'c2',
            name: 'GPT Config',
            description: 'Slow but accurate',
            model: 'openai/gpt-4',
            isGlobal: true,
            isOwned: false,
          }),
        ],
        true
      );

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: '🌐⭐ Claude Config · claude-sonnet-4', value: 'c1' },
      ]);
    });

    it('should respond with empty array on API error', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'test',
      });
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: false,
        error: 'API error',
        status: 500,
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });
  });

  describe('guest mode config autocomplete', () => {
    it('should only show free models for guest users', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      });
      mockConfigApis(
        [
          mockLlmConfigSummary({
            id: 'c1',
            name: 'Claude Pro',
            model: 'anthropic/claude-sonnet-4',
            isGlobal: true,
            isOwned: false,
          }),
          mockLlmConfigSummary({
            id: 'c2',
            name: 'Grok Free',
            model: 'x-ai/grok-4.1-fast:free',
            isGlobal: true,
            isOwned: false,
          }),
        ],
        false // no wallet = guest mode
      );

      await handleAutocomplete(mockInteraction);

      const choices = vi.mocked(mockInteraction.respond).mock.calls[0][0] as {
        name: string;
        value: string;
      }[];
      // Should only have the free model + upsell option
      expect(choices).toHaveLength(2);
      // New standardized format: [scopeBadge][statusBadges] name · metadata
      // Factory defaults isDefault to true, so we get the ⭐ badge
      expect(choices[0]).toEqual({ name: '🌐🆓⭐ Grok Free · grok-4.1-fast:free', value: 'c2' });
      expect(choices[1]).toEqual({ name: '✨ Unlock All Models...', value: UNLOCK_MODELS_VALUE });
    });

    it('should add upsell option at the end for guest users', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      });
      mockConfigApis(
        [
          mockLlmConfigSummary({
            id: 'c1',
            name: 'Free Config',
            model: 'some-model:free',
            isGlobal: true,
            isOwned: false,
          }),
        ],
        false // guest mode
      );

      await handleAutocomplete(mockInteraction);

      const choices = vi.mocked(mockInteraction.respond).mock.calls[0][0] as {
        name: string;
        value: string;
      }[];
      expect(choices[choices.length - 1]).toEqual({
        name: '✨ Unlock All Models...',
        value: UNLOCK_MODELS_VALUE,
      });
    });

    it('should not add upsell option for users with wallet', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      });
      mockConfigApis(
        [
          mockLlmConfigSummary({
            id: 'c1',
            name: 'Free Config',
            model: 'some-model:free',
            isGlobal: true,
            isOwned: false,
          }),
        ],
        true // has wallet
      );

      await handleAutocomplete(mockInteraction);

      const choices = vi.mocked(mockInteraction.respond).mock.calls[0][0] as {
        name: string;
        value: string;
      }[];
      expect(choices.some(c => c.value === UNLOCK_MODELS_VALUE)).toBe(false);
    });

    it('should add 🆓 badge to free models', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      });
      mockConfigApis(
        [
          mockLlmConfigSummary({
            id: 'c1',
            name: 'Free Config',
            model: 'some-model:free',
            isGlobal: true,
            isOwned: false,
          }),
        ],
        true // even with wallet, free models get the badge
      );

      await handleAutocomplete(mockInteraction);

      const choices = vi.mocked(mockInteraction.respond).mock.calls[0][0] as {
        name: string;
        value: string;
      }[];
      expect(choices[0].name).toContain('🆓');
    });
  });

  describe('unknown option', () => {
    it('should respond with empty array for unknown option', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'unknown',
        value: 'test',
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });
  });

  describe('error handling', () => {
    it('should respond with empty array on exception', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'personality',
        value: 'test',
      });
      vi.mocked(callGatewayApi).mockRejectedValue(new Error('Network error'));

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });
  });
});
