/**
 * Deploy Slash Commands
 *
 * Registers slash commands with Discord's API
 * Usage:
 *   GUILD_ID=123456789 pnpm deploy-commands  # Guild-specific (dev)
 *   pnpm deploy-commands                     # Global (production)
 *
 * Environment variables are loaded from .env file at monorepo root
 */

import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getConfig } from '@tzurot/common-types';
import { deployCommands } from '../src/utils/deployCommands.js';

// Load .env from monorepo root (two levels up from this script)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadDotenv({ path: join(__dirname, '../../../.env') });

// Configuration
const config = getConfig();
const guildId = config.GUILD_ID; // Optional - for dev/testing

// Run deployment
void deployCommands(!guildId).catch((error: unknown) => {
  console.error('❌ Error deploying commands:', error);
  process.exit(1);
});
