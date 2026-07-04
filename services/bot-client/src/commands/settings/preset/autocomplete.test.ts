/**
 * Tests for Preset Command Autocomplete Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleAutocomplete } from './autocomplete.js';
import type { AutocompleteInteraction, User } from 'discord.js';
import { type PersonalitySummary } from '@tzurot/common-types/schemas/api/personality';
import { mockListWalletKeysResponse, mockLlmConfigSummary } from '@tzurot/test-factories';

// Mock logger
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

// Mock the autocomplete cache
const mockGetCachedPersonalities = vi.fn();
vi.mock('../../../utils/autocomplete/autocompleteCache.js', () => ({
  getCachedPersonalities: (...args: unknown[]) => mockGetCachedPersonalities(...args),
}));

const stub = {
  listUserLlmConfigs: vi.fn(),
  listWalletKeys: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({
    userClient: stub as unknown as import('@tzurot/clients').UserClient,
  })),
}));

import { UNLOCK_MODELS_VALUE } from './autocomplete.js';

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
    ownerId: 'owner-123',
    ownerDiscordId: 'discord-owner-123',
    permissions: { canEdit: isOwned, canDelete: isOwned },
    ...overrides,
  };
}

// Helper to mock both config and wallet APIs for config autocomplete tests
function mockConfigApis(
  configs: ReturnType<typeof mockLlmConfigSummary>[],
  hasActiveWallet: boolean
) {
  stub.listUserLlmConfigs.mockResolvedValue({ ok: true, data: { configs } });
  stub.listWalletKeys.mockResolvedValue({
    ok: true,
    data: mockListWalletKeysResponse(hasActiveWallet ? [{ isActive: true }] : []),
  });
}

describe('handleAutocomplete', () => {
  let mockInteraction: AutocompleteInteraction;
  let mockUser: User;

  beforeEach(() => {
    vi.clearAllMocks();

    mockUser = {
      id: 'user-123',
      username: 'testuser',
      globalName: 'testuser',
    } as User;

    mockInteraction = {
      user: mockUser,
      guildId: 'guild-123',
      commandName: 'model',
      options: {
        getFocused: vi.fn(),
        getSubcommand: vi.fn().mockReturnValue('set'),
        // The `kind` option is optional; null → handler defaults to 'text'.
        getString: vi.fn().mockReturnValue(null),
      },
      respond: vi.fn().mockResolvedValue(undefined),
    } as unknown as AutocompleteInteraction;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('personality autocomplete', () => {
    it('should respond with filtered personalities with visibility and slug', async () => {
      // Cast to handle getFocused(true) return type
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'character',
        value: 'test',
      } as unknown as string);
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [
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
        ],
      });

      await handleAutocomplete(mockInteraction);

      // Identity carried at the clientsFor boundary; see gatewayClients.test.ts
      // for the brand-binding contract.
      expect(mockGetCachedPersonalities).toHaveBeenCalledWith(expect.any(Object));
      // 🔒 = owned + private, includes slug in parentheses, value is id (model override API expects ID)
      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: '🔒 Test Bot (testbot)', value: 'p1' },
      ]);
    });

    it('should use name when displayName is null', async () => {
      // Cast to handle getFocused(true) return type
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'character',
        value: '',
      } as unknown as string);
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [
          mockPersonality({
            id: 'p1',
            name: 'TestBot',
            displayName: null,
            slug: 'testbot',
            isOwned: true,
            isPublic: false,
          }),
        ],
      });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: '🔒 TestBot (testbot)', value: 'p1' },
      ]);
    });

    it('should filter by slug', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'character',
        value: 'lil',
      } as unknown as string);
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [
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
        ],
      });

      await handleAutocomplete(mockInteraction);

      // 🌐 = PUBLIC (owned + public personality)
      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: '🌐 Lilith Bot (lilith)', value: 'p1' },
      ]);
    });

    it('should show 📖 icon for public personalities not owned', async () => {
      // Cast to handle getFocused(true) return type
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'character',
        value: '',
      } as unknown as string);
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [
          mockPersonality({
            id: 'p1',
            name: 'SharedBot',
            displayName: 'Shared Bot',
            slug: 'sharedbot',
            isOwned: false,
            isPublic: true,
          }),
        ],
      });

      await handleAutocomplete(mockInteraction);

      // 📖 = not owned (read-only)
      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: '📖 Shared Bot (sharedbot)', value: 'p1' },
      ]);
    });

    it('should respond with empty array on API error', async () => {
      // Cast to handle getFocused(true) return type
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'character',
        value: 'test',
      } as unknown as string);
      mockGetCachedPersonalities.mockRejectedValue(new Error('Cache error'));

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });

    it('should limit results to 25', async () => {
      // Cast to handle getFocused(true) return type
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'character',
        value: '',
      } as unknown as string);
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
      mockGetCachedPersonalities.mockResolvedValue({ kind: 'ok', value: manyPersonalities });

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
      } as unknown as string);
      mockConfigApis(
        [
          mockLlmConfigSummary({
            id: '00000000-0000-4000-8000-0000000000c1',
            name: 'Claude Config',
            model: 'anthropic/claude-sonnet-4',
            provider: 'openrouter',
            isGlobal: true,
            isOwned: false,
          }),
          mockLlmConfigSummary({
            id: '00000000-0000-4000-8000-0000000000c2',
            name: 'GPT Config',
            model: 'openai/gpt-4',
            provider: 'openrouter',
            isGlobal: true,
            isOwned: false,
          }),
        ],
        true // has wallet
      );

      await handleAutocomplete(mockInteraction);

      // Capability-agnostic: fetch ALL kinds (slot-independent picker).
      expect(stub.listUserLlmConfigs).toHaveBeenCalledWith({ kind: 'all' });
      expect(mockInteraction.respond).toHaveBeenCalledWith([
        {
          name: '🌐⭐ Claude Config · claude-sonnet-4',
          value: '00000000-0000-4000-8000-0000000000c1',
        },
      ]);
    });

    it('fetches all configs capability-agnostically and 👁-badges vision-capable ones', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      } as unknown as string);
      // A slot may be chosen on the command, but the picker is slot-independent.
      vi.mocked(mockInteraction.options.getString).mockReturnValue('vision');
      mockConfigApis(
        [
          mockLlmConfigSummary({
            id: '00000000-0000-4000-8000-0000000000d1',
            name: 'Vision Config',
            model: 'google/gemini-2.5-pro',
            provider: 'openrouter',
            isGlobal: true,
            isOwned: false,
            supportsVision: true,
          }),
        ],
        true
      );

      await handleAutocomplete(mockInteraction);

      // Always fetches all kinds (no slot-scoping); the vision row is 👁-badged.
      expect(stub.listUserLlmConfigs).toHaveBeenCalledWith({ kind: 'all' });
      const choices = vi.mocked(mockInteraction.respond).mock.calls[0][0] as {
        name: string;
        value: string;
      }[];
      expect(choices[0].name).toContain('👁');
    });

    it('should filter by model name', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'gpt',
      } as unknown as string);
      mockConfigApis(
        [
          mockLlmConfigSummary({
            id: '00000000-0000-4000-8000-0000000000c1',
            name: 'Claude Config',
            model: 'anthropic/claude-sonnet-4',
            provider: 'openrouter',
            isGlobal: true,
            isOwned: false,
          }),
          mockLlmConfigSummary({
            id: '00000000-0000-4000-8000-0000000000c2',
            name: 'GPT Config',
            model: 'openai/gpt-4',
            provider: 'openrouter',
            isGlobal: true,
            isOwned: false,
          }),
        ],
        true
      );

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: '🌐⭐ GPT Config · gpt-4', value: '00000000-0000-4000-8000-0000000000c2' },
      ]);
    });

    it('should filter by description', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'fast',
      } as unknown as string);
      mockConfigApis(
        [
          mockLlmConfigSummary({
            id: '00000000-0000-4000-8000-0000000000c1',
            name: 'Claude Config',
            description: 'Fast and cheap',
            model: 'anthropic/claude-sonnet-4',
            provider: 'openrouter',
            isGlobal: true,
            isOwned: false,
          }),
          mockLlmConfigSummary({
            id: '00000000-0000-4000-8000-0000000000c2',
            name: 'GPT Config',
            description: 'Slow but accurate',
            model: 'openai/gpt-4',
            provider: 'openrouter',
            isGlobal: true,
            isOwned: false,
          }),
        ],
        true
      );

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        {
          name: '🌐⭐ Claude Config · claude-sonnet-4',
          value: '00000000-0000-4000-8000-0000000000c1',
        },
      ]);
    });

    it('should respond with empty array on API error', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'test',
      } as unknown as string);
      stub.listUserLlmConfigs.mockResolvedValue({ ok: false, error: 'API error', status: 500 });
      stub.listWalletKeys.mockResolvedValue({ ok: true, data: { keys: [] } });

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });
  });

  describe('guest mode config autocomplete', () => {
    it('should only show free models for guest users', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      } as unknown as string);
      mockConfigApis(
        [
          mockLlmConfigSummary({
            id: '00000000-0000-4000-8000-0000000000c1',
            name: 'Claude Pro',
            model: 'anthropic/claude-sonnet-4',
            provider: 'openrouter',
            isGlobal: true,
            isOwned: false,
          }),
          mockLlmConfigSummary({
            id: '00000000-0000-4000-8000-0000000000c2',
            name: 'Grok Free',
            model: 'x-ai/grok-4.1-fast:free',
            provider: 'openrouter',
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
      expect(choices[0]).toEqual({
        name: '🌐🆓⭐ Grok Free · grok-4.1-fast:free',
        value: '00000000-0000-4000-8000-0000000000c2',
      });
      expect(choices[1]).toEqual({ name: '✨ Unlock All Models...', value: UNLOCK_MODELS_VALUE });
    });

    it('should add upsell option at the end for guest users', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      } as unknown as string);
      mockConfigApis(
        [
          mockLlmConfigSummary({
            id: '00000000-0000-4000-8000-0000000000c1',
            name: 'Free Config',
            model: 'some-model:free',
            provider: 'openrouter',
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
      } as unknown as string);
      mockConfigApis(
        [
          mockLlmConfigSummary({
            id: '00000000-0000-4000-8000-0000000000c1',
            name: 'Free Config',
            model: 'some-model:free',
            provider: 'openrouter',
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

    it('should fail open when wallet API errors — show all models, no upsell', async () => {
      // Pre-fix bug: walletResult.ok && ... collapsed to false on API failure,
      // forcing isGuestMode = true and hiding paid models for users who
      // actually have active keys. ai-worker enforces the gate authoritatively
      // at generation time, so failing open here is safe.
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      } as unknown as string);
      stub.listUserLlmConfigs.mockResolvedValue({
        ok: true,
        data: {
          configs: [
            mockLlmConfigSummary({
              id: '00000000-0000-4000-8000-0000000000c1',
              name: 'Claude Pro',
              model: 'anthropic/claude-sonnet-4',
              provider: 'openrouter',
              isGlobal: true,
              isOwned: false,
            }),
            mockLlmConfigSummary({
              id: '00000000-0000-4000-8000-0000000000c2',
              name: 'Grok Free',
              model: 'x-ai/grok-4.1-fast:free',
              provider: 'openrouter',
              isGlobal: true,
              isOwned: false,
            }),
          ],
        },
      });
      stub.listWalletKeys.mockResolvedValue({ ok: false, error: 'Gateway timeout', status: 504 });

      await handleAutocomplete(mockInteraction);

      const choices = vi.mocked(mockInteraction.respond).mock.calls[0][0] as {
        name: string;
        value: string;
      }[];
      // Both models should be present (no guest-mode filter applied)
      expect(choices).toHaveLength(2);
      // Upsell should NOT appear — we treated the user as paid
      expect(choices.some(c => c.value === UNLOCK_MODELS_VALUE)).toBe(false);
    });

    it('should add 🆓 badge to free models', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      } as unknown as string);
      mockConfigApis(
        [
          mockLlmConfigSummary({
            id: '00000000-0000-4000-8000-0000000000c1',
            name: 'Free Config',
            model: 'some-model:free',
            provider: 'openrouter',
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
      } as unknown as string);

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });
  });

  describe('error handling', () => {
    it('should respond with empty array on exception', async () => {
      // Cast to handle getFocused(true) return type
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'character',
        value: 'test',
      } as unknown as string);
      mockGetCachedPersonalities.mockRejectedValue(new Error('Network error'));

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });
  });
});
