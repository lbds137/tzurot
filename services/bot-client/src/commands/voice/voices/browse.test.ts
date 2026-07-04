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
  listVoices: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

/** Generate N voice entries for pagination tests */
function generateVoices(count: number): VoiceEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    provider: i % 2 === 0 ? 'elevenlabs' : 'mistral',
    voiceId: `v${i + 1}`,
    name: `tzurot-voice-${i + 1}`,
    slug: `voice-${i + 1}`,
  }));
}

describe('handleBrowseVoices', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stub.listVoices.mockReset();
  });

  function createMockContext(): DeferredCommandContext {
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
      getRequiredOption: vi.fn(),
      getSubcommand: vi.fn().mockReturnValue('browse'),
      getSubcommandGroup: vi.fn().mockReturnValue('voices'),
    } as unknown as DeferredCommandContext;
  }

  it('should list voices successfully with no pagination buttons for small lists', async () => {
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

    await handleBrowseVoices(createMockContext());

    expect(stub.listVoices).toHaveBeenCalled();
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

    stub.listVoices.mockResolvedValue(
      makeOk({
        voices,
        totalVoices: 30,
        tzurotCount: 12,
      })
    );

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
    stub.listVoices.mockResolvedValue(
      makeOk({
        voices: [{ provider: 'elevenlabs', voiceId: 'v1', name: 'tzurot-alice', slug: 'alice' }],
        totalVoices: 5,
        tzurotCount: 1,
      })
    );

    await handleBrowseVoices(createMockContext());

    const embed = mockEditReply.mock.calls[0][0].embeds[0];
    expect(embed.data.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '💡 Management',
          value: expect.stringContaining('/voice voices delete'),
        }),
      ])
    );
  });

  it('should show empty state when no voices', async () => {
    stub.listVoices.mockResolvedValue(
      makeOk({
        voices: [],
        totalVoices: 5,
        tzurotCount: 0,
      })
    );

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

  it('should render warnings field above voices when gateway surfaces provider failures', async () => {
    stub.listVoices.mockResolvedValue(
      makeOk({
        voices: generateVoices(2),
        totalVoices: 2,
        tzurotCount: 2,
        warnings: [{ provider: 'mistral', message: 'API key invalid or expired' }],
      })
    );

    await handleBrowseVoices(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              fields: expect.arrayContaining([
                expect.objectContaining({
                  name: expect.stringContaining("Some providers couldn't be loaded"),
                  value: expect.stringContaining('Mistral'),
                }),
              ]),
            }),
          }),
        ],
      })
    );
  });

  it('uses correct display name for elevenlabs warnings (regression for ternary mislabeling)', async () => {
    stub.listVoices.mockResolvedValue(
      makeOk({
        voices: generateVoices(2),
        totalVoices: 2,
        tzurotCount: 2,
        warnings: [{ provider: 'elevenlabs', message: 'Provider temporarily unavailable' }],
      })
    );

    await handleBrowseVoices(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              fields: expect.arrayContaining([
                expect.objectContaining({
                  value: expect.stringContaining('ElevenLabs'),
                }),
              ]),
            }),
          }),
        ],
      })
    );
  });

  it('should handle API error', async () => {
    stub.listVoices.mockResolvedValue(makeErr(404, 'ElevenLabs API key not found'));

    await handleBrowseVoices(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ ElevenLabs API key not found',
    });
  });

  it('should handle exceptions', async () => {
    stub.listVoices.mockRejectedValue(new Error('Network error'));

    await handleBrowseVoices(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An unexpected error occurred. Please try again.',
    });
  });
});

describe('isVoiceBrowseInteraction', () => {
  it('should match voice browse pagination custom IDs', () => {
    expect(isVoiceBrowseInteraction('voice-voices::browse::0::all::')).toBe(true);
    expect(isVoiceBrowseInteraction('voice-voices::browse::1::all::')).toBe(true);
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
    stub.listVoices.mockReset();
  });

  function createMockButtonInteraction(customId: string): ButtonInteraction {
    return {
      customId,
      user: { id: 'user-123', username: 'testuser' },
      deferUpdate: mockDeferUpdate,
      editReply: mockEditReply,
    } as unknown as ButtonInteraction;
  }

  it('should navigate to requested page', async () => {
    const voices = generateVoices(12);

    stub.listVoices.mockResolvedValue(makeOk({ voices, totalVoices: 30, tzurotCount: 12 }));

    // Click "next" to go to page 1
    await handleVoiceBrowsePagination(
      createMockButtonInteraction('voice-voices::browse::1::all::')
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
    expect(stub.listVoices).not.toHaveBeenCalled();
  });

  it('should handle API error during pagination', async () => {
    stub.listVoices.mockResolvedValue(makeErr(500, 'ElevenLabs key expired'));

    await handleVoiceBrowsePagination(
      createMockButtonInteraction('voice-voices::browse::1::all::')
    );

    expect(mockDeferUpdate).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ ElevenLabs key expired',
      embeds: [],
      components: [],
    });
  });

  it('should keep existing content on fetch exception', async () => {
    stub.listVoices.mockRejectedValue(new Error('Network error'));

    await handleVoiceBrowsePagination(
      createMockButtonInteraction('voice-voices::browse::1::all::')
    );

    expect(mockDeferUpdate).toHaveBeenCalled();
    // Should NOT call editReply — keeps existing content visible
    expect(mockEditReply).not.toHaveBeenCalled();
  });
});
