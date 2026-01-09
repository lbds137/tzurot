/**
 * Railway Variables Setup
 *
 * Sets up shared and service-specific environment variables for Railway deployment.
 * Reads from local .env file and sets variables via Railway CLI.
 */

import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { checkRailwayCli, getRailwayEnvName, type Environment } from '../utils/env-runner.js';

interface VariableConfig {
  key: string;
  targetKey?: string; // Key to set in Railway (if different from .env key)
  description: string;
  isSecret: boolean;
  required: boolean;
  defaultValue?: string;
}

interface ServiceConfig {
  name: string;
  configs: VariableConfig[];
  service: string | null;
}

export interface SetupOptions {
  env: Exclude<Environment, 'local'>;
  dryRun: boolean;
  yes: boolean;
}

// Shared variables configuration
const SHARED_VARIABLES: VariableConfig[] = [
  {
    key: 'AI_PROVIDER',
    description: 'AI provider (only openrouter supported)',
    isSecret: false,
    required: true,
    defaultValue: 'openrouter',
  },
  { key: 'OPENROUTER_API_KEY', description: 'OpenRouter API key', isSecret: true, required: true },
  {
    key: 'OPENAI_API_KEY',
    description: 'OpenAI API key (embeddings/Whisper)',
    isSecret: true,
    required: false,
  },
  {
    key: 'DEFAULT_AI_MODEL',
    description: 'Default AI model',
    isSecret: false,
    required: true,
    defaultValue: 'anthropic/claude-haiku-4.5',
  },
  {
    key: 'WHISPER_MODEL',
    description: 'Audio transcription model',
    isSecret: false,
    required: true,
    defaultValue: 'whisper-1',
  },
  {
    key: 'VISION_FALLBACK_MODEL',
    description: 'Vision model',
    isSecret: false,
    required: true,
    defaultValue: 'qwen/qwen3-vl-235b-a22b-instruct',
  },
  {
    key: 'EMBEDDING_MODEL',
    description: 'Embedding model',
    isSecret: false,
    required: true,
    defaultValue: 'text-embedding-3-small',
  },
  {
    key: 'NODE_ENV',
    description: 'Node environment',
    isSecret: false,
    required: true,
    defaultValue: 'production',
  },
  {
    key: 'LOG_LEVEL',
    description: 'Logging level',
    isSecret: false,
    required: true,
    defaultValue: 'info',
  },
  {
    key: 'BOT_OWNER_ID',
    description: 'Discord user ID of bot owner',
    isSecret: false,
    required: false,
  },
];

// Service-specific variables
const BOT_CLIENT_VARIABLES: VariableConfig[] = [
  { key: 'DISCORD_TOKEN', description: 'Discord bot token', isSecret: true, required: true },
  { key: 'DISCORD_CLIENT_ID', description: 'Discord client ID', isSecret: false, required: true },
  {
    key: 'AUTO_DEPLOY_COMMANDS',
    description: 'Auto-deploy slash commands',
    isSecret: false,
    required: false,
    defaultValue: 'true',
  },
  {
    key: 'AUTO_TRANSCRIBE_VOICE',
    description: 'Auto-transcribe voice messages',
    isSecret: false,
    required: false,
    defaultValue: 'false',
  },
];

const API_GATEWAY_VARIABLES: VariableConfig[] = [
  {
    key: 'API_GATEWAY_PORT',
    targetKey: 'PORT',
    description: 'Gateway port',
    isSecret: false,
    required: true,
    defaultValue: '3000',
  },
];

const AI_WORKER_VARIABLES: VariableConfig[] = [
  {
    key: 'WORKER_CONCURRENCY',
    description: 'Worker concurrency',
    isSecret: false,
    required: true,
    defaultValue: '5',
  },
  {
    key: 'AI_WORKER_PORT',
    targetKey: 'PORT',
    description: 'Worker port',
    isSecret: false,
    required: true,
    defaultValue: '3001',
  },
];

const ALL_SERVICE_CONFIGS: ServiceConfig[] = [
  { name: 'Shared', configs: SHARED_VARIABLES, service: null },
  { name: 'bot-client', configs: BOT_CLIENT_VARIABLES, service: 'bot-client' },
  { name: 'api-gateway', configs: API_GATEWAY_VARIABLES, service: 'api-gateway' },
  { name: 'ai-worker', configs: AI_WORKER_VARIABLES, service: 'ai-worker' },
];

