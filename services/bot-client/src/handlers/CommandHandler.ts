/**
 * Command Handler
 *
 * Loads slash commands from the commands directory and routes interactions
 * Simple, modular approach - just scan files and build a Map
 */

import { createLogger } from '@tzurot/common-types';
import {
  Collection,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  AutocompleteInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  MessageFlags,
} from 'discord.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import type { Command } from '../types.js';
import { VALID_COMMAND_KEYS, type CommandDefinition } from '../utils/defineCommand.js';
import { getCommandFromCustomId } from '../utils/customIds.js';
import { getCommandFiles } from '../utils/commandFileUtils.js';

const logger = createLogger('CommandHandler');

// Get directory name for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Command Handler - manages slash command registration and execution
 *
 * Uses a prefix-to-command map for component routing:
 * - Command name is automatically registered as a prefix
 * - Commands can declare additional prefixes via componentPrefixes
 * - Collision detection prevents duplicate prefix registration
 */
export class CommandHandler {
  private commands: Collection<string, Command>;
  private prefixToCommand: Map<string, Command>;

  constructor() {
    this.commands = new Collection();
    this.prefixToCommand = new Map();
  }

  /**
   * Register a prefix for a command with collision detection
   * @throws Error if prefix is already registered to a different command
   */
  private registerPrefix(prefix: string, command: Command): void {
    const existing = this.prefixToCommand.get(prefix);
    if (existing !== undefined && existing !== command) {
      throw new Error(
        `Prefix collision: '${prefix}' is already registered to '${existing.data.name}' ` +
          `but '${command.data.name}' tried to claim it`
      );
    }
    this.prefixToCommand.set(prefix, command);
  }

  /**
   * Load all commands from the commands directory
   */
  async loadCommands(): Promise<void> {
    const commandsPath = join(__dirname, '../commands');
    const commandFiles = getCommandFiles(commandsPath);

    logger.info(`[CommandHandler] Loading ${commandFiles.length} command files...`);

    for (const filePath of commandFiles) {
      try {
        // Convert file path to file URL for ESM imports
        const fileUrl = pathToFileURL(filePath).href;
        const importedModule = (await import(fileUrl)) as Record<string, unknown>;

        // Support both default export (new pattern) and named exports (legacy)
        // Default export is preferred - it enables TypeScript excess property checking
        const cmdDef = (importedModule.default ?? importedModule) as Partial<Command>;

        // Validate command structure
        if (
          cmdDef.data === undefined ||
          cmdDef.data === null ||
          cmdDef.execute === undefined ||
          cmdDef.execute === null
        ) {
          logger.warn({}, `[CommandHandler] Invalid command file: ${filePath}`);
          continue;
        }

        // Runtime validation: fail fast on unknown properties (catches typos like handleModalSubmit)
        for (const key of Object.keys(cmdDef)) {
          if (!VALID_COMMAND_KEYS.includes(key as keyof CommandDefinition)) {
            throw new Error(
              `Command "${cmdDef.data.name}" exports unknown property "${key}". ` +
                `Valid properties: ${VALID_COMMAND_KEYS.join(', ')}. ` +
                `Did you typo a handler name?`
            );
          }
        }

        // Determine category based on directory structure (DRY - no manual declaration needed)
        const relativePath = filePath.replace(commandsPath, '');
        const pathParts = relativePath.split('/').filter(Boolean);
        const category =
          pathParts.length > 1
            ? pathParts[0].charAt(0).toUpperCase() + pathParts[0].slice(1)
            : undefined;

        // Create command object with category (don't mutate the imported module)
        const commandWithCategory: Command = {
          data: cmdDef.data,
          deferralMode: cmdDef.deferralMode, // New: compile-time safe deferral
          execute: cmdDef.execute,
          autocomplete: cmdDef.autocomplete,
          handleSelectMenu: cmdDef.handleSelectMenu,
          handleButton: cmdDef.handleButton,
          handleModal: cmdDef.handleModal,
          componentPrefixes: cmdDef.componentPrefixes,
          category,
        };

        const commandName = cmdDef.data.name;
        this.commands.set(commandName, commandWithCategory);

        // Register command name as a prefix for component routing
        this.registerPrefix(commandName, commandWithCategory);

        // Register any additional prefixes declared by the command
        if (commandWithCategory.componentPrefixes !== undefined) {
          for (const prefix of commandWithCategory.componentPrefixes) {
            this.registerPrefix(prefix, commandWithCategory);
          }
        }

        logger.info(`[CommandHandler] Loaded command: ${commandName}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          { err: error, filePath, errorMessage },
          `[CommandHandler] Failed to load command: ${filePath}`
        );
      }
    }

    logger.info(`[CommandHandler] Loaded ${this.commands.size} commands`);
  }

  /**
   * Handle a slash command or modal submit interaction
   */
  async handleInteraction(
    interaction: ChatInputCommandInteraction | ModalSubmitInteraction
  ): Promise<void> {
    // Handle modal submits via prefix routing
    if (interaction.isModalSubmit()) {
      await this.handleModalInteraction(interaction);
      return;
    }

    // Handle slash commands
    const commandName = interaction.commandName;
    const command = this.commands.get(commandName);

    if (!command) {
      logger.warn({}, `[CommandHandler] Unknown command: ${commandName}`);
      await interaction.reply({
        content: 'Unknown command!',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      logger.info(`[CommandHandler] Executing command: ${commandName}`);
      // Type assertion for legacy commands that receive raw interaction
      // New commands with deferralMode are handled by index.ts directly
      type LegacyExecute = (interaction: ChatInputCommandInteraction) => Promise<void>;
      const execute = command.execute as LegacyExecute;
      await execute(interaction);
    } catch (error) {
      logger.error({ err: error }, `[CommandHandler] Error executing command: ${commandName}`);

      const errorMessage = 'There was an error executing this command!';

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
      }
    }
  }

  /**
   * Handle a modal submit interaction
   * Routes via prefix map and uses handleModal if available
   */
  private async handleModalInteraction(interaction: ModalSubmitInteraction): Promise<void> {
    const customId = interaction.customId;
    const prefix = getCommandFromCustomId(customId) ?? customId;

    // Look up command by prefix
    const command = this.prefixToCommand.get(prefix);

    if (!command) {
      logger.warn({ customId, prefix }, '[CommandHandler] Unknown prefix for modal');
      await interaction.reply({
        content: 'Unknown interaction!',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const commandName = command.data.name;

    try {
      // Commands must export handleModal to handle modal submissions
      if (command.handleModal !== undefined) {
        logger.info(`[CommandHandler] Executing modal handler: ${commandName}`);
        await command.handleModal(interaction);
      } else {
        logger.warn(
          { commandName, customId },
          `[CommandHandler] Command "${commandName}" received modal but doesn't export handleModal`
        );
        await interaction.reply({
          content: 'This command does not support modal interactions.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } catch (error) {
      logger.error({ err: error, customId }, `[CommandHandler] Error in modal: ${commandName}`);

      const errorMessage = 'There was an error processing this interaction!';

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
      }
    }
  }

  /**
   * Handle an autocomplete interaction
   */
  async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName);

    if (!command) {
      logger.warn(
        {},
        `[CommandHandler] Unknown command for autocomplete: ${interaction.commandName}`
      );
      await interaction.respond([]);
      return;
    }

    if (!command.autocomplete) {
      logger.warn(
        {},
        `[CommandHandler] No autocomplete handler for command: ${interaction.commandName}`
      );
      await interaction.respond([]);
      return;
    }

    try {
      await command.autocomplete(interaction);
    } catch (error) {
      logger.error(
        { err: error },
        `[CommandHandler] Error in autocomplete for: ${interaction.commandName}`
      );
      await interaction.respond([]);
    }
  }

