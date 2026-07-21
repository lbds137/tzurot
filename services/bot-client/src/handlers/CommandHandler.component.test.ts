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

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { CommandHandler } from './CommandHandler.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

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
      // `chime-in` defers ephemerally so errors land invoker-only; the
      // character webhook reply is independent of defer mode and stays
      // public. (Its sibling turn commands are top-level /chat and /random.)
      expect(characterCommand?.subcommandDeferralModes?.['chime-in']).toBe('ephemeral');
      // `create` shows a modal; cross-check it's still set up correctly.
      expect(characterCommand?.subcommandDeferralModes?.create).toBe('modal');
    });

    it('should preserve ephemeral deferralMode for the top-level turn commands', () => {
      // /chat and /random carry the invoker-only rationale on their own
      // definitions after the extraction from /character.
      expect(handler.getCommand('chat')?.deferralMode).toBe('ephemeral');
      expect(handler.getCommand('random')?.deferralMode).toBe('ephemeral');
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
    /**
     * Auto-discover expected commands from the filesystem.
     * This mirrors getCommandFiles() logic: subdirectories of src/commands/
     * containing an index.ts are command groups.
     *
     * Adding a new command directory automatically includes it here —
     * no hardcoded list to forget.
     */
    it('should load all command groups discovered from filesystem', () => {
      const commandsDir = join(__dirname, '../commands');
      const expectedCommands = readdirSync(commandsDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && existsSync(join(commandsDir, d.name, 'index.ts')))
        .map(d => d.name)
        .sort();

      // Sanity check: we should discover a reasonable number of commands
      expect(expectedCommands.length).toBeGreaterThanOrEqual(9);

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

    it('should route shapes:: customId to shapes command', async () => {
      const shapesCommand = handler.getCommand('shapes');
      expect(shapesCommand?.handleButton).toBeDefined();

      const handleButtonSpy = vi.spyOn(shapesCommand!, 'handleButton');

      const interaction = createMockButtonInteraction('shapes::auth-continue');
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

    it('should route voice::destructive::* customIds to voice command', async () => {
      // Regression: voice/voices/clear.ts must build customIds with
      // source: 'voice' (not 'settings') so destructive confirm/cancel/modal
      // interactions route to /voice's handleButton + handleModal. Using
      // source: 'settings' silently fails because /settings.handleButton
      // no longer dispatches voice-purge after the /voice consolidation.
      const voiceCommand = handler.getCommand('voice');
      expect(voiceCommand?.handleButton).toBeDefined();

      const handleButtonSpy = vi.spyOn(voiceCommand!, 'handleButton');

      const interaction = createMockButtonInteraction(
        'voice::destructive::confirm_button::voice-purge::all'
      );
      await handler.handleComponentInteraction(interaction);

      expect(handleButtonSpy).toHaveBeenCalledWith(interaction);
      handleButtonSpy.mockRestore();
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
          'shapes', // Shapes command - import/export from shapes.inc
          'voice', // Voice command - TTS provider config + cloned-voice lifecycle
          'voice-voices', // Voice voices browse pagination (componentPrefixes alt)
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
    // These snapshots pin the FULL command surface, not a hardcoded subset.
    // Previously only six commands were snapshotted by name, so a structural
    // change to any of the other eight (channel, deny, help, history, inspect,
    // memory, models, preset) would pass unnoticed. Iterating every registered
    // command means adding a command auto-adds a snapshot, and changing any
    // command's options (a new subcommand, param, or flag like autocomplete)
    // breaks the matching snapshot. Pairs with 'command loading completeness'
    // above, which asserts every command folder actually loads.

    it('registers a stable set of command names (guards against silent drops)', () => {
      // A per-command snapshot alone would still pass if a command silently
      // failed to load — it just wouldn't snapshot the missing one. Pinning the
      // name set makes an unexpected add or removal fail loudly instead.
      const names = [...handler.getCommands().values()].map(command => command.data.name).sort();
      expect(names).toMatchSnapshot('registered-command-names');
    });

    it('has a stable option structure for every registered command', () => {
      const commands = [...handler.getCommands().values()].sort((a, b) =>
        a.data.name.localeCompare(b.data.name)
      );
      for (const command of commands) {
        const data = command.data.toJSON();
        expect(data.options ?? []).toMatchSnapshot(`${data.name}-command-options`);
      }
    });
  });
});
