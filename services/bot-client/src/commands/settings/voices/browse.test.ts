/**
 * Tests for Voice Browse Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';
import {
  handleBrowseVoices,
  handleVoiceBrowsePagination,
  isVoiceBrowseInteraction,
} from './browse.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import type { VoiceEntry } from './types.js';

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

/** Generate N voice entries for pagination tests */
function generateVoices(count: number): VoiceEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    voiceId: `v${i + 1}`,
    name: `tzurot-voice-${i + 1}`,
    slug: `voice-${i + 1}`,
  }));
}

describe('handleBrowseVoices', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(): DeferredCommandContext {
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
      getRequiredOption: vi.fn(),
      getSubcommand: vi.fn().mockReturnValue('browse'),
      getSubcommandGroup: vi.fn().mockReturnValue('voices'),
    } as unknown as DeferredCommandContext;
  }

  it('should list voices successfully with no pagination buttons for small lists', async () => {
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

    await handleBrowseVoices(createMockContext());

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/voices',
      expect.objectContaining({ user: { discordId: 'user-123', username: 'testuser', displayName: 'testuser' } })
    );
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '🎤 Cloned Voices',
            description: expect.stringContaining('alice'),
          }),
        }),
      ],
      components: [], // No pagination needed for 2 voices
    });
  });

  it('should show pagination buttons when voices exceed page size', async () => {
    const voices = generateVoices(12); // 12 voices = 2 pages at 10/page

    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        voices,
        totalVoices: 30,
        tzurotCount: 12,
      },
    });

    await handleBrowseVoices(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '🎤 Cloned Voices',
            // First page shows voices 1-10
            description: expect.stringContaining('voice-1'),
          }),
        }),
      ],
      components: [expect.any(Object)], // Pagination button row
    });

    // Verify first page only shows 10 voices
    const embedDescription = mockEditReply.mock.calls[0][0].embeds[0].data.description;
    expect(embedDescription).toContain('voice-10');
    expect(embedDescription).not.toContain('voice-11');
  });

  it('should show management hints on first page only', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        voices: [{ voiceId: 'v1', name: 'tzurot-alice', slug: 'alice' }],
        totalVoices: 5,
        tzurotCount: 1,
      },
    });

    await handleBrowseVoices(createMockContext());

    const embed = mockEditReply.mock.calls[0][0].embeds[0];
    expect(embed.data.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '💡 Management',
          value: expect.stringContaining('/settings voices delete'),
        }),
      ])
    );
  });

  it('should show empty state when no voices', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        voices: [],
        totalVoices: 5,
        tzurotCount: 0,
      },
    });

    await handleBrowseVoices(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining('No Tzurot-cloned voices'),
          }),
        }),
      ],
      components: [],
    });
  });

  it('should handle API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'ElevenLabs API key not found',
    });

    await handleBrowseVoices(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ ElevenLabs API key not found',
    });
  });

  it('should handle exceptions', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleBrowseVoices(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An unexpected error occurred. Please try again.',
    });
  });
});

describe('isVoiceBrowseInteraction', () => {
  it('should match voice browse pagination custom IDs', () => {
    expect(isVoiceBrowseInteraction('settings-voices::browse::0::all::')).toBe(true);
    expect(isVoiceBrowseInteraction('settings-voices::browse::1::all::')).toBe(true);
  });

  it('should not match unrelated custom IDs', () => {
    expect(isVoiceBrowseInteraction('character::browse::0::all::date::')).toBe(false);
    expect(
      isVoiceBrowseInteraction('settings::destructive::confirm_button::voice-clear::all')
    ).toBe(false);
    expect(isVoiceBrowseInteraction('user-defaults-settings::voice::edit')).toBe(false);
  });
});

describe('handleVoiceBrowsePagination', () => {
  const mockDeferUpdate = vi.fn();
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockButtonInteraction(customId: string): ButtonInteraction {
    return {
      customId,
      user: { id: 'user-123' , username: 'testuser' },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
    } as unknown as ButtonInteraction;
  }

  it('should navigate to requested page', async () => {
    const voices = generateVoices(12);

    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { voices, totalVoices: 30, tzurotCount: 12 },
    });

    // Click "next" to go to page 1
    await handleVoiceBrowsePagination(
      createMockButtonInteraction('settings-voices::browse::1::all::')
    );

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            // Page 2 should show voices 11-12
            description: expect.stringContaining('voice-11'),
          }),
        }),
      ],
      components: [expect.any(Object)],
    });

    // Page 2 should NOT show management hints
    const embed = mockEditReply.mock.calls[0][0].embeds[0];
    expect(embed.data.fields).toBeUndefined();
  });

  it('should ignore unparseable custom IDs', async () => {
    await handleVoiceBrowsePagination(createMockButtonInteraction('garbage-custom-id'));

    expect(mockDeferUpdate).not.toHaveBeenCalled();
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should handle API error during pagination', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'ElevenLabs key expired',
    });

    await handleVoiceBrowsePagination(
      createMockButtonInteraction('settings-voices::browse::1::all::')
    );

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ ElevenLabs key expired',
      embeds: [],
      components: [],
    });
  });

  it('should keep existing content on fetch exception', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleVoiceBrowsePagination(
      createMockButtonInteraction('settings-voices::browse::1::all::')
    );

    expect(mockDeferUpdate).toHaveBeenCalled();
    // Should NOT call editReply — keeps existing content visible
    expect(mockEditReply).not.toHaveBeenCalled();
  });
});
