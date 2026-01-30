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

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { CommandHandler } from './CommandHandler.js';

// Mock redis since character/chat.ts imports it
vi.mock('../redis.js', () => ({
  redisService: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    exists: vi.fn(),
    expire: vi.fn(),
    setWithExpiry: vi.fn(),
  },
}));

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
    it('should preserve subcommandDeferralModes for settings command', () => {
      const settingsCommand = handler.getCommand('settings');

      expect(settingsCommand).toBeDefined();
      expect(settingsCommand?.subcommandDeferralModes).toBeDefined();
      expect(settingsCommand?.subcommandDeferralModes?.['apikey set']).toBe('modal');
    });

    it('should preserve subcommandDeferralModes for character command', () => {
      const characterCommand = handler.getCommand('character');

      expect(characterCommand).toBeDefined();
      expect(characterCommand?.subcommandDeferralModes).toBeDefined();
      // character has 'chat' and 'create' as public subcommands
      expect(characterCommand?.subcommandDeferralModes?.chat).toBe('public');
    });

    it('should preserve subcommandDeferralModes for persona command', () => {
      const personaCommand = handler.getCommand('persona');

      expect(personaCommand).toBeDefined();
      expect(personaCommand?.subcommandDeferralModes).toBeDefined();
      // persona has 'create' and 'override set' as modal subcommands
      expect(personaCommand?.subcommandDeferralModes?.create).toBe('modal');
    });

    it('should preserve deferralMode for commands', () => {
      const helpCommand = handler.getCommand('help');

      expect(helpCommand).toBeDefined();
      expect(helpCommand?.deferralMode).toBe('ephemeral');
    });

    it('should preserve handleModal for commands that define it', () => {
      const settingsCommand = handler.getCommand('settings');

      expect(settingsCommand).toBeDefined();
      expect(settingsCommand?.handleModal).toBeDefined();
      expect(typeof settingsCommand?.handleModal).toBe('function');
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
        'memory',
        'persona',
        'preset',
        'settings',
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

  /**
   * POSTMORTEM (2026-01-26): Dashboard entityType routing validation
   *
   * Bug: /me profile edit returned "Unknown interaction" because the 'profile'
   * prefix wasn't registered as a componentPrefix on the /me command.
   *
   * Root cause: Dashboard framework uses entityType as customId prefix (e.g., 'profile::menu::...'),
   * but CommandHandler routes by prefix. When command name doesn't match entityType,
   * the entityType must be in componentPrefixes.
   *
   * These tests ensure dashboard entityTypes are properly routable.
   */
  describe('dashboard entityType routing (architectural validation)', () => {
    /**
     * Validates that all dashboard entityTypes have a matching prefix registered.
     *
     * Pattern: entityType is used as the first segment of customIds.
     * Example: entityType='profile' creates customIds like 'profile::menu::...'
     *
     * For routing to work:
     * 1. Command name equals entityType (e.g., /character + 'character'), OR
     * 2. entityType is in componentPrefixes (e.g., /me + componentPrefixes: ['profile'])
     */
    it('should have persona entityType routable to /persona command', () => {
      const personaCommand = handler.getCommand('persona');
      expect(personaCommand).toBeDefined();

      // Command name 'persona' matches entityType, so no componentPrefixes needed
      // But verify the prefix is registered
      const prefixToCommand = (handler as any).prefixToCommand as Map<string, unknown>;
      expect(prefixToCommand.has('persona'), "'persona' prefix should be registered").toBe(true);
    });

    it('should have character entityType routable to /character command', () => {
      const characterCommand = handler.getCommand('character');
      expect(characterCommand).toBeDefined();

      // Command name 'character' matches entityType, so no componentPrefixes needed
      // But verify the prefix is registered (either way works)
      const prefixToCommand = (handler as any).prefixToCommand as Map<string, unknown>;
      expect(prefixToCommand.has('character'), "'character' prefix should be registered").toBe(
        true
      );
    });

    it('should have preset entityType routable to /preset command', () => {
      const presetCommand = handler.getCommand('preset');
      expect(presetCommand).toBeDefined();

      // Command name 'preset' matches entityType
      const prefixToCommand = (handler as any).prefixToCommand as Map<string, unknown>;
      expect(prefixToCommand.has('preset'), "'preset' prefix should be registered").toBe(true);
    });
  });

  describe('component interaction routing', () => {
    /**
     * Create a mock button interaction for testing
     */
    function createMockButtonInteraction(customId: string) {
      return {
        customId,
        isButton: () => true,
        isStringSelectMenu: () => false,
        replied: false,
        deferred: false,
        reply: vi.fn().mockResolvedValue(undefined),
      } as any;
    }

    it('should route persona:: customId to persona command', async () => {
      const personaCommand = handler.getCommand('persona');
      expect(personaCommand?.handleButton).toBeDefined();

      // Spy on the handler
      const handleButtonSpy = vi.spyOn(personaCommand!, 'handleButton');

      const interaction = createMockButtonInteraction('persona::close::test-uuid');
      await handler.handleComponentInteraction(interaction);

      expect(handleButtonSpy).toHaveBeenCalledWith(interaction);
      handleButtonSpy.mockRestore();
    });

    it('should route character:: customId to character command', async () => {
      const characterCommand = handler.getCommand('character');
      expect(characterCommand?.handleButton).toBeDefined();

      const handleButtonSpy = vi.spyOn(characterCommand!, 'handleButton');

      const interaction = createMockButtonInteraction('character::close::test-slug');
      await handler.handleComponentInteraction(interaction);

      expect(handleButtonSpy).toHaveBeenCalledWith(interaction);
      handleButtonSpy.mockRestore();
    });

    it('should return error for unregistered prefix', async () => {
      const interaction = createMockButtonInteraction('nonexistent::action::id');
      await handler.handleComponentInteraction(interaction);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: 'Unknown interaction!',
        flags: MessageFlags.Ephemeral,
      });
    });
  });

  /**
   * Registry Integrity Tests
   *
   * These tests validate the architectural contract between commands and routing.
   * They scan all loaded commands to ensure dashboard entityTypes are properly
   * routable without requiring componentPrefixes hacks.
   */
  describe('registry integrity (comprehensive)', () => {
    it('should have all componentPrefixes registered in prefixToCommand', () => {
      const prefixToCommand = (handler as any).prefixToCommand as Map<string, unknown>;

      for (const [name, command] of handler.getCommands()) {
        // Command name should always be registered
        expect(prefixToCommand.has(name), `Command "${name}" should be registered as prefix`).toBe(
          true
        );

        // All componentPrefixes should be registered
        if (command.componentPrefixes) {
          for (const prefix of command.componentPrefixes) {
            expect(
              prefixToCommand.has(prefix),
              `componentPrefix "${prefix}" from "${name}" should be registered`
            ).toBe(true);
          }
        }
      }
    });

    it('should have no duplicate prefix registrations across commands', () => {
      const prefixOwners = new Map<string, string[]>();

      for (const [name, command] of handler.getCommands()) {
        // Track command name as prefix
        if (!prefixOwners.has(name)) {
          prefixOwners.set(name, []);
        }
        prefixOwners.get(name)!.push(name);

        // Track componentPrefixes
        if (command.componentPrefixes) {
          for (const prefix of command.componentPrefixes) {
            if (!prefixOwners.has(prefix)) {
              prefixOwners.set(prefix, []);
            }
            prefixOwners.get(prefix)!.push(name);
          }
        }
      }

      // Check for duplicates
      for (const [prefix, owners] of prefixOwners) {
        if (owners.length > 1) {
          // Same command can own a prefix via name and componentPrefixes
          const uniqueOwners = [...new Set(owners)];
          expect(
            uniqueOwners.length,
            `Prefix "${prefix}" is claimed by multiple commands: ${uniqueOwners.join(', ')}`
          ).toBe(1);
        }
      }
    });

    it('should log all registered prefixes for debugging', () => {
      const prefixToCommand = (handler as any).prefixToCommand as Map<string, unknown>;
      const registeredPrefixes = [...prefixToCommand.keys()].sort();

      // This test documents what prefixes are registered
      // If this snapshot changes, it indicates routing changes
      expect(registeredPrefixes).toEqual(
        expect.arrayContaining([
          'admin',
          'admin-servers', // Admin servers browse pattern
          'admin-settings',
          'channel',
          'character',
          'help',
          'history',
          'memory',
          'persona', // Persona command - entityType matches command name
          'preset',
          'settings', // Settings command - consolidates timezone, apikey, preset
        ])
      );
    });
  });

  /**
   * Command Structure Snapshot Tests
   *
   * These tests create snapshots of command structure to catch unintended changes.
   * Changes to command names, subcommands, or options should be intentional.
   */
  describe('command structure snapshots', () => {
    it('should have stable /character command structure', () => {
      const characterCommand = handler.getCommand('character');
      expect(characterCommand).toBeDefined();

      const data = characterCommand!.data.toJSON();
      expect(data.name).toBe('character');
      expect(data.options).toMatchSnapshot('character-command-options');
    });

    it('should have stable /admin command structure', () => {
      const adminCommand = handler.getCommand('admin');
      expect(adminCommand).toBeDefined();

      const data = adminCommand!.data.toJSON();
      expect(data.name).toBe('admin');
      expect(data.options).toMatchSnapshot('admin-command-options');
    });

    it('should have stable /persona command structure', () => {
      const personaCommand = handler.getCommand('persona');
      expect(personaCommand).toBeDefined();

      const data = personaCommand!.data.toJSON();
      expect(data.name).toBe('persona');
      expect(data.options).toMatchSnapshot('persona-command-options');
    });

    it('should have stable /settings command structure', () => {
      const settingsCommand = handler.getCommand('settings');
      expect(settingsCommand).toBeDefined();

      const data = settingsCommand!.data.toJSON();
      expect(data.name).toBe('settings');
      expect(data.options).toMatchSnapshot('settings-command-options');
    });

    it('should have stable command count', () => {
      // Track total command count to catch accidental additions/removals
      const commandCount = handler.getCommands().size;
      expect(commandCount).toMatchSnapshot('total-command-count');
    });
  });
});
