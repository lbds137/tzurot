/**
 * Tests for Admin Ping Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePing } from './ping.js';
import type { ChatInputCommandInteraction } from 'discord.js';

describe('handlePing', () => {
  let mockInteraction: ChatInputCommandInteraction;

  beforeEach(() => {
    vi.clearAllMocks();

    mockInteraction = {
      createdTimestamp: Date.now() - 50, // Simulate 50ms ago
      client: {
        ws: {
          ping: 42,
        },
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;
  });

  it('should defer reply first', async () => {
    await handlePing(mockInteraction);

    expect(mockInteraction.deferReply).toHaveBeenCalled();
  });

  it('should show response and websocket latency', async () => {
    await handlePing(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining('Pong!'));
    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Response latency')
    );
    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('WebSocket latency: 42ms')
    );
  });
});
