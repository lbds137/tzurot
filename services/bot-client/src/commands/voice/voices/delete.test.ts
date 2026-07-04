/**
 * Tests for Voice Delete Handler and Autocomplete (provider-agnostic)
 *
 * Autocomplete value encodes `${provider}:${voiceId}`; the handler splits
 * it on the seam to route to the right typed-client method.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { handleDeleteVoice, handleVoiceAutocomplete } from './delete.js';
import { _clearVoiceCacheForTesting } from './voiceCache.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

const stub = {
  deleteVoice: vi.fn(),
  listVoices: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

describe('handleDeleteVoice', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stub.deleteVoice.mockReset();
    stub.listVoices.mockReset();
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

  it('routes ElevenLabs voice deletion via the typed client', async () => {
    stub.deleteVoice.mockResolvedValue(
      makeOk({
        deleted: true,
        provider: 'elevenlabs',
        voiceId: 'voice-1',
        name: 'tzurot-alice',
        slug: 'alice',
      })
    );

    await handleDeleteVoice(createMockContext('elevenlabs:voice-1'));

    expect(stub.deleteVoice).toHaveBeenCalledWith('elevenlabs', 'voice-1');
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

  it('routes Mistral voice deletion via the typed client', async () => {
    stub.deleteVoice.mockResolvedValue(
      makeOk({
        deleted: true,
        provider: 'mistral',
        voiceId: 'mi-voice-1',
        name: 'tzurot-charlie',
        slug: 'charlie',
      })
    );

    await handleDeleteVoice(createMockContext('mistral:mi-voice-1'));

    expect(stub.deleteVoice).toHaveBeenCalledWith('mistral', 'mi-voice-1');
  });

  it('rejects malformed option value (not provider:id) with a friendly error', async () => {
    await handleDeleteVoice(createMockContext('not-a-composite-id'));

    expect(stub.deleteVoice).not.toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Invalid voice selection'),
      })
    );
  });

  it('rejects unknown provider segment in option value', async () => {
    await handleDeleteVoice(createMockContext('openai:some-voice'));

    expect(stub.deleteVoice).not.toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid voice selection') })
    );
  });

  it('handles not-found error from gateway', async () => {
    stub.deleteVoice.mockResolvedValue(makeErr(404, 'Voice not found'));

    await handleDeleteVoice(createMockContext('elevenlabs:nonexistent'));

    expect(mockEditReply).toHaveBeenCalledWith({ content: '❌ Voice not found' });
  });

  it('handles unexpected exceptions gracefully', async () => {
    stub.deleteVoice.mockRejectedValue(new Error('Network error'));

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
    stub.deleteVoice.mockReset();
    stub.listVoices.mockReset();
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
    stub.listVoices.mockResolvedValue(
      makeOk({
        voices: [
          { provider: 'elevenlabs', voiceId: 'el1', name: 'tzurot-alice', slug: 'alice' },
          { provider: 'mistral', voiceId: 'mi1', name: 'tzurot-bob', slug: 'bob' },
        ],
        totalVoices: 10,
        tzurotCount: 2,
      })
    );

    await handleVoiceAutocomplete(createMockAutocomplete());

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'alice · elevenlabs', value: 'elevenlabs:el1' },
      { name: 'bob · mistral', value: 'mistral:mi1' },
    ]);
  });

  it('filters by query against slug', async () => {
    stub.listVoices.mockResolvedValue(
      makeOk({
        voices: [
          { provider: 'elevenlabs', voiceId: 'v1', name: 'tzurot-alice', slug: 'alice' },
          { provider: 'mistral', voiceId: 'v2', name: 'tzurot-bob', slug: 'bob' },
        ],
        totalVoices: 10,
        tzurotCount: 2,
      })
    );

    await handleVoiceAutocomplete(createMockAutocomplete('ali'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'alice · elevenlabs', value: 'elevenlabs:v1' },
    ]);
  });

  it('uses cached voices on subsequent calls', async () => {
    stub.listVoices.mockResolvedValue(
      makeOk({
        voices: [{ provider: 'elevenlabs', voiceId: 'v1', name: 'tzurot-alice', slug: 'alice' }],
        totalVoices: 10,
        tzurotCount: 1,
      })
    );

    await handleVoiceAutocomplete(createMockAutocomplete());
    await handleVoiceAutocomplete(createMockAutocomplete('ali'));

    expect(stub.listVoices).toHaveBeenCalledTimes(1);
    expect(mockRespond).toHaveBeenCalledTimes(2);
  });

  it('invalidates cache after successful delete', async () => {
    // Pre-populate cache via autocomplete
    stub.listVoices.mockResolvedValue(
      makeOk({
        voices: [
          { provider: 'elevenlabs', voiceId: 'voice-1', name: 'tzurot-alice', slug: 'alice' },
        ],
        totalVoices: 10,
        tzurotCount: 1,
      })
    );
    await handleVoiceAutocomplete(createMockAutocomplete());
    expect(stub.listVoices).toHaveBeenCalledTimes(1);

    // Delete should invalidate cache
    stub.deleteVoice.mockResolvedValue(
      makeOk({
        deleted: true,
        provider: 'elevenlabs',
        voiceId: 'voice-1',
        name: 'tzurot-alice',
        slug: 'alice',
      })
    );
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
    stub.listVoices.mockResolvedValue(makeOk({ voices: [], totalVoices: 10, tzurotCount: 0 }));
    await handleVoiceAutocomplete(createMockAutocomplete());
    expect(stub.listVoices).toHaveBeenCalledTimes(2);
  });

  it('returns empty on API error', async () => {
    stub.listVoices.mockResolvedValue(makeErr(404, 'Not found'));

    await handleVoiceAutocomplete(createMockAutocomplete());

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('returns empty on exception', async () => {
    stub.listVoices.mockRejectedValue(new Error('timeout'));

    await handleVoiceAutocomplete(createMockAutocomplete());

    expect(mockRespond).toHaveBeenCalledWith([]);
  });
});
