/**
 * Tests for Preset Command Autocomplete Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AutocompleteInteraction, User } from 'discord.js';
import { mockListLlmConfigsResponse, mockLlmConfigSummary } from '@tzurot/test-factories';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

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

const { handleAutocomplete, __resetGlobalConfigCacheForTests } = await import('./autocomplete.js');

interface UserClientStub {
  listUserLlmConfigs: ReturnType<typeof vi.fn>;
}

interface OwnerClientStub {
  listGlobalLlmConfigs: ReturnType<typeof vi.fn>;
}

function createStub(): UserClientStub {
  return { listUserLlmConfigs: vi.fn() };
}

function createOwnerStub(): OwnerClientStub {
  return { listGlobalLlmConfigs: vi.fn() };
}

describe('handleAutocomplete', () => {
  let mockInteraction: AutocompleteInteraction;
  let mockUser: User;
  let stub: UserClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });

    mockUser = {
      id: 'user-123',
      username: 'testuser',
    } as User;

    mockInteraction = {
      user: mockUser,
      guildId: 'guild-123',
      commandName: 'preset',
      options: {
        getFocused: vi.fn(),
        getSubcommand: vi.fn().mockReturnValue('delete'),
        getSubcommandGroup: vi.fn().mockReturnValue(null),
        // The `kind` option is optional; null → handler defaults to 'text'.
        getString: vi.fn().mockReturnValue(null),
      },
      respond: vi.fn().mockResolvedValue(undefined),
    } as unknown as AutocompleteInteraction;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('preset autocomplete', () => {
    it('should respond with filtered user-owned presets only', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      } as unknown as string);
      stub.listUserLlmConfigs.mockResolvedValue(
        makeOk(
          mockListLlmConfigsResponse([
            mockLlmConfigSummary({
              id: '00000000-0000-4000-8000-0000000000c1',
              name: 'My Preset',
              model: 'anthropic/claude-sonnet-4',
              provider: 'openrouter',
              isGlobal: false,
              isOwned: true,
            }),
            mockLlmConfigSummary({
              id: '00000000-0000-4000-8000-0000000000c2',
              name: 'Global Preset',
              model: 'openai/gpt-4',
              provider: 'openrouter',
              isGlobal: true,
              isOwned: false,
            }),
          ])
        )
      );

      await handleAutocomplete(mockInteraction);

      // Capability-agnostic: fetch ALL kinds (slot-independent picker).
      expect(stub.listUserLlmConfigs).toHaveBeenCalledWith({ kind: 'all' });
      // Should only return owned presets
      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'My Preset · claude-sonnet-4', value: '00000000-0000-4000-8000-0000000000c1' },
      ]);
    });

    it('fetches all presets capability-agnostically and 👁-badges vision-capable ones', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      } as unknown as string);
      // A slot may be chosen on the command, but the picker is slot-independent.
      vi.mocked(mockInteraction.options.getString).mockReturnValue('vision');
      stub.listUserLlmConfigs.mockResolvedValue(
        makeOk(
          mockListLlmConfigsResponse([
            mockLlmConfigSummary({
              id: '00000000-0000-4000-8000-0000000000d1',
              name: 'Vision Preset',
              model: 'google/gemini-2.5-pro',
              isGlobal: false,
              isOwned: true,
              supportsVision: true,
            }),
          ])
        )
      );

      await handleAutocomplete(mockInteraction);

      // Always fetches all kinds (no slot-scoping); the vision row is 👁-badged.
      expect(stub.listUserLlmConfigs).toHaveBeenCalledWith({ kind: 'all' });
      const respondCall = vi.mocked(mockInteraction.respond).mock.calls[0][0] as {
        name: string;
        value: string;
      }[];
      expect(respondCall[0].name).toContain('👁');
    });

    it('should filter by preset name', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'fast',
      } as unknown as string);
      stub.listUserLlmConfigs.mockResolvedValue(
        makeOk(
          mockListLlmConfigsResponse([
            mockLlmConfigSummary({
              id: '00000000-0000-4000-8000-0000000000c1',
              name: 'Fast Preset',
              model: 'anthropic/claude-sonnet-4',
              provider: 'openrouter',
              isGlobal: false,
              isOwned: true,
            }),
            mockLlmConfigSummary({
              id: '00000000-0000-4000-8000-0000000000c2',
              name: 'Slow Preset',
              model: 'openai/gpt-4',
              provider: 'openrouter',
              isGlobal: false,
              isOwned: true,
            }),
          ])
        )
      );

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'Fast Preset · claude-sonnet-4', value: '00000000-0000-4000-8000-0000000000c1' },
      ]);
    });

    it('should filter by model name', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'gpt',
      } as unknown as string);
      stub.listUserLlmConfigs.mockResolvedValue(
        makeOk(
          mockListLlmConfigsResponse([
            mockLlmConfigSummary({
              id: '00000000-0000-4000-8000-0000000000c1',
              name: 'Claude Preset',
              model: 'anthropic/claude-sonnet-4',
              provider: 'openrouter',
              isGlobal: false,
              isOwned: true,
            }),
            mockLlmConfigSummary({
              id: '00000000-0000-4000-8000-0000000000c2',
              name: 'GPT Preset',
              model: 'openai/gpt-4',
              provider: 'openrouter',
              isGlobal: false,
              isOwned: true,
            }),
          ])
        )
      );

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'GPT Preset · gpt-4', value: '00000000-0000-4000-8000-0000000000c2' },
      ]);
    });

    it('should filter by description', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'cheap',
      } as unknown as string);
      stub.listUserLlmConfigs.mockResolvedValue(
        makeOk(
          mockListLlmConfigsResponse([
            mockLlmConfigSummary({
              id: '00000000-0000-4000-8000-0000000000c1',
              name: 'Preset A',
              description: 'Fast and cheap',
              model: 'anthropic/claude-sonnet-4',
              provider: 'openrouter',
              isGlobal: false,
              isOwned: true,
            }),
            mockLlmConfigSummary({
              id: '00000000-0000-4000-8000-0000000000c2',
              name: 'Preset B',
              description: 'Expensive but good',
              model: 'openai/gpt-4',
              provider: 'openrouter',
              isGlobal: false,
              isOwned: true,
            }),
          ])
        )
      );

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'Preset A · claude-sonnet-4', value: '00000000-0000-4000-8000-0000000000c1' },
      ]);
    });

    it('should respond with empty array on API error', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'test',
      } as unknown as string);
      stub.listUserLlmConfigs.mockResolvedValue(makeErr(500, 'API error'));

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });

    it('should limit results to 25', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      } as unknown as string);
      const manyPresets = Array.from({ length: 30 }, (_, i) =>
        mockLlmConfigSummary({
          // RFC-4122-valid UUID derived from the index (variant=8, version=4)
          id: `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
          name: `Preset${i}`,
          model: `provider/model${i}`,
          isGlobal: false,
          isOwned: true,
        })
      );
      stub.listUserLlmConfigs.mockResolvedValue(makeOk({ configs: manyPresets }));

      await handleAutocomplete(mockInteraction);

      const respondCall = vi.mocked(mockInteraction.respond).mock.calls[0][0];
      expect(respondCall).toHaveLength(25);
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

  describe('global config autocomplete (owner-only)', () => {
    // `handleGlobalConfigAutocomplete` reads through a module-level TTLCache
    // that survives `vi.clearAllMocks()` (it's module state, not a vi mock).
    // Each test resets it via the test-only `__resetGlobalConfigCacheForTests`
    // export so every case exercises the cold-fetch path independently — no
    // ordering dependency between `it()` blocks (per 02-code-standards.md).
    let ownerStub: OwnerClientStub;
    const cacheableFixture = makeOk({
      configs: [
        {
          id: 'g-claude',
          name: 'Global Claude',
          model: 'anthropic/claude-sonnet-4',
          isGlobal: true,
          isDefault: true,
        },
        {
          id: 'g-gpt',
          name: 'Global GPT',
          model: 'openai/gpt-4',
          isGlobal: true,
          isDefault: false,
        },
        {
          id: 'g-free',
          name: 'Global Free',
          model: 'x-ai/grok-4.1-fast:free',
          isGlobal: true,
          isDefault: false,
        },
      ],
    });

    beforeEach(() => {
      __resetGlobalConfigCacheForTests();
      ownerStub = createOwnerStub();
      clientsForMock.mockReturnValue({
        userClient: asUserClient(stub),
        ownerClient: ownerStub as never,
      });
      vi.mocked(mockInteraction.options.getSubcommandGroup).mockReturnValue('global');
    });

    it('responds with empty list when the admin endpoint fails', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      } as unknown as string);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('set-default');
      ownerStub.listGlobalLlmConfigs.mockResolvedValue(makeErr(403, 'forbidden'));

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });

    it('lists global presets filtered by query, attaches GLOBAL + DEFAULT badges', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'claude',
      } as unknown as string);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('set-default');
      ownerStub.listGlobalLlmConfigs.mockResolvedValue(cacheableFixture);

      await handleAutocomplete(mockInteraction);

      const respondCall = vi.mocked(mockInteraction.respond).mock.calls[0][0];
      expect(respondCall).toEqual([
        expect.objectContaining({
          value: 'g-claude',
          // Owner-only autocomplete attaches scope (🌐) + default (⭐) badges
          name: expect.stringContaining('Global Claude'),
        }),
      ]);
    });

    it('👁-badges vision-capable global configs', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      } as unknown as string);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('set-default');
      ownerStub.listGlobalLlmConfigs.mockResolvedValue(
        makeOk({
          configs: [
            {
              id: 'g-vision',
              name: 'Global Vision',
              model: 'google/gemini-2.5-pro',
              isGlobal: true,
              isDefault: false,
              supportsVision: true,
            },
          ],
        })
      );

      await handleAutocomplete(mockInteraction);

      const respondCall = vi.mocked(mockInteraction.respond).mock.calls[0][0] as {
        name: string;
        value: string;
      }[];
      expect(respondCall[0].name).toContain('👁');
    });

    it('restricts to free models when subcommand is free-default', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      } as unknown as string);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('free-default');
      ownerStub.listGlobalLlmConfigs.mockResolvedValue(cacheableFixture);

      await handleAutocomplete(mockInteraction);

      const respondCall = vi.mocked(mockInteraction.respond).mock.calls[0][0];
      // Only the :free-suffixed model survives the freeOnly filter
      expect(respondCall).toEqual([expect.objectContaining({ value: 'g-free' })]);
    });

    it('fetches the global list capability-agnostically (kind=all), ignoring the slot option', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      } as unknown as string);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('set-default');
      // Even with a vision slot chosen, the picker fetches BOTH kinds and badges
      // by capability — so the suggestion list doesn't reorder when the slot changes.
      vi.mocked(mockInteraction.options.getString).mockReturnValue('vision');
      ownerStub.listGlobalLlmConfigs.mockResolvedValue(cacheableFixture);

      await handleAutocomplete(mockInteraction);

      expect(ownerStub.listGlobalLlmConfigs).toHaveBeenCalledWith({ kind: 'all' });
    });

    it('caches the global config set — a second keystroke hits the cache', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: '',
      } as unknown as string);
      vi.mocked(mockInteraction.options.getSubcommand).mockReturnValue('set-default');
      ownerStub.listGlobalLlmConfigs.mockResolvedValue(cacheableFixture);

      await handleAutocomplete(mockInteraction);
      await handleAutocomplete(mockInteraction);

      // The capability-agnostic set is cached under one key, so the admin
      // endpoint is hit exactly once across keystrokes.
      expect(ownerStub.listGlobalLlmConfigs).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('should respond with empty array on exception', async () => {
      vi.mocked(mockInteraction.options.getFocused).mockReturnValue({
        name: 'preset',
        value: 'test',
      } as unknown as string);
      stub.listUserLlmConfigs.mockRejectedValue(new Error('Network error'));

      await handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });
  });
});
