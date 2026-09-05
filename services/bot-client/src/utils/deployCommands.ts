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
import { getConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getCommandFiles } from './commandFileUtils.js';
import {
  hashCommandBody,
  deployedCommandsKey,
  type DeployedCommandsStore,
  type DeployScope,
} from './commandRegistrationGate.js';

const logger = createLogger('deploy-commands');

interface CommandJson {
  toJSON(): unknown;
}

/**
 * Load and validate a single command file
 *
 * Command entry points MUST default-export their Command (the shape
 * `defineCommand` returns) — same contract CommandHandler enforces. A module
 * with no default export is skipped as invalid.
 *
 * @returns Command data JSON or null if invalid
 */
async function loadCommandFile(filePath: string): Promise<unknown> {
  const importedModule = (await import(filePath)) as Record<string, unknown>;

  const command = importedModule.default as Partial<Command> | undefined;

  if (
    command?.data === undefined ||
    command.data === null ||
    command.execute === undefined ||
    command.execute === null
  ) {
    logger.warn({ filePath }, 'Skipping invalid command file');
    return null;
  }

  logger.info({ commandName: command.data.name }, 'Loaded command');
  return (command.data as CommandJson).toJSON();
}

function resolveScope(global: boolean, guildId: string | undefined): DeployScope {
  return global !== true && guildId !== undefined && guildId !== null && guildId.length > 0
    ? { global: false, guildId }
    : { global: true };
}

/**
 * Read the previously-registered command hash for a scope. A store read
 * failure is not fatal: it resolves to null, which the caller treats as "no
 * prior hash" and registers anyway — fail open, so a Redis hiccup can never
 * leave commands stale (pinned by `'registers when the hash store read rejects'`).
 */
async function readPreviousHash(store: DeployedCommandsStore, key: string): Promise<string | null> {
  try {
    return await store.get(key);
  } catch (err) {
    logger.warn(
      { err, key },
      'Could not read the last-registered command hash; registering anyway'
    );
    return null;
  }
}

/**
 * Record the newly-registered command hash for a scope. A write failure
 * never fails the caller — the PUT already succeeded, so the only cost is a
 * redundant PUT on the next boot.
 */
async function recordHash(store: DeployedCommandsStore, key: string, hash: string): Promise<void> {
  try {
    await store.set(key, hash);
  } catch (err) {
    logger.warn({ err, key }, 'Could not record the newly-registered command hash');
  }
}

/**
 * When a store is supplied and its recorded hash for this scope already
 * matches the body, logs and returns true so the caller can skip the PUT.
 * Returns false (no store, or the hash changed) whenever registration must
 * proceed.
 */
async function shouldSkipUnchangedDeploy(
  store: DeployedCommandsStore | undefined,
  key: string | undefined,
  hash: string | undefined,
  commandCount: number
): Promise<boolean> {
  if (store === undefined || key === undefined || hash === undefined) {
    return false;
  }

  const previous = await readPreviousHash(store, key);
  if (previous !== hash) {
    return false;
  }

  logger.info(
    { count: commandCount, key },
    'Slash commands unchanged since the last registration; skipping'
  );
  return true;
}

/** Sends the PUT for one scope and logs the outcome. */
async function putCommands(
  rest: REST,
  clientId: string,
  scope: DeployScope,
  commands: unknown[]
): Promise<void> {
  if (!scope.global) {
    // Guild-specific deployment (dev/testing)
    logger.info({ guildId: scope.guildId }, 'Deploying to guild');
    await rest.put(Routes.applicationGuildCommands(clientId, scope.guildId), { body: commands });
    logger.info(
      { count: commands.length, guildId: scope.guildId },
      'Successfully deployed commands to guild'
    );
    return;
  }

  // Global deployment (production)
  logger.info('Deploying globally (this may take up to an hour to propagate)');
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  logger.info({ count: commands.length }, 'Successfully deployed commands globally');
}

/**
 * Deploy commands to Discord
 *
 * @param global - Deploy globally (production) or to a specific guild (dev)
 * @param store - Optional last-registered-hash store. When provided, a PUT
 *   whose body hash matches the stored hash is skipped. When omitted,
 *   behaves exactly as before: always PUT, no hash read or write.
 * @returns Promise that resolves when deployment is complete
 */
export async function deployCommands(global = true, store?: DeployedCommandsStore): Promise<void> {
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
    logger.info({ count: commandFiles.length }, 'Loading command files');

    const commands: unknown[] = [];
    for (const filePath of commandFiles) {
      const commandData = await loadCommandFile(filePath);
      if (commandData !== null) {
        commands.push(commandData);
      }
    }

    const scope = resolveScope(global, guildId);

    // Only computed when a store is supplied: hashing/keying is pure and
    // cheap, but there is no key to read or write without one.
    const hash = store !== undefined ? hashCommandBody(commands) : undefined;
    const key = store !== undefined ? deployedCommandsKey(clientId, scope) : undefined;

    if (await shouldSkipUnchangedDeploy(store, key, hash, commands.length)) {
      return;
    }

    logger.info({ count: commands.length }, 'Deploying commands to Discord');

    const rest = new REST().setToken(token);
    await putCommands(rest, clientId, scope, commands);

    if (store !== undefined && hash !== undefined && key !== undefined) {
      await recordHash(store, key, hash);
    }
  } catch (error) {
    logger.error({ err: error }, 'Error deploying commands');
    throw error;
  }
}
