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
import { readdirSync, statSync } from 'node:fs';
import type { Command } from '../types.js';

const logger = createLogger('CommandHandler');

// Get directory name for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Command Handler - manages slash command registration and execution
 */
export class CommandHandler {
  private commands: Collection<string, Command>;

  constructor() {
    this.commands = new Collection();
  }

  /**
   * Load all commands from the commands directory
   */
  async loadCommands(): Promise<void> {
    const commandsPath = join(__dirname, '../commands');
    const commandFiles = this.getCommandFiles(commandsPath);

    logger.info(`[CommandHandler] Loading ${commandFiles.length} command files...`);

    for (const filePath of commandFiles) {
      try {
        // Convert file path to file URL for ESM imports
        const fileUrl = pathToFileURL(filePath).href;
        const importedModule = (await import(fileUrl)) as Partial<Command>;

        // Validate command structure
        if (
          importedModule.data === undefined ||
          importedModule.data === null ||
          importedModule.execute === undefined ||
          importedModule.execute === null
        ) {
          logger.warn({}, `[CommandHandler] Invalid command file: ${filePath}`);
          continue;
        }

        // Determine category based on directory structure
        const relativePath = filePath.replace(commandsPath, '');
        const pathParts = relativePath.split('/').filter(Boolean);
        const category =
          pathParts.length > 1
            ? pathParts[0].charAt(0).toUpperCase() + pathParts[0].slice(1)
            : undefined;

        // Create command object with category (don't mutate the imported module)
        const commandWithCategory: Command = {
          data: importedModule.data,
          execute: importedModule.execute,
          autocomplete: importedModule.autocomplete,
          handleSelectMenu: importedModule.handleSelectMenu,
          handleButton: importedModule.handleButton,
          category,
        };

        this.commands.set(importedModule.data.name, commandWithCategory);
        logger.info(`[CommandHandler] Loaded command: ${importedModule.data.name}`);
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
   * Recursively get all .ts/.js files from commands directory
   */
  private getCommandFiles(dir: string): string[] {
    const files: string[] = [];

    const items = readdirSync(dir);
    for (const item of items) {
      const fullPath = join(dir, item);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...this.getCommandFiles(fullPath));
      } else if ((item.endsWith('.ts') || item.endsWith('.js')) && !item.endsWith('.d.ts')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Handle a slash command or modal submit interaction
   */
  async handleInteraction(
    interaction: ChatInputCommandInteraction | ModalSubmitInteraction
  ): Promise<void> {
    // For modal submits, extract command name from customId (format: "commandName-modalType")
    const commandName = interaction.isModalSubmit()
      ? interaction.customId.split('-')[0]
      : interaction.commandName;

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
      logger.info(
        `[CommandHandler] Executing ${interaction.isModalSubmit() ? 'modal' : 'command'}: ${commandName}`
      );

      // Pass commands collection to help command
      if (commandName === 'help' && interaction.isChatInputCommand()) {
        await command.execute(interaction, this.commands);
      } else {
        await command.execute(interaction);
      }
    } catch (error) {
      logger.error(
        { err: error },
        `[CommandHandler] Error executing ${interaction.isModalSubmit() ? 'modal' : 'command'}: ${commandName}`
      );

      const errorMessage = 'There was an error executing this command!';

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
   * Routes based on customId prefix (first segment before '-')
   * Format: {commandName}-{action}-{...rest}
   */
  async handleComponentInteraction(
    interaction: StringSelectMenuInteraction | ButtonInteraction
  ): Promise<void> {
    // Extract command name from customId prefix
    const customId = interaction.customId;
    const commandName = customId.split('-')[0];

    const command = this.commands.get(commandName);

    if (!command) {
      logger.warn(
        { customId, commandName },
        '[CommandHandler] Unknown command for component interaction'
      );
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'Unknown interaction!',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

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
}
