/**
 * Deploy Slash Commands Utility
 *
 * Shared logic for deploying slash commands to Discord
 * Can be called from scripts or on bot startup
 */

import { REST, Routes } from 'discord.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Command } from '../types.js';
import { createLogger, getConfig } from '@tzurot/common-types';
import { getCommandFiles } from './commandFileUtils.js';

const logger = createLogger('deploy-commands');

interface CommandJson {
  toJSON(): unknown;
}

/**
 * Load and validate a single command file
 * @returns Command data JSON or null if invalid
 */
async function loadCommandFile(filePath: string): Promise<unknown> {
  const command = (await import(filePath)) as Command;

  if (
    command.data === undefined ||
    command.data === null ||
    command.execute === undefined ||
    command.execute === null
  ) {
    logger.warn({}, `Skipping invalid command file: ${filePath}`);
    return null;
  }

  logger.info(`Loaded: /${command.data.name}`);
  return (command.data as CommandJson).toJSON();
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

    if (
      clientId === undefined ||
      clientId.length === 0 ||
      token === undefined ||
      token.length === 0
    ) {
      throw new Error('Missing DISCORD_CLIENT_ID or DISCORD_TOKEN environment variables');
    }

    // Determine commands path (handle both dev and production)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const commandsPath = join(__dirname, '../commands');

    const commandFiles = getCommandFiles(commandsPath);
    logger.info(`Loading ${commandFiles.length} command files...`);

    const commands: unknown[] = [];
    for (const filePath of commandFiles) {
      const commandData = await loadCommandFile(filePath);
      if (commandData !== null) {
        commands.push(commandData);
      }
    }

    logger.info(`Deploying ${commands.length} commands to Discord...`);

    const rest = new REST().setToken(token);

    if (global !== true && guildId !== undefined && guildId !== null && guildId.length > 0) {
      // Guild-specific deployment (dev/testing)
      logger.info(`Deploying to guild: ${guildId}`);
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      logger.info(`Successfully deployed ${commands.length} commands to guild ${guildId}`);
    } else {
      // Global deployment (production)
      logger.info('Deploying globally (this may take up to an hour to propagate)');
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      logger.info(`Successfully deployed ${commands.length} commands globally`);
    }
  } catch (error) {
    logger.error({ err: error }, 'Error deploying commands');
    throw error;
  }
}
