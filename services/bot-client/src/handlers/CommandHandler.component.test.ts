/**
 * Component tests for CommandHandler
 *
 * These tests use real command files (not mocks) to verify that
 * command loading correctly preserves all properties.
 *
 * Pattern: *.component.test.ts (colocated with source)
 * See: tzurot-testing skill for test file naming conventions
 *
 * Regression coverage for bugs like subcommandDeferralModes not being
 * copied from loaded modules (fixed in c907942c).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { CommandHandler } from './CommandHandler.js';

describe('CommandHandler (component)', () => {
  let handler: CommandHandler;

  beforeAll(async () => {
    handler = new CommandHandler();
    await handler.loadCommands();
  });

  describe('loadCommands preserves all command properties', () => {
    /**
     * Regression test for: subcommandDeferralModes not being copied
     *
     * The bug: CommandHandler.loadCommands() created a new Command object
     * but forgot to copy subcommandDeferralModes from the imported module.
     * This caused modal subcommands to be treated as ephemeral, resulting
     * in "thinking..." hanging forever.
     *
     * This test ensures subcommandDeferralModes is properly preserved
     * for commands that define it (wallet, character, me).
     */
    it('should preserve subcommandDeferralModes for wallet command', () => {
      const walletCommand = handler.getCommand('wallet');

      expect(walletCommand).toBeDefined();
      expect(walletCommand?.subcommandDeferralModes).toBeDefined();
      expect(walletCommand?.subcommandDeferralModes?.set).toBe('modal');
    });

    it('should preserve subcommandDeferralModes for character command', () => {
      const characterCommand = handler.getCommand('character');

      expect(characterCommand).toBeDefined();
      expect(characterCommand?.subcommandDeferralModes).toBeDefined();
      // character has 'chat' and 'create' as public subcommands
      expect(characterCommand?.subcommandDeferralModes?.chat).toBe('public');
    });

    it('should preserve subcommandDeferralModes for me command', () => {
      const meCommand = handler.getCommand('me');

      expect(meCommand).toBeDefined();
      expect(meCommand?.subcommandDeferralModes).toBeDefined();
      // me has several modal subcommands for profile editing
    });

    it('should preserve deferralMode for commands', () => {
      const helpCommand = handler.getCommand('help');

      expect(helpCommand).toBeDefined();
      expect(helpCommand?.deferralMode).toBe('ephemeral');
    });

    it('should preserve handleModal for commands that define it', () => {
      const walletCommand = handler.getCommand('wallet');

      expect(walletCommand).toBeDefined();
      expect(walletCommand?.handleModal).toBeDefined();
      expect(typeof walletCommand?.handleModal).toBe('function');
    });

    it('should preserve componentPrefixes for commands that define them', () => {
      // admin command has componentPrefixes for admin-settings
      const adminCommand = handler.getCommand('admin');

      expect(adminCommand).toBeDefined();
      // If admin has componentPrefixes, verify they're preserved
      if (adminCommand?.componentPrefixes) {
        expect(Array.isArray(adminCommand.componentPrefixes)).toBe(true);
      }
    });
  });

  describe('command loading completeness', () => {
    it('should load all expected command groups', () => {
      const expectedCommands = [
        'admin',
        'channel',
        'character',
        'help',
        'history',
        'me',
        'memory',
        'preset',
        'wallet',
      ];

      for (const commandName of expectedCommands) {
        const command = handler.getCommand(commandName);
        expect(command, `Command "${commandName}" should be loaded`).toBeDefined();
      }
    });

    it('should have execute function for all commands', () => {
      const commands = handler.getCommands();

      for (const [name, command] of commands) {
        expect(command.execute, `Command "${name}" should have execute`).toBeDefined();
        expect(typeof command.execute, `Command "${name}" execute should be function`).toBe(
          'function'
        );
      }
    });
  });
});
