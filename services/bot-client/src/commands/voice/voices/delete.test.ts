/**
 * Tests for Voice Delete Handler and Autocomplete (provider-agnostic)
 *
 * Autocomplete value encodes `${provider}:${voiceId}`; the handler splits
 * it on the seam to route to the right gateway URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { handleDeleteVoice, handleVoiceAutocomplete } from './delete.js';
import { _clearVoiceCacheForTesting } from './voiceCache.js';
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
vi.mock('../../../utils/userGatewayClient.js', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/userGatewayClient.js')>(
    '../../../utils/userGatewayClient.js'
  );
  return {
    ...actual,
    callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  };
});

describe('handleDeleteVoice', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(optionValue = 'elevenlabs:voice-1'): DeferredCommandContext {
    const mockInteraction = {
      user: { id: 'user-123', username: 'testuser' },
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
      getRequiredOption: vi.fn().mockReturnValue(optionValue),
      getSubcommand: vi.fn().mockReturnValue('delete'),
      getSubcommandGroup: vi.fn().mockReturnValue('voices'),
    } as unknown as DeferredCommandContext;
  }

  it('routes ElevenLabs voice deletion to the correct gateway URL', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        deleted: true,
        provider: 'elevenlabs',
        voiceId: 'voice-1',
        name: 'tzurot-alice',
        slug: 'alice',
      },
    });

    await handleDeleteVoice(createMockContext('elevenlabs:voice-1'));

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/voices/elevenlabs/voice-1',
      expect.objectContaining({
        method: 'DELETE',
        user: { discordId: 'user-123', username: 'testuser', displayName: 'testuser' },
      })
    );
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '🗑️ Voice Deleted',
            description: expect.stringContaining('alice'),
          }),
        }),
      ],
    });
  });

  it('routes Mistral voice deletion to the Mistral-tagged URL', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        deleted: true,
        provider: 'mistral',
        voiceId: 'mi-voice-1',
        name: 'tzurot-charlie',
        slug: 'charlie',
      },
    });

    await handleDeleteVoice(createMockContext('mistral:mi-voice-1'));

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/voices/mistral/mi-voice-1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('encodes the voiceId portion (defense against weird ids)', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { deleted: true, provider: 'mistral', voiceId: 'a/b', name: 'x', slug: 'x' },
    });
    await handleDeleteVoice(createMockContext('mistral:a/b'));

    const url = mockCallGatewayApi.mock.calls[0][0] as string;
    expect(url).toBe('/user/voices/mistral/a%2Fb');
  });

  it('rejects malformed option value (not provider:id) with a friendly error', async () => {
    await handleDeleteVoice(createMockContext('not-a-composite-id'));

    expect(mockCallGatewayApi).not.toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Invalid voice selection'),
      })
    );
  });

  it('rejects unknown provider segment in option value', async () => {
    await handleDeleteVoice(createMockContext('openai:some-voice'));

    expect(mockCallGatewayApi).not.toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid voice selection') })
    );
  });

  it('handles not-found error from gateway', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Voice not found',
    });

    await handleDeleteVoice(createMockContext('elevenlabs:nonexistent'));

    expect(mockEditReply).toHaveBeenCalledWith({ content: '❌ Voice not found' });
  });

  it('handles unexpected exceptions gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleDeleteVoice(createMockContext('elevenlabs:voice-1'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An unexpected error occurred. Please try again.',
    });
  });
});

describe('handleVoiceAutocomplete', () => {
  const mockRespond = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    _clearVoiceCacheForTesting();
  });

  function createMockAutocomplete(query = ''): AutocompleteInteraction {
    return {
      user: { id: 'user-123', username: 'testuser' },
      options: {
        getFocused: vi.fn().mockReturnValue(query),
        getSubcommandGroup: vi.fn().mockReturnValue('voices'),
        getSubcommand: vi.fn().mockReturnValue('delete'),
      },
      respond: mockRespond,
    } as unknown as AutocompleteInteraction;
  }

  it('emits provider-tagged choices with composite values', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        voices: [
          { provider: 'elevenlabs', voiceId: 'el1', name: 'tzurot-alice', slug: 'alice' },
          { provider: 'mistral', voiceId: 'mi1', name: 'tzurot-bob', slug: 'bob' },
        ],
        totalVoices: 10,
        tzurotCount: 2,
      },
    });

    await handleVoiceAutocomplete(createMockAutocomplete());

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'alice · elevenlabs', value: 'elevenlabs:el1' },
      { name: 'bob · mistral', value: 'mistral:mi1' },
    ]);
  });

  it('filters by query against slug', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        voices: [
          { provider: 'elevenlabs', voiceId: 'v1', name: 'tzurot-alice', slug: 'alice' },
          { provider: 'mistral', voiceId: 'v2', name: 'tzurot-bob', slug: 'bob' },
        ],
        totalVoices: 10,
        tzurotCount: 2,
      },
    });

    await handleVoiceAutocomplete(createMockAutocomplete('ali'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'alice · elevenlabs', value: 'elevenlabs:v1' },
    ]);
  });

  it('uses cached voices on subsequent calls', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        voices: [{ provider: 'elevenlabs', voiceId: 'v1', name: 'tzurot-alice', slug: 'alice' }],
        totalVoices: 10,
        tzurotCount: 1,
      },
    });

    await handleVoiceAutocomplete(createMockAutocomplete());
    await handleVoiceAutocomplete(createMockAutocomplete('ali'));

    expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);
    expect(mockRespond).toHaveBeenCalledTimes(2);
  });

  it('invalidates cache after successful delete', async () => {
    // Pre-populate cache via autocomplete
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        voices: [
          { provider: 'elevenlabs', voiceId: 'voice-1', name: 'tzurot-alice', slug: 'alice' },
        ],
        totalVoices: 10,
        tzurotCount: 1,
      },
    });
    await handleVoiceAutocomplete(createMockAutocomplete());
    expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);

    // Delete should invalidate cache
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        deleted: true,
        provider: 'elevenlabs',
        voiceId: 'voice-1',
        name: 'tzurot-alice',
        slug: 'alice',
      },
    });
    const mockEditReply = vi.fn();
    const mockContext = {
      interaction: { user: { id: 'user-123', username: 'testuser' }, editReply: mockEditReply },
      user: { id: 'user-123', username: 'testuser' },
      guild: null,
      member: null,
      channel: null,
      channelId: 'ch',
      guildId: null,
      commandName: 'settings',
      isEphemeral: true,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
      getOption: vi.fn(),
      getRequiredOption: vi.fn().mockReturnValue('elevenlabs:voice-1'),
      getSubcommand: vi.fn().mockReturnValue('delete'),
      getSubcommandGroup: vi.fn().mockReturnValue('voices'),
    } as unknown as DeferredCommandContext;
    await handleDeleteVoice(mockContext);

    // Autocomplete re-fetches (cache invalidated)
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { voices: [], totalVoices: 10, tzurotCount: 0 },
    });
    await handleVoiceAutocomplete(createMockAutocomplete());
    expect(mockCallGatewayApi).toHaveBeenCalledTimes(3);
  });

  it('returns empty on API error', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 404, error: 'Not found' });

    await handleVoiceAutocomplete(createMockAutocomplete());

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('returns empty on exception', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('timeout'));

    await handleVoiceAutocomplete(createMockAutocomplete());

    expect(mockRespond).toHaveBeenCalledWith([]);
  });
});
