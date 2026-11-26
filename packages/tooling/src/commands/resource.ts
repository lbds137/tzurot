/**
 * Resource-profile commands.
 *
 * `resource:env` prints the env additions the exec wrapper would export for
 * the resolved profile — the contract for consumers that cannot run commands
 * through `tsx packages/tooling/src/resource/exec.ts` (a hook eval'ing the sh
 * output before a bare `pnpm lint`, or CI reading the resolved knobs as JSON).
 *
 * cli.ts has already merged .env into process.env by the time this runs, so
 * the resolver is fed `profileEnvView(process.env)` (the two profile keys as
 * the shell held them before dotenv) plus the key-scoped `readEnvFileValues`,
 * which keeps the documented order: shell env above `.env`, and the worktree
 * fallback for keys the local .env does not carry. The output carries profile
 * knob values only — the reader never loads other .env keys.
 */
import type { CAC } from 'cac';

import { readEnvFileValues, type EnvFileValues } from '../resource/envFile.js';
import { profileEnvView } from '../resource/preDotenvEnv.js';
import { liveMachineFacts } from '../resource/machineFacts.js';
import {
  buildProfileEnv,
  formatProfileLine,
  resolveResourceProfile,
  type ProfileKnobs,
  type ResourceProfile,
} from '../resource/profile.js';
import { UsageError } from '../utils/errors.js';

export interface ResourceEnvInput {
  env: Record<string, string | undefined>;
  envFileValues?: EnvFileValues;
  cpus: number;
  memTotalBytes: number;
}

export interface ResourceEnvOutput {
  profile: ResourceProfile;
  trigger: string;
  knobs: ProfileKnobs;
  env: Record<string, string>;
}

/** Single-quote escaping for sh: close the quote, insert an escaped literal quote, reopen. */
export function shSingleQuote(value: string): string {
  return value.replaceAll("'", `'\\''`);
}

export function renderResourceEnv(format: 'sh' | 'json', input: ResourceEnvInput): string {
  const resolved = resolveResourceProfile(input);
  const additions = buildProfileEnv(resolved, input.env);
  if (format === 'json') {
    const output: ResourceEnvOutput = {
      profile: resolved.profile,
      trigger: resolved.trigger,
      knobs: resolved.knobs,
      env: additions,
    };
    return JSON.stringify(output, null, 2);
  }
  const lines = [`# ${formatProfileLine(resolved)}`];
  for (const [key, value] of Object.entries(additions)) {
    lines.push(`export ${key}='${shSingleQuote(value)}'`);
  }
  return lines.join('\n');
}

/** Action body, separated from cac so tests can inject env/cpus/memory. */
export function runResourceEnvCommand(
  options: { format?: string },
  input?: ResourceEnvInput
): void {
  const format = options.format ?? 'sh';
  if (format !== 'sh' && format !== 'json') {
    throw new UsageError(`--format must be sh or json, got '${format}'`);
  }
  const envInput: ResourceEnvInput = input ?? {
    env: profileEnvView(process.env),
    envFileValues: readEnvFileValues(process.cwd()),
    ...liveMachineFacts(),
  };
  console.log(renderResourceEnv(format, envInput));
}

export function registerResourceCommands(cli: CAC): void {
  cli
    .command('resource:env', 'Print the resource-profile env additions for eval or export')
    .option('--format <fmt>', "'sh' (default, eval-able exports) or 'json'", { default: 'sh' })
    .action(runResourceEnvCommand);
}
