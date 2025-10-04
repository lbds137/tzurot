/**
 * Deploy Slash Commands
 *
 * Registers slash commands with Discord's API
 * Usage:
 *   GUILD_ID=123456789 pnpm tsx scripts/deploy-commands.ts  # Guild-specific (dev)
 *   pnpm tsx scripts/deploy-commands.ts                     # Global (production)
 */

import { REST, Routes } from 'discord.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import type { Command } from '../src/types.js';

// Get directory name for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const clientId = process.env.DISCORD_CLIENT_ID;
const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID; // Optional - for dev/testing

if (!clientId || !token) {
  console.error('Missing DISCORD_CLIENT_ID or DISCORD_TOKEN environment variables');
  process.exit(1);
}

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
 * Load all commands and register with Discord
 */
async function deployCommands(): Promise<void> {
  try {
    const commandsPath = join(__dirname, '../src/commands');
    const commandFiles = getCommandFiles(commandsPath);

    console.log(`📦 Loading ${commandFiles.length} command files...`);

    const commands = [];
    for (const filePath of commandFiles) {
      const command = await import(filePath) as Command;

      if (!command.data || !command.execute) {
        console.warn(`⚠️  Skipping invalid command file: ${filePath}`);
        continue;
      }

      commands.push(command.data.toJSON());
      console.log(`✅ Loaded: /${command.data.name}`);
    }

    console.log(`\n🚀 Deploying ${commands.length} commands to Discord...`);

    const rest = new REST().setToken(token);

    if (guildId) {
      // Guild-specific deployment (dev/testing)
      console.log(`📍 Deploying to guild: ${guildId}`);
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      );
      console.log(`✅ Successfully deployed ${commands.length} commands to guild ${guildId}`);
    } else {
      // Global deployment (production)
      console.log('🌍 Deploying globally (this may take up to an hour to propagate)');
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );
      console.log(`✅ Successfully deployed ${commands.length} commands globally`);
    }

  } catch (error) {
    console.error('❌ Error deploying commands:', error);
    process.exit(1);
  }
}

// Run deployment
void deployCommands();
