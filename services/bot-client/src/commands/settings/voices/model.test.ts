/**
 * Tests for Voice Model Selection Handler and Autocomplete
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { handleModelSet, handleModelAutocomplete } from './model.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

const mockCallGatewayApi = vi.fn();
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  GATEWAY_TIMEOUTS: { AUTOCOMPLETE: 2500, DEFERRED: 10000 },
  toGatewayUser: (user: { id?: string; username?: string; globalName?: string | null }) => ({
    discordId: user.id ?? 'test-user-id',
    username: user.username ?? 'testuser',
    displayName: user.globalName ?? user.username ?? 'testuser',
  }),
}));

describe('handleModelSet', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockContext(modelId = 'eleven_turbo_v2_5'): DeferredCommandContext {
    const mockInteraction = {
      user: { id: 'user-123' },
      editReply: mockEditReply,
    } as unknown as ChatInputCommandInteraction;

    return {
      interaction: mockInteraction,
      user: mockInteraction.user,
      guild: null,
      member: null,
      channel: null,
      channelId: 'channel-123',
      guildId: null,
      commandName: 'settings',
      isEphemeral: true,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
      getOption: vi.fn(),
      getRequiredOption: vi.fn().mockReturnValue(modelId),
      getSubcommand: vi.fn().mockReturnValue('model'),
      getSubcommandGroup: vi.fn().mockReturnValue('voices'),
    } as unknown as DeferredCommandContext;
  }

  it('should set TTS model successfully', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: true, data: {} });

    await handleModelSet(createMockContext('eleven_turbo_v2_5'));

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/config-overrides/defaults',
      expect.objectContaining({
        method: 'PATCH',
        user: {
          discordId: 'user-123',
          username: 'testuser',
          displayName: 'testuser',
        },
        body: { elevenlabsTtsModel: 'eleven_turbo_v2_5' },
      })
    );
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '🔊 TTS Model Updated',
            description: expect.stringContaining('eleven_turbo_v2_5'),
          }),
        }),
      ],
    });
  });

  it('should handle API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'Invalid model',
    });

    await handleModelSet(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Invalid model',
    });
  });

  it('should handle exceptions', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleModelSet(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An unexpected error occurred. Please try again.',
    });
  });
});

describe('handleModelAutocomplete', () => {
  const mockRespond = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockAutocomplete(query = ''): AutocompleteInteraction {
    return {
      user: { id: 'user-123' },
      options: {
        getFocused: vi.fn().mockReturnValue(query),
        getSubcommandGroup: vi.fn().mockReturnValue('voices'),
        getSubcommand: vi.fn().mockReturnValue('model'),
      },
      respond: mockRespond,
    } as unknown as AutocompleteInteraction;
  }

  it('should return model choices', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        models: [
          { modelId: 'eleven_multilingual_v2', name: 'Multilingual v2' },
          { modelId: 'eleven_turbo_v2_5', name: 'Turbo v2.5' },
        ],
      },
    });

    await handleModelAutocomplete(createMockAutocomplete());

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'Multilingual v2 (eleven_multilingual_v2)', value: 'eleven_multilingual_v2' },
      { name: 'Turbo v2.5 (eleven_turbo_v2_5)', value: 'eleven_turbo_v2_5' },
    ]);
  });

  it('should filter by query', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        models: [
          { modelId: 'eleven_multilingual_v2', name: 'Multilingual v2' },
          { modelId: 'eleven_turbo_v2_5', name: 'Turbo v2.5' },
        ],
      },
    });

    await handleModelAutocomplete(createMockAutocomplete('turbo'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'Turbo v2.5 (eleven_turbo_v2_5)', value: 'eleven_turbo_v2_5' },
    ]);
  });

  it('should return empty on API error', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'Internal error' });

    await handleModelAutocomplete(createMockAutocomplete());

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should return empty on exception', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('timeout'));

    await handleModelAutocomplete(createMockAutocomplete());

    expect(mockRespond).toHaveBeenCalledWith([]);
  });
});