/**
 * Parse .env file into key-value pairs
 */
function parseEnvFile(filePath: string): Map<string, string> {
  const env = new Map<string, string>();

  if (!existsSync(filePath)) {
    return env;
  }

  const content = readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(trimmed);
    if (match !== null) {
      const [, key, rawValue] = match;
      const value = rawValue.replace(/^["']|["']$/g, '');
      env.set(key, value);
    }
  }

  return env;
}

/**
 * Validate Railway CLI is authenticated and project is linked
 */
function validateRailwayEnvironment(): void {
  if (!checkRailwayCli()) {
    console.error(chalk.red('❌ Railway CLI not authenticated'));
    console.error(chalk.dim('   Run: railway login'));
    process.exit(1);
  }
  console.log(chalk.green('✓') + ' Railway CLI authenticated');

  try {
    const status = execSync('railway status', { stdio: 'pipe', encoding: 'utf-8' });
    console.log(chalk.green('✓') + ' Linked to Railway project');
    console.log(chalk.dim(status.trim()));
  } catch {
    console.error(chalk.red('❌ Not linked to a Railway project'));
    console.error(chalk.dim('   Run: railway link'));
    process.exit(1);
  }
}

/**
 * Prompt user for input (only in interactive mode)
 */
async function promptForValue(
  rl: ReturnType<typeof createInterface>,
  config: VariableConfig,
  currentValue: string | undefined
): Promise<string> {
  return new Promise(resolve => {
    const defaultHint = config.defaultValue !== undefined ? ` [${config.defaultValue}]` : '';
    const prompt = `  Enter ${config.key}${defaultHint}: `;

    if (currentValue !== undefined && currentValue.length > 0) {
      resolve(currentValue);
      return;
    }

    rl.question(prompt, answer => {
      const value = answer.trim();
      if (value.length === 0 && config.defaultValue !== undefined) {
        resolve(config.defaultValue);
      } else {
        resolve(value);
      }
    });
  });
}

/**
 * Collect variable values from .env file and user prompts
 */
async function collectVariableValues(
  localEnv: Map<string, string>,
  rl: ReturnType<typeof createInterface> | null,
  yes: boolean
): Promise<Map<string, string>> {
  const values = new Map<string, string>();

  for (const { name, configs, service } of ALL_SERVICE_CONFIGS) {
    console.log(chalk.yellow(`${name} Variables:`));

    for (const config of configs) {
      const key = service !== null ? `${service}:${config.key}` : config.key;
      let value = localEnv.get(config.key);

      if ((value === undefined || value.length === 0) && config.defaultValue !== undefined) {
        value = config.defaultValue;
      }

      if ((value === undefined || value.length === 0) && !yes && rl !== null) {
        value = await promptForValue(rl, config, value);
      }

      if (value !== undefined && value.length > 0) {
        values.set(key, value);
        const display = config.isSecret ? chalk.dim('***set***') : value;
        console.log(`  ${chalk.green('✓')} ${config.key}: ${display}`);
      } else if (config.required) {
        console.log(`  ${chalk.red('✗')} ${config.key}: ${chalk.red('MISSING (required)')}`);
      } else {
        console.log(`  ${chalk.dim('○')} ${config.key}: ${chalk.dim('not set (optional)')}`);
      }
    }
    console.log();
  }

  return values;
}

/**
 * Validate all required variables are present
 */
function validateRequiredVariables(values: Map<string, string>): void {
  const missing: string[] = [];

  for (const { configs, service } of ALL_SERVICE_CONFIGS) {
    for (const config of configs) {
      if (config.required) {
        const key = service !== null ? `${service}:${config.key}` : config.key;
        if (!values.has(key) || values.get(key)?.length === 0) {
          missing.push(config.key);
        }
      }
    }
  }

  if (missing.length > 0) {
    console.error(chalk.red('❌ Missing required variables:'));
    for (const key of missing) {
      console.error(chalk.red(`   - ${key}`));
    }
    console.error(
      chalk.dim('\nSet these in your .env file or remove --yes to enter them interactively.')
    );
    process.exit(1);
  }

  console.log(chalk.green('✓') + ' All required variables are set\n');
}

/**
 * Set a variable via Railway CLI
 */
function setVariable(
  env: Exclude<Environment, 'local'>,
  service: string | null,
  key: string,
  value: string,
  dryRun: boolean
): void {
  const railwayEnv = getRailwayEnvName(env);

  if (dryRun) {
    const scope = service !== null ? `${service}` : 'shared';
    console.log(chalk.blue(`[DRY RUN]`) + ` Would set ${scope} variable: ${chalk.green(key)}`);
    return;
  }

  try {
    // Use execFileSync with array args to prevent command injection
    // Value could contain shell metacharacters from .env file
    const args = ['variables', '--environment', railwayEnv];
    if (service !== null) {
      args.push('--service', service);
    }
    args.push('--set', `${key}=${value}`);

    execFileSync('railway', args, { stdio: 'pipe' });

    const scope = service !== null ? `${service}` : 'shared';
    console.log(`  Set ${scope} variable: ${chalk.green(key)}`);
  } catch (error) {
    console.error(
      chalk.red(
        `  Failed to set ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    );
  }
}

/**
 * Apply all collected variables to Railway
 */
function applyVariables(
  env: Exclude<Environment, 'local'>,
  values: Map<string, string>,
  dryRun: boolean
): void {
  console.log(chalk.blue('━'.repeat(60)));
  console.log(chalk.blue('Setting Variables'));
  console.log(chalk.blue('━'.repeat(60)));
  console.log();

  for (const { name, configs, service } of ALL_SERVICE_CONFIGS) {
    console.log(chalk.yellow(`Setting ${name} variables...`));

    for (const config of configs) {
      const key = service !== null ? `${service}:${config.key}` : config.key;
      const value = values.get(key);

      if (value !== undefined && value.length > 0) {
        const railwayKey = config.targetKey ?? config.key;
        setVariable(env, service, railwayKey, value, dryRun);
      }
    }
    console.log();
  }
}

/**
 * Prompt for confirmation before applying changes
 */
async function confirmChanges(railwayEnv: string): Promise<boolean> {
  const confirmRl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    console.log(chalk.yellow(`⚠  This will set variables in Railway ${railwayEnv} environment`));
    confirmRl.question('Continue? (yes/no): ', answer => {
      confirmRl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Print summary after completion
 */
function printSummary(railwayEnv: string, dryRun: boolean): void {
  console.log(chalk.blue('━'.repeat(60)));
  if (dryRun) {
    console.log(chalk.green('✓ Dry run complete'));
    console.log(chalk.dim('\nRun without --dry-run to actually set these variables.'));
  } else {
    console.log(chalk.green('✓ All variables set successfully'));
    console.log(chalk.dim('\nNext steps:'));
    console.log(chalk.dim(`  1. Verify: railway variables --environment ${railwayEnv}`));
    console.log(chalk.dim('  2. Services will redeploy automatically'));
  }
  console.log(chalk.blue('━'.repeat(60)));
}

/**
 * Main setup function
 */
export async function setupRailwayVariables(options: SetupOptions): Promise<void> {
  const { env, dryRun, yes } = options;
  const railwayEnv = getRailwayEnvName(env);

  // Header
  console.log(chalk.blue('\n╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.blue('║       Railway Variables Setup - Tzurot v3                  ║'));
  console.log(chalk.blue('╚════════════════════════════════════════════════════════════╝'));
  console.log();

  if (dryRun) {
    console.log(chalk.yellow('[DRY RUN MODE] No changes will be made\n'));
  }

  // Validate environment
  validateRailwayEnvironment();
  console.log(chalk.yellow(`\nTarget environment: ${railwayEnv.toUpperCase()}\n`));

  // Read local .env file
  const localEnv = parseEnvFile('.env');
  console.log(chalk.dim(`Read ${localEnv.size} variables from .env\n`));

  // Collect values
  let rl: ReturnType<typeof createInterface> | null = null;
  if (!yes) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
  }

  const values = await collectVariableValues(localEnv, rl, yes);
  rl?.close();

  // Validate required variables
  validateRequiredVariables(values);

  // Confirmation
  if (!yes && !dryRun) {
    const confirmed = await confirmChanges(railwayEnv);
    if (!confirmed) {
      console.log('Aborted.');
      return;
    }
    console.log();
  }

  // Apply variables
  applyVariables(env, values, dryRun);

  // Summary
  printSummary(railwayEnv, dryRun);
}
