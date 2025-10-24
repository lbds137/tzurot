/**
 * Deploy Slash Commands Utility
 *
 * Shared logic for deploying slash commands to Discord
 * Can be called from scripts or on bot startup
 */

import { REST, Routes } from 'discord.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import type { Command } from '../types.js';
import { createLogger, getConfig } from '@tzurot/common-types';

const logger = createLogger('deploy-commands');

/**
 * Recursively get all .ts/.js files from commands directory
 */
function getCommandFiles(dir: string): string[] {
  const files: string[] = [];

  const items = readdirSync(dir);
  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...getCommandFiles(fullPath));
    } else if (item.endsWith('.ts') || item.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Deploy commands to Discord
 *
 * @param global - Deploy globally (production) or to a specific guild (dev)
 * @returns Promise that resolves when deployment is complete
 */
export async function deployCommands(global = true): Promise<void> {
  try {
    const config = getConfig();
    const clientId = config.DISCORD_CLIENT_ID;
    const token = config.DISCORD_TOKEN;
    const guildId = config.GUILD_ID;

    if (!clientId || !token) {
      throw new Error('Missing DISCORD_CLIENT_ID or DISCORD_TOKEN environment variables');
    }

    // Determine commands path (handle both dev and production)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const commandsPath = join(__dirname, '../commands');

    const commandFiles = getCommandFiles(commandsPath);
    logger.info(`Loading ${commandFiles.length} command files...`);

    const commands = [];
    for (const filePath of commandFiles) {
      const command = await import(filePath) as Command;

      if (!command.data || !command.execute) {
        logger.warn(`Skipping invalid command file: ${filePath}`);
        continue;
      }

      commands.push(command.data.toJSON());
      logger.info(`Loaded: /${command.data.name}`);
    }

    logger.info(`Deploying ${commands.length} commands to Discord...`);

    const rest = new REST().setToken(token);

    if (!global && guildId) {
      // Guild-specific deployment (dev/testing)
      logger.info(`Deploying to guild: ${guildId}`);
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      );
      logger.info(`Successfully deployed ${commands.length} commands to guild ${guildId}`);
    } else {
      // Global deployment (production)
      logger.info('Deploying globally (this may take up to an hour to propagate)');
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );
      logger.info(`Successfully deployed ${commands.length} commands globally`);
    }

  } catch (error) {
    logger.error({ err: error }, 'Error deploying commands');
    throw error;
  }
}
