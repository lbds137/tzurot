/**
 * Tests for Utility Ping Subcommand Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePing } from './ping.js';
import type { ChatInputCommandInteraction } from 'discord.js';

describe('handlePing', () => {
  let mockInteraction: ChatInputCommandInteraction;
  const mockDate = new Date('2025-11-17T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);

    // Mock interaction with createdTimestamp 100ms ago
    mockInteraction = {
      createdTimestamp: mockDate.getTime() - 100,
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should defer reply and respond with latency', async () => {
    await handlePing(mockInteraction);

    expect(mockInteraction.deferReply).toHaveBeenCalledOnce();
    expect(mockInteraction.editReply).toHaveBeenCalledWith('Pong! Latency: 100ms');
  });

  it('should calculate correct latency', async () => {
    // Create interaction 250ms ago
    mockInteraction.createdTimestamp = mockDate.getTime() - 250;

    await handlePing(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith('Pong! Latency: 250ms');
  });

  it('should handle zero latency', async () => {
    // Create interaction at current time
    mockInteraction.createdTimestamp = mockDate.getTime();

    await handlePing(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith('Pong! Latency: 0ms');
  });

  it('should call deferReply before editReply', async () => {
    const callOrder: string[] = [];

    mockInteraction.deferReply = vi.fn().mockImplementation(async () => {
      callOrder.push('defer');
    });

    mockInteraction.editReply = vi.fn().mockImplementation(async () => {
      callOrder.push('edit');
    });

    await handlePing(mockInteraction);

    expect(callOrder).toEqual(['defer', 'edit']);
  });
});
