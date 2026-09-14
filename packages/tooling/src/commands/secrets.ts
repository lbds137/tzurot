/**
 * Secret-rotation commands: the per-environment rotation ledger, the staged
 * BYOK encryption-key rotation, and shared Railway secret rotation.
 * Implementation + rationale in ../secrets/rotation.ts and
 * ../secrets/rotate-env-secret.ts.
 */

import type { CAC } from 'cac';
import type { SecretsEnv } from '../secrets/rotation.js';
import { parseIntFlag } from '../utils/cli-args.js';
import { UsageError } from '../utils/errors.js';

const ENV_OPTION_FLAG = '--env <env>';
const ENV_OPTION_HELP = 'Target environment: dev | prod';
const ENV_DEFAULT = { default: 'dev' };

/** One lazy-import site so the module path literal exists exactly once. */
async function loadRotation(): Promise<typeof import('../secrets/rotation.js')> {
  return import('../secrets/rotation.js');
}

/**
 * A separate lazy-import site from `loadRotation()` above, deliberately: this
 * module (`rotate-env-secret.js`) does not import Prisma-heavy `rotation.js`
 * at CLI startup, so keeping its own dynamic import avoids paying that cost
 * for commands that never touch it.
 */
async function loadRotateEnvSecret(): Promise<typeof import('../secrets/rotate-env-secret.js')> {
  return import('../secrets/rotate-env-secret.js');
}

/**
 * cac's underlying parser (mri) runs `Number(x)` on a flag value, so `--stage 1`
 * arrives as the NUMBER 1 and a whitespace-only value as the NUMBER 0 — a bare
 * `options.stage` would never match a string stage alias. Normalizing to a
 * trimmed string is what makes the numeric forms (`--stage 1`) work at all.
 *
 * A whitespace-only value, an empty value, and an explicit `--stage 0` all
 * arrive here as the number 0 — mri coerces all three identically, before
 * this function ever sees them — so they are indistinguishable at this
 * layer. Every one of them still refuses downstream as `Unknown stage "0"`;
 * a more precise "--stage is required" message for the whitespace/empty
 * cases is not reachable without the pre-coercion text, which this layer
 * does not have.
 *
 * A valueless flag (bare `--stage` with nothing after it) never reaches this
 * function at all: probed against the installed cac, `<stage>`'s angle
 * brackets declare the value required, and cac throws a `CACError` in its
 * own option-parsing step before the action handler runs. So `raw` here is
 * never the boolean `true` a bracket-less `[stage]` declaration would allow
 * — this function needs no guard for that shape as written, but the
 * angle-bracket form is what makes that true, so a future change to
 * `[stage]` would silently invalidate this note.
 */
function normalizeStageFlag(raw: string | number | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const text = (typeof raw === 'number' ? String(raw) : raw).trim();
  return text.length === 0 ? undefined : text;
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
      // Strict parse: a malformed value must be a usage error here, not a
      // NaN that only fails downstream at the Prisma write.
      const intervalDays = parseIntFlag(options.interval, '--interval', { min: 1 });
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
    .action(async (options: { env: SecretsEnv; stage?: string | number }) => {
      const stage = normalizeStageFlag(options.stage);
      if (stage === undefined) {
        throw new UsageError('--stage is required (1|stage, 2|reencrypt, 3|finalize)');
      }
      const { rotateByokKey } = await loadRotation();
      await rotateByokKey({ env: options.env, stage });
    });

  cli
    .command(
      'secrets:rotate-env',
      'Rotate a shared Railway secret: generate, upsert, redeploy inheritors, stamp the ledger'
    )
    .option(ENV_OPTION_FLAG, ENV_OPTION_HELP, ENV_DEFAULT)
    .option('--name <name>', 'Shared variable to rotate (e.g. INTERNAL_SERVICE_SECRET)')
    .option(
      '--stage <stage>',
      'Rotation stage for a dual-accepting name: 1|stage, 2|roll, 3|finalize'
    )
    .option('--dry-run', 'Print the plan and exit without changing anything')
    .option('--yes', 'Skip the confirmation prompt (dev only; refused on prod)')
    .example('ops secrets:rotate-env --env dev --name INTERNAL_SERVICE_SECRET --dry-run')
    .example('ops secrets:rotate-env --env dev --name INTERNAL_SERVICE_SECRET --stage 1 --dry-run')
    .action(
      async (options: {
        env: SecretsEnv;
        name?: string;
        stage?: string | number;
        dryRun?: boolean;
        yes?: boolean;
      }) => {
        // cac's underlying parser (mri) coerces a whitespace-only or empty flag value to the
        // NUMBER 0 via `Number(x)` rather than leaving it a string, so the `typeof` guard below
        // is load-bearing, not defensive filler.
        const name = typeof options.name === 'string' ? options.name.trim() : undefined;
        if (name === undefined || name.length === 0) {
          throw new UsageError(
            '--name is required (the shared variable to rotate, e.g. INTERNAL_SERVICE_SECRET)'
          );
        }
        const stage = normalizeStageFlag(options.stage);
        const { runRotateEnvSecret } = await loadRotateEnvSecret();
        await runRotateEnvSecret({
          env: options.env,
          name,
          stage,
          dryRun: options.dryRun === true,
          yes: options.yes === true,
        });
      }
    );
}
