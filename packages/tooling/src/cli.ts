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
import { registerDeployCommands } from './commands/deploy.js';
import { registerCacheCommands } from './commands/cache.js';
import { registerDevCommands } from './commands/dev.js';
import { registerRunCommands } from './commands/run.js';
import { registerGhCommands } from './commands/gh.js';
import { registerMemoryCommands } from './commands/memory.js';
import { registerRetentionCommands } from './commands/retention.js';
import { registerTelemetryCommands } from './commands/telemetry.js';
import { registerTestCommands } from './commands/test.js';
import { registerReleaseCommands } from './commands/release.js';
import { registerContextCommands } from './commands/context.js';
import { registerSecretsCommands } from './commands/secrets.js';
import { registerSecurityCommands } from './commands/security.js';
import { registerInspectCommands } from './commands/inspect.js';
import { registerXrayCommands } from './commands/xray.js';
import { registerGuardCommands } from './commands/guard.js';
import { registerVoiceCommands } from './commands/voice.js';
import { registerCpdCommands } from './commands/cpd.js';
import { registerCodegenCommands } from './commands/codegen.js';
import { registerTopologyCommands } from './commands/topology.js';
import { registerPromptCommands } from './commands/prompt.js';
import { UsageError, reportUsageError } from './utils/errors.js';
import {
  classifyNoMatch,
  unknownCommandMessage,
  unknownFlagsMessage,
} from './utils/unknown-command.js';

// Read version from package.json dynamically
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string };

const cli = cac('ops');

// Register command groups
registerDbCommands(cli);
registerDeployCommands(cli);
registerCacheCommands(cli);
registerDevCommands(cli);
registerRunCommands(cli);
registerGhCommands(cli);
registerMemoryCommands(cli);
registerRetentionCommands(cli);
registerTelemetryCommands(cli);
registerTestCommands(cli);
registerReleaseCommands(cli);
registerContextCommands(cli);
registerSecretsCommands(cli);
registerSecurityCommands(cli);
registerInspectCommands(cli);
registerXrayCommands(cli);
registerGuardCommands(cli);
registerVoiceCommands(cli);
registerCpdCommands(cli);
registerCodegenCommands(cli);
registerTopologyCommands(cli);
registerPromptCommands(cli);

// Global options
cli.help();
cli.version(packageJson.version);

// Parse and run.
//
// `cli.parse()` runs the matched command but DISCARDS the promise its action
// returns, so a rejected async action surfaces as an unhandled rejection — a
// stack trace and a Node version banner where a one-line usage error belongs.
// Parsing with `{ run: false }` and awaiting `runMatchedCommand()` ourselves
// is cac's documented seam for owning that error path. `--help` and
// `--version` are still handled inside `parse()`, which unsets the matched
// command afterwards, so `runMatchedCommand()` correctly no-ops for them.
cli.parse(process.argv, { run: false });

try {
  // cac no-ops when nothing matched, so an unknown command name would otherwise
  // print nothing and exit 0 — a typo indistinguishable from success.
  const action = classifyNoMatch(cli);
  if (action.kind === 'unknown') throw new UsageError(unknownCommandMessage(action.name));
  if (action.kind === 'unknown-flag') throw new UsageError(unknownFlagsMessage(action.flags));
  if (action.kind === 'help') cli.outputHelp();
  else await cli.runMatchedCommand();
} catch (error) {
  if (!reportUsageError(error)) throw error;
}
