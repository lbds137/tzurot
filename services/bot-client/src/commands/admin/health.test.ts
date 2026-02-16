/**
 * Tests for Admin Health Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleHealth } from './health.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { ChatInputCommandInteraction, Collection, Guild } from 'discord.js';

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

function createMockGuildsCache(): Collection<string, Guild> {
  const guilds = [{ memberCount: 500 }, { memberCount: 347 }] as Guild[];

  return {
    size: 2,
    reduce: (fn: (acc: number, g: Guild) => number, init: number) => guilds.reduce(fn, init),
  } as unknown as Collection<string, Guild>;
}

function createMockContext(): DeferredCommandContext {
  return {
    interaction: {
      createdTimestamp: Date.now(),
      client: {
        ws: { ping: 42 },
        guilds: { cache: createMockGuildsCache() },
        uptime: 3600_000,
      },
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
    getSubcommand: () => 'health',
    getSubcommandGroup: () => null,
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn(),
    deleteReply: vi.fn(),
  } as unknown as DeferredCommandContext;
}

describe('handleHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display full health embed when gateway is healthy', async () => {
    mockAdminFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'healthy',
          services: { redis: true, queue: true, avatarStorage: true },
          avatars: { status: 'ok', count: 156 },
          timestamp: new Date().toISOString(),
          uptime: 86400_000,
        }),
    });

    const context = createMockContext();
    await handleHealth(context);

    expect(mockAdminFetch).toHaveBeenCalledWith('/health');
    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '🏥 Bot Health Status',
          }),
        }),
      ],
    });

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { fields: { name: string; value: string }[] } }[];
    };
    const fields = call.embeds[0].data.fields;

    const discordField = fields.find((f: { name: string }) => f.name === '📡 Discord');
    expect(discordField?.value).toContain('42ms');

    const gatewayField = fields.find((f: { name: string }) => f.name === '🗄️ Gateway');
    expect(gatewayField?.value).toContain('healthy');

    const servicesField = fields.find((f: { name: string }) => f.name === '🔌 Services');
    expect(servicesField?.value).toContain('Redis');
    expect(servicesField?.value).toContain('156 cached');

    const statsField = fields.find((f: { name: string }) => f.name === '📊 Stats');
    expect(statsField?.value).toContain('Guilds: 2');
    expect(statsField?.value).toContain('~847');
  });

  it('should show warning when gateway is unreachable', async () => {
    mockAdminFetch.mockRejectedValue(new Error('Connection refused'));

    const context = createMockContext();
    await handleHealth(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { fields: { name: string; value: string }[] } }[];
    };
    const fields = call.embeds[0].data.fields;

    // Discord section should still be present
    const discordField = fields.find((f: { name: string }) => f.name === '📡 Discord');
    expect(discordField).toBeDefined();

    // Gateway should show unreachable
    const gatewayField = fields.find((f: { name: string }) => f.name === '🗄️ Gateway');
    expect(gatewayField?.value).toContain('Unreachable');
  });

  it('should handle non-OK gateway response', async () => {
    mockAdminFetch.mockResolvedValue({
      ok: false,
      status: 503,
    });

    const context = createMockContext();
    await handleHealth(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { fields: { name: string; value: string }[] } }[];
    };
    const fields = call.embeds[0].data.fields;

    const gatewayField = fields.find((f: { name: string }) => f.name === '🗄️ Gateway');
    expect(gatewayField?.value).toContain('503');
  });
});
