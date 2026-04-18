/**
 * Tests for Voice Delete Handler and Autocomplete
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

  function createMockContext(voiceId = 'voice-1'): DeferredCommandContext {
    const mockInteraction = {
      user: { id: 'user-123' , username: 'testuser' },
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
      getRequiredOption: vi.fn().mockReturnValue(voiceId),
      getSubcommand: vi.fn().mockReturnValue('delete'),
      getSubcommandGroup: vi.fn().mockReturnValue('voices'),
    } as unknown as DeferredCommandContext;
  }

  it('should delete a voice successfully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { deleted: true, voiceId: 'voice-1', name: 'tzurot-alice', slug: 'alice' },
    });

    await handleDeleteVoice(createMockContext());

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/voices/voice-1',
      expect.objectContaining({ method: 'DELETE', user: { discordId: 'user-123', username: 'testuser', displayName: 'testuser' } })
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

  it('should handle not found error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Voice not found',
    });

    await handleDeleteVoice(createMockContext('nonexistent'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Voice not found',
    });
  });

  it('should handle exceptions', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleDeleteVoice(createMockContext());

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
      user: { id: 'user-123' , username: 'testuser' },
      options: {
        getFocused: vi.fn().mockReturnValue(query),
        getSubcommandGroup: vi.fn().mockReturnValue('voices'),
        getSubcommand: vi.fn().mockReturnValue('delete'),
      },
      respond: mockRespond,
    } as unknown as AutocompleteInteraction;
  }

  it('should return voice choices', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        voices: [
          { voiceId: 'v1', name: 'tzurot-alice', slug: 'alice' },
          { voiceId: 'v2', name: 'tzurot-bob', slug: 'bob' },
        ],
        totalVoices: 10,
        tzurotCount: 2,
      },
    });

    await handleVoiceAutocomplete(createMockAutocomplete());

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'alice', value: 'v1' },
      { name: 'bob', value: 'v2' },
    ]);
  });

  it('should filter by query', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        voices: [
          { voiceId: 'v1', name: 'tzurot-alice', slug: 'alice' },
          { voiceId: 'v2', name: 'tzurot-bob', slug: 'bob' },
        ],
        totalVoices: 10,
        tzurotCount: 2,
      },
    });

    await handleVoiceAutocomplete(createMockAutocomplete('ali'));

    expect(mockRespond).toHaveBeenCalledWith([{ name: 'alice', value: 'v1' }]);
  });

  it('should use cached voices on subsequent calls', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        voices: [{ voiceId: 'v1', name: 'tzurot-alice', slug: 'alice' }],
        totalVoices: 10,
        tzurotCount: 1,
      },
    });

    // First call populates cache
    await handleVoiceAutocomplete(createMockAutocomplete());
    // Second call should use cache (no additional API call)
    await handleVoiceAutocomplete(createMockAutocomplete('ali'));

    expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);
    expect(mockRespond).toHaveBeenCalledTimes(2);
  });

  it('should invalidate cache after successful delete', async () => {
    // Pre-populate cache via autocomplete
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        voices: [{ voiceId: 'voice-1', name: 'tzurot-alice', slug: 'alice' }],
        totalVoices: 10,
        tzurotCount: 1,
      },
    });
    await handleVoiceAutocomplete(createMockAutocomplete());
    expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);

    // Delete the voice — should invalidate cache
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { deleted: true, voiceId: 'voice-1', name: 'tzurot-alice', slug: 'alice' },
    });
    const mockEditReply = vi.fn();
    const mockContext = {
      interaction: { user: { id: 'user-123' , username: 'testuser' }, editReply: mockEditReply },
      user: { id: 'user-123' , username: 'testuser' },
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
      getRequiredOption: vi.fn().mockReturnValue('voice-1'),
      getSubcommand: vi.fn().mockReturnValue('delete'),
      getSubcommandGroup: vi.fn().mockReturnValue('voices'),
    } as unknown as DeferredCommandContext;
    await handleDeleteVoice(mockContext);

    // Autocomplete should re-fetch (cache was invalidated)
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { voices: [], totalVoices: 10, tzurotCount: 0 },
    });
    await handleVoiceAutocomplete(createMockAutocomplete());
    expect(mockCallGatewayApi).toHaveBeenCalledTimes(3);
  });

  it('should return empty on API error', async () => {
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 404, error: 'Not found' });

    await handleVoiceAutocomplete(createMockAutocomplete());

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should return empty on exception', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('timeout'));

    await handleVoiceAutocomplete(createMockAutocomplete());

    expect(mockRespond).toHaveBeenCalledWith([]);
  });
});
