/**
 * Tests for Admin Metrics Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMetrics } from './metrics.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { ChatInputCommandInteraction } from 'discord.js';

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
    interaction: {} as unknown as ChatInputCommandInteraction,
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
    getSubcommand: () => 'metrics',
    getSubcommandGroup: () => null,
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn(),
    deleteReply: vi.fn(),
  } as unknown as DeferredCommandContext;
}

interface EmbedField {
  name: string;
  value: string;
}

function fieldsFromCall(context: DeferredCommandContext): EmbedField[] {
  const call = vi.mocked(context.editReply).mock.calls[0][0] as {
    embeds: { data: { fields: EmbedField[] } }[];
  };
  return call.embeds[0].data.fields;
}

describe('handleMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the queue / cache / uptime fields when the gateway responds OK', async () => {
    mockAdminFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          queue: { waiting: 3, active: 1, completed: 4200, failed: 17, total: 4 },
          cache: { size: 256 },
          uptime: 7200_000, // 2h in ms
          timestamp: '2026-05-20T12:00:00.000Z',
        }),
    });

    const context = createMockContext();
    await handleMetrics(context);

    expect(mockAdminFetch).toHaveBeenCalledWith('/metrics');

    const fields = fieldsFromCall(context);

    const inFlight = fields.find(f => f.name === '📥 Queue (in flight)');
    expect(inFlight?.value).toContain('Waiting: **3**');
    expect(inFlight?.value).toContain('Active: **1**');
    expect(inFlight?.value).toContain('Total: **4**');

    const lifetime = fields.find(f => f.name === '📈 Queue (lifetime)');
    expect(lifetime?.value).toContain('Completed: **4200**');
    expect(lifetime?.value).toContain('Failed: **17**');

    const cache = fields.find(f => f.name === '💾 Dedup cache');
    expect(cache?.value).toBe('256 entries');

    // Uptime is rendered via formatDuration — exact text depends on the
    // helper's output, but for 2h in ms it should at minimum contain '2h'.
    const uptime = fields.find(f => f.name === '⏱️ Gateway uptime');
    expect(uptime?.value).toMatch(/2\s*h/);
  });

  it('attaches the snapshot timestamp as the embed footer', async () => {
    mockAdminFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          queue: { waiting: 0, active: 0, completed: 0, failed: 0, total: 0 },
          cache: { size: 0 },
          uptime: 0,
          timestamp: '2026-05-20T12:00:00.000Z',
        }),
    });

    const context = createMockContext();
    await handleMetrics(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { footer?: { text: string } } }[];
    };
    expect(call.embeds[0].data.footer?.text).toContain('2026-05-20T12:00:00.000Z');
  });

  it('renders a warning embed when the gateway responds with non-OK', async () => {
    mockAdminFetch.mockResolvedValue({
      ok: false,
      status: 503,
    });

    const context = createMockContext();
    await handleMetrics(context);

    const fields = fieldsFromCall(context);
    const errorField = fields.find(f => f.name === '📊 Gateway Metrics');
    expect(errorField?.value).toContain('503');
  });

  it('renders a warning embed when adminFetch throws (gateway unreachable)', async () => {
    mockAdminFetch.mockRejectedValue(new Error('Connection refused'));

    const context = createMockContext();
    await handleMetrics(context);

    const fields = fieldsFromCall(context);
    const errorField = fields.find(f => f.name === '📊 Gateway Metrics');
    expect(errorField?.value).toContain('unreachable');
  });
});
