/**
 * Secret-rotation commands: the per-environment rotation ledger and the
 * staged BYOK encryption-key rotation. Implementation + rationale in
 * ../secrets/rotation.ts.
 */

import type { CAC } from 'cac';
import type { SecretsEnv } from '../secrets/rotation.js';

const ENV_OPTION_FLAG = '--env <env>';
const ENV_OPTION_HELP = 'Target environment: dev | prod';
const ENV_DEFAULT = { default: 'dev' };

/** One lazy-import site so the module path literal exists exactly once. */
async function loadRotation(): Promise<typeof import('../secrets/rotation.js')> {
  return import('../secrets/rotation.js');
}

export function registerSecretsCommands(cli: CAC): void {
  cli
    .command(
      'secrets:mark-rotated <name>',
      'Stamp the rotation ledger: <name> was rotated now (manual rotations)'
    )
    .option(ENV_OPTION_FLAG, ENV_OPTION_HELP, ENV_DEFAULT)
    .option('--interval <days>', 'Override the rotation interval in days')
    .example('ops secrets:mark-rotated internal-service-secret --env prod')
    .action(async (name: string, options: { env: SecretsEnv; interval?: string }) => {
      let intervalDays: number | undefined;
      if (options.interval !== undefined) {
        // Strict parse: a malformed value must be a usage error here, not a
        // NaN that only fails downstream at the Prisma write.
        intervalDays = Number(options.interval);
        if (!Number.isInteger(intervalDays) || intervalDays <= 0) {
          throw new Error(`--interval must be a positive integer, got "${options.interval}"`);
        }
      }
      const { markSecretRotated } = await loadRotation();
      await markSecretRotated({ env: options.env, name, intervalDays });
    });

  cli
    .command('secrets:rotation-status', 'Show the rotation ledger with overdue state')
    .option(ENV_OPTION_FLAG, ENV_OPTION_HELP, ENV_DEFAULT)
    .example('ops secrets:rotation-status --env prod')
    .action(async (options: { env: SecretsEnv }) => {
      const { showRotationStatus } = await loadRotation();
      await showRotationStatus({ env: options.env });
    });

  cli
    .command(
      'secrets:rotate-byok',
      'Staged BYOK encryption-key rotation (1=stage keys, 2=reencrypt rows, 3=finalize)'
    )
    .option(ENV_OPTION_FLAG, ENV_OPTION_HELP, ENV_DEFAULT)
    .option('--stage <stage>', 'Rotation stage: 1|stage, 2|reencrypt, 3|finalize')
    .example('ops secrets:rotate-byok --env prod --stage 1')
    .action(async (options: { env: SecretsEnv; stage?: string }) => {
      if (options.stage === undefined) {
        throw new Error('--stage is required (1|stage, 2|reencrypt, 3|finalize)');
      }
      const { rotateByokKey } = await loadRotation();
      await rotateByokKey({ env: options.env, stage: options.stage });
    });
}
