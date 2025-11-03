/**
 * Delete Guild-Specific Slash Commands
 *
 * Removes guild-specific commands (use when switching to global deployment)
 * Usage:
 *   GUILD_ID=123456789 pnpm tsx scripts/delete-guild-commands.ts
 */

import { config as loadDotenv } from 'dotenv';
import { REST, Routes } from 'discord.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getConfig } from '@tzurot/common-types';

// Load .env from monorepo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadDotenv({ path: join(__dirname, '../../../.env') });

const config = getConfig();
const clientId = config.DISCORD_CLIENT_ID;
const token = config.DISCORD_TOKEN;
const guildId = config.GUILD_ID;

if (!clientId || !token || !guildId) {
  console.error('Missing DISCORD_CLIENT_ID, DISCORD_TOKEN, or GUILD_ID');
  process.exit(1);
}

async function deleteGuildCommands(): Promise<void> {
  try {
    console.log(`🗑️  Deleting guild-specific commands from guild: ${guildId}`);

    const rest = new REST().setToken(token);

    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });

    console.log('✅ Successfully deleted all guild-specific commands');
    console.log(
      '📝 Global commands will still appear in this guild (propagation can take up to 1 hour)'
    );
  } catch (error) {
    console.error('❌ Error deleting commands:', error);
    process.exit(1);
  }
}

void deleteGuildCommands();
