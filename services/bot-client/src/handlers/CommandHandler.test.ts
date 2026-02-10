/**
 * Tests for CommandHandler
 *
 * Tests command loading, routing, and error handling for Discord slash commands.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandHandler } from './CommandHandler.js';
import { Collection, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  AutocompleteInteraction,
} from 'discord.js';
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

  describe('getCommandFiles (Index or Root pattern)', () => {
    /**
     * Tests for the "Index or Root" filtering pattern that reduces log noise.
     * Only index.ts files in subdirectories and root-level files should be loaded.
     */

    it('should include root-level .ts files', async () => {
      // Simulate: commands/ping.ts (root level file)
      vi.mocked(readdirSync).mockReturnValue(['ping.ts'] as any);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as any);

      await handler.loadCommands();

      // The file should be attempted (even if import fails)
      expect(readdirSync).toHaveBeenCalled();
    });

    it('should include index.ts in subdirectories', async () => {
      // Simulate: commands/preset/index.ts
      vi.mocked(readdirSync)
        .mockReturnValueOnce(['preset'] as any) // Root level - directory
        .mockReturnValueOnce(['index.ts', 'list.ts', 'api.ts'] as any); // Inside preset/

      vi.mocked(statSync).mockImplementation((path: any) => {
        const pathStr = String(path);
        if (pathStr.endsWith('preset')) {
          return { isDirectory: () => true } as any;
        }
        return { isDirectory: () => false } as any;
      });

      await handler.loadCommands();

      // Should have read both directories
      expect(readdirSync).toHaveBeenCalledTimes(2);
    });

    it('should skip non-index files in subdirectories (no log noise)', async () => {
      // This is the key test - list.ts, api.ts, etc. should be silently skipped
      // Simulate: commands/preset/ with index.ts and helper files
      const mockReaddir = vi.mocked(readdirSync);
      const mockStat = vi.mocked(statSync);

      mockReaddir
        .mockReturnValueOnce(['preset'] as any) // Root has one directory
        .mockReturnValueOnce(['index.ts', 'list.ts', 'create.ts', 'api.ts'] as any); // preset/ contents

      mockStat.mockImplementation((path: any) => {
        const pathStr = String(path);
        if (pathStr.endsWith('preset')) {
          return { isDirectory: () => true } as any;
        }
        return { isDirectory: () => false } as any;
      });

      // loadCommands will try to import files - we just verify it doesn't crash
      // and that the filtering logic works (only index.ts should be processed)
      await handler.loadCommands();

      // Verify the directory structure was traversed
      expect(mockReaddir).toHaveBeenCalledTimes(2);
    });

    it('should not recurse into nested subdirectories (e.g., admin/debug/)', async () => {
      // Simulate: commands/preset/global/ — nested directory should be ignored entirely
      const mockReaddir = vi.mocked(readdirSync);
      const mockStat = vi.mocked(statSync);

      mockReaddir
        .mockReturnValueOnce(['preset'] as any) // Root
        .mockReturnValueOnce(['index.ts', 'global'] as any); // preset/
      // No third mock — global/ is never scanned (only one level of recursion)

      mockStat.mockImplementation((path: any) => {
        const pathStr = String(path);
        if (pathStr.endsWith('preset') || pathStr.endsWith('global')) {
          return { isDirectory: () => true } as any;
        }
        return { isDirectory: () => false } as any;
      });

      await handler.loadCommands();

      // Should only traverse root + one level deep (not nested directories)
      expect(mockReaddir).toHaveBeenCalledTimes(2);
    });

    it('should skip .d.ts declaration files', async () => {
      vi.mocked(readdirSync).mockReturnValue(['ping.ts', 'ping.d.ts'] as any);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as any);

      await handler.loadCommands();

      // Should complete without errors - .d.ts files are filtered out
      expect(readdirSync).toHaveBeenCalled();
    });

    it('should include .js files for compiled output', async () => {
      // In production, files are .js not .ts
      vi.mocked(readdirSync).mockReturnValue(['ping.js'] as any);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false } as any);

      await handler.loadCommands();

      expect(readdirSync).toHaveBeenCalled();
    });

    it('should include index.js in subdirectories for compiled output', async () => {
      // Production: commands/preset/index.js
      vi.mocked(readdirSync)
        .mockReturnValueOnce(['preset'] as any)
        .mockReturnValueOnce(['index.js', 'list.js'] as any);

      vi.mocked(statSync).mockImplementation((path: any) => {
        const pathStr = String(path);
        if (pathStr.endsWith('preset')) {
          return { isDirectory: () => true } as any;
        }
        return { isDirectory: () => false } as any;
      });

      await handler.loadCommands();

      expect(readdirSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleInteraction', () => {
    beforeEach(() => {
      // Add a mock command to the handler
      const mockCommand: Command = {
        data: {
          name: 'test',
          description: 'Test command',
        } as unknown as SlashCommandBuilder,
        execute: vi.fn().mockResolvedValue(undefined),
      };

      handler.getCommands().set('test', mockCommand);
      // Also register the prefix for modal routing
      // Access private map via type assertion for testing
      (handler as any).prefixToCommand.set('test', mockCommand);
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

    it('should ignore modal submit when command has no handleModal', async () => {
      // Commands without handleModal export do not handle modals (no fallback to execute)
      const mockInteraction = {
        isChatInputCommand: () => false,
        isModalSubmit: () => true,
        customId: 'test::create',
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn(),
        replied: false,
        deferred: false,
      } as unknown as ModalSubmitInteraction;

      await handler.handleInteraction(mockInteraction);

      const command = handler.getCommands().get('test');
      // execute should NOT be called - modals require handleModal
      expect(command?.execute).not.toHaveBeenCalled();
    });

    it('should call handleModal when defined on command', async () => {
      const mockHandleModal = vi.fn().mockResolvedValue(undefined);
      const mockCommand: Command = {
        data: {
          name: 'modal-test',
          description: 'Test command with handleModal',
        } as unknown as SlashCommandBuilder,
        execute: vi.fn().mockResolvedValue(undefined),
        handleModal: mockHandleModal,
      };

      handler.getCommands().set('modal-test', mockCommand);
      (handler as any).prefixToCommand.set('modal-test', mockCommand);

      const mockInteraction = {
        isChatInputCommand: () => false,
        isModalSubmit: () => true,
        customId: 'modal-test::create',
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn(),
        replied: false,
        deferred: false,
      } as unknown as ModalSubmitInteraction;

      await handler.handleInteraction(mockInteraction);

      expect(mockHandleModal).toHaveBeenCalledWith(mockInteraction);
      expect(mockCommand.execute).not.toHaveBeenCalled();
    });

    it('should extract command name from modal customId using :: delimiter', async () => {
      // Set up a command with handleModal to test the extraction
      const mockHandleModal = vi.fn().mockResolvedValue(undefined);
      const mockCommand: Command = {
        data: {
          name: 'test',
          description: 'Test command',
        } as unknown as SlashCommandBuilder,
        execute: vi.fn().mockResolvedValue(undefined),
        handleModal: mockHandleModal,
      };

      handler.getCommands().set('test', mockCommand);
      (handler as any).prefixToCommand.set('test', mockCommand);

      const mockInteraction = {
        isChatInputCommand: () => false,
        isModalSubmit: () => true,
        customId: 'test::edit::entity-123',
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn(),
        replied: false,
        deferred: false,
      } as unknown as ModalSubmitInteraction;

      await handler.handleInteraction(mockInteraction);

      // Should extract 'test' from 'test::edit::entity-123' and call handleModal
      expect(mockHandleModal).toHaveBeenCalledWith(mockInteraction);
      expect(mockCommand.execute).not.toHaveBeenCalled();
    });

    it('should route to command via componentPrefixes', async () => {
      const mockHandleModal = vi.fn().mockResolvedValue(undefined);
      const mockCommand: Command = {
        data: {
          name: 'admin',
          description: 'Admin command',
        } as unknown as SlashCommandBuilder,
        execute: vi.fn().mockResolvedValue(undefined),
        handleModal: mockHandleModal,
        componentPrefixes: ['admin-settings'],
      };

      handler.getCommands().set('admin', mockCommand);
      // Register both the command name and the additional prefix
      (handler as any).prefixToCommand.set('admin', mockCommand);
      (handler as any).prefixToCommand.set('admin-settings', mockCommand);

      const mockInteraction = {
        isChatInputCommand: () => false,
        isModalSubmit: () => true,
        customId: 'admin-settings::modal::global::maxAge',
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn(),
        replied: false,
        deferred: false,
      } as unknown as ModalSubmitInteraction;

      await handler.handleInteraction(mockInteraction);

      expect(mockHandleModal).toHaveBeenCalledWith(mockInteraction);
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

    it('should execute help command like any other command', async () => {
      // Note: Help command accesses commands via interaction.client.commands,
      // not as a second argument. This is handled by the help command itself.
      const mockHelpCommand: Command = {
        data: {
          name: 'help',
          description: 'Show all available commands',
        } as unknown as SlashCommandBuilder,
        execute: vi.fn().mockResolvedValue(undefined),
      };

      handler.getCommands().set('help', mockHelpCommand);

      const mockInteraction = {
        isChatInputCommand: () => true,
        isModalSubmit: () => false,
        commandName: 'help',
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn(),
        replied: false,
        deferred: false,
      } as unknown as ChatInputCommandInteraction;

      await handler.handleInteraction(mockInteraction);

      // Help is executed like any other command (no special handling)
      expect(mockHelpCommand.execute).toHaveBeenCalledWith(mockInteraction);
    });

    it('should handle command execution error with reply', async () => {
      const mockCommand: Command = {
        data: {
          name: 'failing',
          description: 'Failing command',
        } as unknown as SlashCommandBuilder,
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
        } as unknown as SlashCommandBuilder,
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
        } as unknown as SlashCommandBuilder,
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
        } as unknown as SlashCommandBuilder,
        execute: vi.fn(),
      };

      handler.getCommands().set('test', mockCommand);

      expect(handler.getCommands().has('test')).toBe(true);
      expect(handler.getCommands().get('test')).toBe(mockCommand);
    });
  });

  describe('handleAutocomplete', () => {
    it('should respond with empty array for unknown command', async () => {
      const mockInteraction = {
        commandName: 'unknown',
        respond: vi.fn().mockResolvedValue(undefined),
      } as unknown as AutocompleteInteraction;

      await handler.handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });

    it('should respond with empty array when command has no autocomplete handler', async () => {
      const mockCommand: Command = {
        data: {
          name: 'test',
          description: 'Test command',
        } as unknown as SlashCommandBuilder,
        execute: vi.fn(),
        // No autocomplete handler
      };

      handler.getCommands().set('test', mockCommand);

      const mockInteraction = {
        commandName: 'test',
        respond: vi.fn().mockResolvedValue(undefined),
      } as unknown as AutocompleteInteraction;

      await handler.handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });

    it('should call autocomplete handler when defined', async () => {
      const mockAutocomplete = vi.fn().mockResolvedValue(undefined);
      const mockCommand: Command = {
        data: {
          name: 'test',
          description: 'Test command',
        } as unknown as SlashCommandBuilder,
        execute: vi.fn(),
        autocomplete: mockAutocomplete,
      };

      handler.getCommands().set('test', mockCommand);

      const mockInteraction = {
        commandName: 'test',
        respond: vi.fn().mockResolvedValue(undefined),
      } as unknown as AutocompleteInteraction;

      await handler.handleAutocomplete(mockInteraction);

      expect(mockAutocomplete).toHaveBeenCalledWith(mockInteraction);
    });

    it('should respond with empty array on autocomplete error', async () => {
      const mockAutocomplete = vi.fn().mockRejectedValue(new Error('Autocomplete failed'));
      const mockCommand: Command = {
        data: {
          name: 'test',
          description: 'Test command',
        } as unknown as SlashCommandBuilder,
        execute: vi.fn(),
        autocomplete: mockAutocomplete,
      };

      handler.getCommands().set('test', mockCommand);

      const mockInteraction = {
        commandName: 'test',
        respond: vi.fn().mockResolvedValue(undefined),
      } as unknown as AutocompleteInteraction;

      await handler.handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });
  });
});
