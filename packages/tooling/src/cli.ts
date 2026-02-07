#!/usr/bin/env node
/**
 * Tzurot Operations CLI
 *
 * Unified CLI for monorepo operations: database, data import, deployment, etc.
 *
 * Usage: pnpm ops <command> [options]
 */

// Load environment variables from .env file
import 'dotenv/config';

import { cac } from 'cac';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Import command modules
import { registerDbCommands } from './commands/db.js';
import { registerDataCommands } from './commands/data.js';
import { registerDeployCommands } from './commands/deploy.js';
import { registerCacheCommands } from './commands/cache.js';
import { registerDevCommands } from './commands/dev.js';
import { registerRunCommands } from './commands/run.js';
import { registerGhCommands } from './commands/gh.js';
import { registerMemoryCommands } from './commands/memory.js';
import { registerTestCommands } from './commands/test.js';
import { registerReleaseCommands } from './commands/release.js';
import { registerContextCommands } from './commands/context.js';
import { registerInspectCommands } from './commands/inspect.js';
import { registerXrayCommands } from './commands/xray.js';

// Read version from package.json dynamically
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string };

const cli = cac('ops');

// Register command groups
registerDbCommands(cli);
registerDataCommands(cli);
registerDeployCommands(cli);
registerCacheCommands(cli);
registerDevCommands(cli);
registerRunCommands(cli);
registerGhCommands(cli);
registerMemoryCommands(cli);
registerTestCommands(cli);
registerReleaseCommands(cli);
registerContextCommands(cli);
registerInspectCommands(cli);
registerXrayCommands(cli);

// Global options
cli.help();
cli.version(packageJson.version);

// Parse and run
cli.parse();
