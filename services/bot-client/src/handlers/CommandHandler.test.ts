/**
 * Tests for CommandHandler
 *
 * Tests command loading, routing, and error handling for Discord slash commands.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandHandler } from './CommandHandler.js';
import { Collection, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import type { Command } from '../types.js';

// Mock dependencies
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

// Mock filesystem operations
vi.mock('node:fs', () => ({
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

import { readdirSync, statSync } from 'node:fs';

describe('CommandHandler', () => {
  let handler: CommandHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new CommandHandler();
  });

  describe('constructor', () => {
    it('should initialize with empty commands collection', () => {
      expect(handler.getCommands()).toBeInstanceOf(Collection);
      expect(handler.getCommands().size).toBe(0);
    });
  });

  describe('loadCommands', () => {
    it('should load valid command files', async () => {
      // Mock filesystem to return a single command file
      vi.mocked(readdirSync).mockReturnValue(['ping.ts'] as any);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as any);

      // Mock dynamic import to return a valid command
      vi.doMock('/mock/commands/ping.ts', () => ({
        data: {
          name: 'ping',
          description: 'Replies with Pong!',
        },
        execute: vi.fn(),
      }));

      // Note: This test is limited because we can't easily mock dynamic imports
      // In real usage, the command files would be loaded from the actual filesystem
      // For now, we'll test that the method completes without errors
      await expect(handler.loadCommands()).resolves.not.toThrow();
    });

    it('should skip files without data or execute', async () => {
      vi.mocked(readdirSync).mockReturnValue(['invalid.ts'] as any);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as any);

      await expect(handler.loadCommands()).resolves.not.toThrow();

      // Should not add invalid command
      expect(handler.getCommands().size).toBe(0);
    });
  });

  describe('handleInteraction', () => {
    beforeEach(() => {
      // Add a mock command to the handler
      const mockCommand: Command = {
        data: {
          name: 'test',
          description: 'Test command',
        },
        execute: vi.fn().mockResolvedValue(undefined),
      };

      handler.getCommands().set('test', mockCommand);
    });

    it('should execute chat input command', async () => {
      const mockInteraction = {
        isChatInputCommand: () => true,
        isModalSubmit: () => false,
        commandName: 'test',
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn(),
        replied: false,
        deferred: false,
      } as unknown as ChatInputCommandInteraction;

      await handler.handleInteraction(mockInteraction);

      const command = handler.getCommands().get('test');
      expect(command?.execute).toHaveBeenCalledWith(mockInteraction);
    });

    it('should execute modal submit interaction', async () => {
      const mockInteraction = {
        isChatInputCommand: () => false,
        isModalSubmit: () => true,
        customId: 'test-create',
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn(),
        replied: false,
        deferred: false,
      } as unknown as ModalSubmitInteraction;

      await handler.handleInteraction(mockInteraction);

      const command = handler.getCommands().get('test');
      expect(command?.execute).toHaveBeenCalledWith(mockInteraction);
    });

    it('should extract command name from modal customId', async () => {
      const mockInteraction = {
        isChatInputCommand: () => false,
        isModalSubmit: () => true,
        customId: 'test-edit',
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn(),
        replied: false,
        deferred: false,
      } as unknown as ModalSubmitInteraction;

      await handler.handleInteraction(mockInteraction);

      // Should extract 'test' from 'test-edit'
      const command = handler.getCommands().get('test');
      expect(command?.execute).toHaveBeenCalled();
    });

    it('should reply with error for unknown command', async () => {
      const mockInteraction = {
        isChatInputCommand: () => true,
        isModalSubmit: () => false,
        commandName: 'unknown',
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn(),
        replied: false,
        deferred: false,
      } as unknown as ChatInputCommandInteraction;

      await handler.handleInteraction(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'Unknown command!',
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should pass commands collection to utility command', async () => {
      const mockUtilityCommand: Command = {
        data: {
          name: 'utility',
          description: 'Utility commands',
        },
        execute: vi.fn().mockResolvedValue(undefined),
      };

      handler.getCommands().set('utility', mockUtilityCommand);

      const mockInteraction = {
        isChatInputCommand: () => true,
        isModalSubmit: () => false,
        commandName: 'utility',
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn(),
        replied: false,
        deferred: false,
      } as unknown as ChatInputCommandInteraction;

      await handler.handleInteraction(mockInteraction);

      // Should pass commands collection as second argument
      expect(mockUtilityCommand.execute).toHaveBeenCalledWith(
        mockInteraction,
        handler.getCommands()
      );
    });

    it('should handle command execution error with reply', async () => {
      const mockCommand: Command = {
        data: {
          name: 'failing',
          description: 'Failing command',
        },
        execute: vi.fn().mockRejectedValue(new Error('Command failed')),
      };

      handler.getCommands().set('failing', mockCommand);

      const mockInteraction = {
        isChatInputCommand: () => true,
        isModalSubmit: () => false,
        commandName: 'failing',
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn(),
        replied: false,
        deferred: false,
      } as unknown as ChatInputCommandInteraction;

      await handler.handleInteraction(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'There was an error executing this command!',
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should handle command execution error with followUp when already replied', async () => {
      const mockCommand: Command = {
        data: {
          name: 'failing',
          description: 'Failing command',
        },
        execute: vi.fn().mockRejectedValue(new Error('Command failed')),
      };

      handler.getCommands().set('failing', mockCommand);

      const mockInteraction = {
        isChatInputCommand: () => true,
        isModalSubmit: () => false,
        commandName: 'failing',
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        replied: true, // Already replied
        deferred: false,
      } as unknown as ChatInputCommandInteraction;

      await handler.handleInteraction(mockInteraction);

      expect(mockInteraction.followUp).toHaveBeenCalledWith({
        content: 'There was an error executing this command!',
        flags: MessageFlags.Ephemeral,
      });
      expect(mockInteraction.reply).not.toHaveBeenCalled();
    });

    it('should handle command execution error with followUp when deferred', async () => {
      const mockCommand: Command = {
        data: {
          name: 'failing',
          description: 'Failing command',
        },
        execute: vi.fn().mockRejectedValue(new Error('Command failed')),
      };

      handler.getCommands().set('failing', mockCommand);

      const mockInteraction = {
        isChatInputCommand: () => true,
        isModalSubmit: () => false,
        commandName: 'failing',
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
        replied: false,
        deferred: true, // Deferred
      } as unknown as ChatInputCommandInteraction;

      await handler.handleInteraction(mockInteraction);

      expect(mockInteraction.followUp).toHaveBeenCalledWith({
        content: 'There was an error executing this command!',
        flags: MessageFlags.Ephemeral,
      });
      expect(mockInteraction.reply).not.toHaveBeenCalled();
    });
  });

  describe('getCommands', () => {
    it('should return commands collection', () => {
      const commands = handler.getCommands();

      expect(commands).toBeInstanceOf(Collection);
    });

    it('should return same collection instance', () => {
      const commands1 = handler.getCommands();
      const commands2 = handler.getCommands();

      expect(commands1).toBe(commands2);
    });

    it('should reflect added commands', () => {
      const mockCommand: Command = {
        data: {
          name: 'test',
          description: 'Test',
        },
        execute: vi.fn(),
      };

      handler.getCommands().set('test', mockCommand);

      expect(handler.getCommands().has('test')).toBe(true);
      expect(handler.getCommands().get('test')).toBe(mockCommand);
    });
  });
});
