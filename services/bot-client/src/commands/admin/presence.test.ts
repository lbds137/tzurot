/**
 * Tests for Admin Presence Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivityType } from 'discord.js';
import { handlePresence, restoreBotPresence } from './presence.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { ChatInputCommandInteraction, Client } from 'discord.js';

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

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisDel = vi.fn();
vi.mock('../../redis.js', () => ({
  redis: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  },
}));

function createMockContext(
  opts: {
    type?: number | null;
    text?: string | null;
  } = {}
): DeferredCommandContext {
  const mockSetActivity = vi.fn();
  const mockSetPresence = vi.fn();

  return {
    interaction: {
      createdTimestamp: Date.now(),
      client: {
        user: {
          setActivity: mockSetActivity,
          setPresence: mockSetPresence,
        },
      },
      options: {
        getInteger: (name: string) => {
          if (name === 'type') return opts.type ?? null;
          return null;
        },
        getString: (name: string) => {
          if (name === 'text') return opts.text ?? null;
          return null;
        },
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
    getSubcommand: () => 'presence',
    getSubcommandGroup: () => null,
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn(),
    deleteReply: vi.fn(),
  } as unknown as DeferredCommandContext;
}

describe('handlePresence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
  });

  it('should show current presence when no args', async () => {
    mockRedisGet.mockResolvedValue(
      JSON.stringify({ type: ActivityType.Playing, text: 'with fire' })
    );

    const context = createMockContext();
    await handlePresence(context);

    expect(mockRedisGet).toHaveBeenCalledWith('bot:presence');
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Playing'),
    });
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('with fire'),
    });
  });

  it('should show "no presence set" when Redis is empty', async () => {
    const context = createMockContext();
    await handlePresence(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('No custom presence'),
    });
  });

  it('should set presence with type and text', async () => {
    const context = createMockContext({ type: ActivityType.Watching, text: 'the world burn' });
    await handlePresence(context);

    expect(mockRedisSet).toHaveBeenCalledWith(
      'bot:presence',
      JSON.stringify({ type: ActivityType.Watching, text: 'the world burn' })
    );
    const client = context.interaction.client;
    expect(client.user?.setActivity).toHaveBeenCalledWith('the world burn', {
      type: ActivityType.Watching,
    });
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Watching'),
    });
  });

  it('should set Custom status with state field', async () => {
    const context = createMockContext({ type: ActivityType.Custom, text: 'feeling great' });
    await handlePresence(context);

    expect(mockRedisSet).toHaveBeenCalledWith(
      'bot:presence',
      JSON.stringify({ type: ActivityType.Custom, text: 'feeling great' })
    );
    const client = context.interaction.client;
    expect(client.user?.setPresence).toHaveBeenCalledWith({
      activities: [{ type: ActivityType.Custom, name: 'Custom Status', state: 'feeling great' }],
    });
    // Should NOT call setActivity for Custom type
    expect(client.user?.setActivity).not.toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Custom Status'),
    });
  });

  it('should require text when type is provided', async () => {
    const context = createMockContext({ type: ActivityType.Playing });
    await handlePresence(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Text is required'),
    });
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('should clear presence when type is None (99)', async () => {
    const context = createMockContext({ type: 99 });
    await handlePresence(context);

    expect(mockRedisDel).toHaveBeenCalledWith('bot:presence');
    const client = context.interaction.client;
    expect(client.user?.setPresence).toHaveBeenCalledWith({ activities: [] });
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('cleared'),
    });
  });
});

describe('restoreBotPresence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
  });

  it('should restore standard presence from Redis on startup', async () => {
    const mockSetActivity = vi.fn();
    const mockSetPresence = vi.fn();
    const client = {
      user: { setActivity: mockSetActivity, setPresence: mockSetPresence },
    } as unknown as Client;

    mockRedisGet.mockResolvedValue(JSON.stringify({ type: ActivityType.Listening, text: 'music' }));

    await restoreBotPresence(client);

    expect(mockSetActivity).toHaveBeenCalledWith('music', { type: ActivityType.Listening });
  });

  it('should restore Custom status from Redis on startup', async () => {
    const mockSetActivity = vi.fn();
    const mockSetPresence = vi.fn();
    const client = {
      user: { setActivity: mockSetActivity, setPresence: mockSetPresence },
    } as unknown as Client;

    mockRedisGet.mockResolvedValue(JSON.stringify({ type: ActivityType.Custom, text: 'vibing' }));

    await restoreBotPresence(client);

    expect(mockSetPresence).toHaveBeenCalledWith({
      activities: [{ type: ActivityType.Custom, name: 'Custom Status', state: 'vibing' }],
    });
    expect(mockSetActivity).not.toHaveBeenCalled();
  });

  it('should do nothing when no presence is stored', async () => {
    const mockSetActivity = vi.fn();
    const client = {
      user: { setActivity: mockSetActivity, setPresence: vi.fn() },
    } as unknown as Client;

    await restoreBotPresence(client);

    expect(mockSetActivity).not.toHaveBeenCalled();
  });

  it('should handle malformed JSON in Redis gracefully', async () => {
    const mockSetActivity = vi.fn();
    const client = {
      user: { setActivity: mockSetActivity, setPresence: vi.fn() },
    } as unknown as Client;

    mockRedisGet.mockResolvedValue('not valid json{{{');

    await restoreBotPresence(client);

    expect(mockSetActivity).not.toHaveBeenCalled();
  });

  it('should handle invalid shape in Redis gracefully', async () => {
    const mockSetActivity = vi.fn();
    const client = {
      user: { setActivity: mockSetActivity, setPresence: vi.fn() },
    } as unknown as Client;

    mockRedisGet.mockResolvedValue(JSON.stringify({ wrong: 'shape' }));

    await restoreBotPresence(client);

    expect(mockSetActivity).not.toHaveBeenCalled();
  });
});