  /**
   * Handle a component interaction (select menu or button)
   *
   * Routes based on customId prefix using the prefixToCommand map.
   * Commands declare their prefixes via componentPrefixes.
   */
  async handleComponentInteraction(
    interaction: StringSelectMenuInteraction | ButtonInteraction
  ): Promise<void> {
    const customId = interaction.customId;
    const prefix = getCommandFromCustomId(customId) ?? customId;

    // Look up command by prefix
    const command = this.prefixToCommand.get(prefix);

    if (!command) {
      logger.warn({ customId, prefix }, '[CommandHandler] Unknown prefix for component');
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'Unknown interaction!',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    const commandName = command.data.name;

    try {
      if (interaction.isStringSelectMenu()) {
        if (!command.handleSelectMenu) {
          logger.warn(
            { customId, commandName },
            '[CommandHandler] No select menu handler for command'
          );
          return;
        }
        logger.info(`[CommandHandler] Executing select menu handler: ${commandName}`);
        await command.handleSelectMenu(interaction);
      } else if (interaction.isButton()) {
        if (!command.handleButton) {
          logger.warn({ customId, commandName }, '[CommandHandler] No button handler for command');
          return;
        }
        logger.info(`[CommandHandler] Executing button handler: ${commandName}`);
        await command.handleButton(interaction);
      }
    } catch (error) {
      logger.error(
        { err: error, customId, commandName },
        '[CommandHandler] Error in component interaction'
      );

      const errorMessage = 'There was an error processing this interaction!';

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
      }
    }
  }

  /**
   * Get all loaded commands (for deployment script)
   */
  getCommands(): Collection<string, Command> {
    return this.commands;
  }

  /**
   * Get a specific command by name
   */
  getCommand(name: string): Command | undefined {
    return this.commands.get(name);
  }
}
