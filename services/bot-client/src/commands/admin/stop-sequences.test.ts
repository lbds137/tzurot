/**
 * Tests for Admin Stop Sequences Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleStopSequences } from './stop-sequences.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { ChatInputCommandInteraction } from 'discord.js';

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

const mockAdminFetch = vi.fn();
vi.mock('../../utils/adminApiClient.js', () => ({
  adminFetch: (...args: unknown[]) => mockAdminFetch(...args),
}));

function createMockContext(): DeferredCommandContext {
  return {
    interaction: {
      createdTimestamp: Date.now(),
      client: { ws: { ping: 42 } },
    } as unknown as ChatInputCommandInteraction,
    user: { id: '123456789' },
    guild: null,
    member: null,
    channel: null,
    channelId: 'channel-123',
    guildId: null,
    commandName: 'admin',
    isEphemeral: true,
    getOption: vi.fn(),
    getRequiredOption: vi.fn(),
    getSubcommand: () => 'stop-sequences',
    getSubcommandGroup: () => null,
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn(),
    deleteReply: vi.fn(),
  } as unknown as DeferredCommandContext;
}

describe('handleStopSequences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display stats embed with activations', async () => {
    mockAdminFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          totalActivations: 42,
          bySequence: { '\nUser:': 30, '\nHuman:': 12 },
          byModel: { 'openai/gpt-4': 25, 'anthropic/claude-3': 17 },
          startedAt: new Date(Date.now() - 3600_000).toISOString(),
        }),
    });

    const context = createMockContext();
    await handleStopSequences(context);

    expect(mockAdminFetch).toHaveBeenCalledWith('/admin/stop-sequences');
    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '🛑 Stop Sequence Stats',
          }),
        }),
      ],
    });

    // Check embed fields contain the data
    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { description: string; fields: { name: string; value: string }[] } }[];
    };
    const embed = call.embeds[0].data;
    expect(embed.description).toContain('42');

    const seqField = embed.fields.find((f: { name: string }) => f.name === 'By Sequence');
    expect(seqField?.value).toContain('\\nUser:');
    expect(seqField?.value).toContain('30');

    const modelField = embed.fields.find((f: { name: string }) => f.name === 'By Model');
    expect(modelField?.value).toContain('gpt-4');
    expect(modelField?.value).not.toContain('openai/');
  });

  it('should handle zero activations', async () => {
    mockAdminFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          totalActivations: 0,
          bySequence: {},
          byModel: {},
          startedAt: new Date().toISOString(),
        }),
    });

    const context = createMockContext();
    await handleStopSequences(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { description: string } }[];
    };
    expect(call.embeds[0].data.description).toContain('No activations');
  });

  it('should truncate long lists with "...and N more"', async () => {
    // Build 20 sequences to exceed the 15-entry limit
    const bySequence: Record<string, number> = {};
    for (let i = 0; i < 20; i++) {
      bySequence[`\nSeq${i}:`] = 20 - i;
    }

    mockAdminFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          totalActivations: 210,
          bySequence,
          byModel: { 'gpt-4': 210 },
          startedAt: new Date(Date.now() - 3600_000).toISOString(),
        }),
    });

    const context = createMockContext();
    await handleStopSequences(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { fields: { name: string; value: string }[] } }[];
    };
    const seqField = call.embeds[0].data.fields.find(
      (f: { name: string }) => f.name === 'By Sequence'
    );
    expect(seqField?.value).toContain('...and 5 more');
  });

  it('should handle gateway error', async () => {
    mockAdminFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    const context = createMockContext();
    await handleStopSequences(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌'),
    });
  });

  it('should handle fetch failure', async () => {
    mockAdminFetch.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleStopSequences(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌'),
    });
  });
});
