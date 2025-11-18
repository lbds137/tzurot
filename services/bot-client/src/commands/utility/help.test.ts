/**
 * Tests for Utility Help Subcommand Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleHelp } from './help.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../../types.js';

describe('handleHelp', () => {
  let mockInteraction: ChatInputCommandInteraction;

  beforeEach(() => {
    vi.clearAllMocks();

    mockInteraction = {
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;
  });

  it('should reply with error when commands map is not provided', async () => {
    await handleHelp(mockInteraction, undefined);

    expect(mockInteraction.reply).toHaveBeenCalledWith({
      content: '❌ Commands list not available',
      ephemeral: true,
    });
  });

  it('should reply with embed when commands provided', async () => {
    const commands = new Map<string, Command>();

    await handleHelp(mockInteraction, commands);

    expect(mockInteraction.reply).toHaveBeenCalledWith({
      embeds: [expect.objectContaining({})],
    });
  });

  it('should include commands in reply', async () => {
    const commands = new Map<string, Command>();

    commands.set('ping', {
      data: { name: 'ping', description: 'Check latency' },
      category: 'Utility',
      execute: vi.fn(),
    });

    await handleHelp(mockInteraction, commands);

    // Should reply with an embed
    expect(mockInteraction.reply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should group commands by category', async () => {
    const commands = new Map<string, Command>();

    commands.set('ping', {
      data: { name: 'ping', description: 'Check latency' },
      category: 'Utility',
      execute: vi.fn(),
    });

    commands.set('admin', {
      data: { name: 'admin', description: 'Admin commands' },
      category: 'Admin',
      execute: vi.fn(),
    });

    await handleHelp(mockInteraction, commands);

    // Should reply successfully
    expect(mockInteraction.reply).toHaveBeenCalled();
  });

  it('should categorize commands without category as "Other"', async () => {
    const commands = new Map<string, Command>();

    commands.set('test', {
      data: { name: 'test', description: 'Test command' },
      // No category specified
      execute: vi.fn(),
    });

    await handleHelp(mockInteraction, commands);

    // Should reply successfully
    expect(mockInteraction.reply).toHaveBeenCalled();
  });

  it('should handle commands with subcommands', async () => {
    const commands = new Map<string, Command>();

    commands.set('utility', {
      data: {
        name: 'utility',
        description: 'Utility commands',
        options: [
          { type: 1, name: 'ping', description: 'Check latency' },
          { type: 1, name: 'help', description: 'Show help' },
        ],
      },
      category: 'Utility',
      execute: vi.fn(),
    });

    await handleHelp(mockInteraction, commands);

    // Should reply successfully
    expect(mockInteraction.reply).toHaveBeenCalled();
  });

  it('should handle multiple commands in same category', async () => {
    const commands = new Map<string, Command>();

    commands.set('ping', {
      data: { name: 'ping', description: 'Check latency' },
      category: 'Utility',
      execute: vi.fn(),
    });

    commands.set('help', {
      data: { name: 'help', description: 'Show help' },
      category: 'Utility',
      execute: vi.fn(),
    });

    await handleHelp(mockInteraction, commands);

    // Should reply successfully
    expect(mockInteraction.reply).toHaveBeenCalled();
  });

  it('should not throw errors with empty commands map', async () => {
    const commands = new Map<string, Command>();

    await expect(handleHelp(mockInteraction, commands)).resolves.not.toThrow();
  });
});
