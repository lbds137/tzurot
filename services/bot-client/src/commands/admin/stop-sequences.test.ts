/**
 * Tests for Admin Stop Sequences Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { GatewayResult, OwnerClient } from '@tzurot/common-types';
import { handleStopSequences } from './stop-sequences.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

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

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

interface StubClient {
  getStopSequencesStats: ReturnType<typeof vi.fn>;
}

function createStubClient(): StubClient {
  return { getStopSequencesStats: vi.fn() };
}

function asOwnerClient(stub: StubClient): OwnerClient {
  return stub as unknown as OwnerClient;
}

function ok<T>(data: T): GatewayResult<T> {
  return { ok: true, data };
}

function err(status: number, message = 'fail'): GatewayResult<never> {
  return { ok: false, error: message, status };
}

function createMockContext(): DeferredCommandContext {
  return {
    interaction: {
      createdTimestamp: Date.now(),
      user: { id: '123456789' },
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
  let stub: StubClient;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubClient();
    clientsForMock.mockReturnValue({ ownerClient: asOwnerClient(stub) });
  });

  it('should display stats embed with activations', async () => {
    stub.getStopSequencesStats.mockResolvedValue(
      ok({
        totalActivations: 42,
        bySequence: { '\nUser:': 30, '\nHuman:': 12 },
        byModel: { 'openai/gpt-4': 25, 'anthropic/claude-3': 17 },
        startedAt: new Date(Date.now() - 3600_000).toISOString(),
      })
    );

    const context = createMockContext();
    await handleStopSequences(context);

    expect(stub.getStopSequencesStats).toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '🛑 Stop Sequence Stats',
          }),
        }),
      ],
    });

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
    stub.getStopSequencesStats.mockResolvedValue(
      ok({
        totalActivations: 0,
        bySequence: {},
        byModel: {},
        startedAt: new Date().toISOString(),
      })
    );

    const context = createMockContext();
    await handleStopSequences(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { description: string } }[];
    };
    expect(call.embeds[0].data.description).toContain('No activations');
  });

  it('should truncate long lists with "...and N more"', async () => {
    const bySequence: Record<string, number> = {};
    for (let i = 0; i < 20; i++) {
      bySequence[`\nSeq${i}:`] = 20 - i;
    }

    stub.getStopSequencesStats.mockResolvedValue(
      ok({
        totalActivations: 210,
        bySequence,
        byModel: { 'gpt-4': 210 },
        startedAt: new Date(Date.now() - 3600_000).toISOString(),
      })
    );

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
    stub.getStopSequencesStats.mockResolvedValue(err(500, 'Internal Server Error'));

    const context = createMockContext();
    await handleStopSequences(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌'),
    });
  });

  it('should handle network failure', async () => {
    stub.getStopSequencesStats.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleStopSequences(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌'),
    });
  });
});
