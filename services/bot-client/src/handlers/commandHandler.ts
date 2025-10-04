/**
 * Command Handler
 *
 * Loads slash commands from the commands directory and routes interactions
 * Simple, modular approach - just scan files and build a Map
 */

import { createLogger } from '@tzurot/common-types';
import { Collection, ChatInputCommandInteraction } from 'discord.js';
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
        const command = await import(fileUrl);

        // Validate command structure
        if (!command.data || !command.execute) {
          logger.warn(`[CommandHandler] Invalid command file: ${filePath}`);
          continue;
        }

        // Add category based on directory structure
        const relativePath = filePath.replace(commandsPath, '');
        const pathParts = relativePath.split('/').filter(Boolean);
        if (pathParts.length > 1) {
          command.category = pathParts[0].charAt(0).toUpperCase() + pathParts[0].slice(1);
        }

        this.commands.set(command.data.name, command as Command);
        logger.info(`[CommandHandler] Loaded command: ${command.data.name}`);
      } catch (error) {
        logger.error({ err: error }, `[CommandHandler] Failed to load command: ${filePath}`);
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
   * Handle a slash command interaction
   */
  async handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName);

    if (!command) {
      logger.warn(`[CommandHandler] Unknown command: ${interaction.commandName}`);
      await interaction.reply({
        content: 'Unknown command!',
        ephemeral: true
      });
      return;
    }

    try {
      logger.info(`[CommandHandler] Executing command: ${interaction.commandName}`);

      // Pass commands collection to help command
      if (interaction.commandName === 'help') {
        await command.execute(interaction, this.commands);
      } else {
        await command.execute(interaction);
      }
    } catch (error) {
      logger.error({ err: error }, `[CommandHandler] Error executing command: ${interaction.commandName}`);

      const errorMessage = 'There was an error executing this command!';

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
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
