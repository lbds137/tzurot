/**
 * Tests for Admin Ping Subcommand
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePing } from './ping.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { ChatInputCommandInteraction } from 'discord.js';

describe('handlePing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Create a mock DeferredCommandContext for testing.
   */
  function createMockContext(): DeferredCommandContext {
    const mockEditReply = vi.fn().mockResolvedValue(undefined);

    return {
      interaction: {
        createdTimestamp: Date.now() - 50, // Simulate 50ms ago
        client: {
          ws: {
            ping: 42,
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
      getSubcommand: () => 'ping',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  }

  it('should show response and websocket latency', async () => {
    const context = createMockContext();
    await handlePing(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('Pong!'));
    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('Response latency'));
    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('WebSocket latency: 42ms')
    );
  });
});
