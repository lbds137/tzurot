/**
 * Deployment CLI commands
 */

import type { CAC } from 'cac';

import { parseIntFlag, rawOptionValue } from '../utils/cli-args.js';
import { UsageError } from '../utils/errors.js';

const ENV_OPTION = '--env <env>';

/** Shared message for the repeated dev/prod `--env` check below. */
const ENV_DEV_PROD_ERROR = '--env must be "dev" or "prod"';

/** Throws `UsageError` unless `env` is one of the two Railway-backed environments. */
function assertDevProdEnv(env: string): asserts env is 'dev' | 'prod' {
  if (env !== 'dev' && env !== 'prod') {
    throw new UsageError(ENV_DEV_PROD_ERROR);
  }
}

/**
 * Default `maintenance --drain-timeout`, in seconds. Named so the cac option
 * default and the post-parse fallback cannot drift apart.
 */
const DRAIN_TIMEOUT_DEFAULT_SEC = 120;

function registerMaintenanceCommand(cli: CAC): void {
  cli
    .command('maintenance <action>', 'Toggle maintenance mode (on | off | status)')
    .option(ENV_OPTION, 'Target environment (local, dev, or prod)', { default: 'dev' })
    .option('--skip-drain', 'Skip waiting for active BullMQ jobs to finish after "on"', {
      default: false,
    })
    .option('--drain-timeout <seconds>', 'Max seconds to wait for the queue to drain', {
      default: DRAIN_TIMEOUT_DEFAULT_SEC,
    })
    .example('pnpm ops maintenance status --env prod')
    .example('pnpm ops maintenance on --env prod')
    .example('pnpm ops maintenance off --env prod')
    .action(
      async (
        action: string,
        options: { env: string; skipDrain: boolean; drainTimeout: number }
      ) => {
        if (action !== 'on' && action !== 'off' && action !== 'status') {
          throw new UsageError('action must be "on", "off", or "status"');
        }
        if (options.env !== 'local' && options.env !== 'dev' && options.env !== 'prod') {
          throw new UsageError('--env must be "local", "dev", or "prod"');
        }

        const { runMaintenance } = await import('../deployment/maintenance.js');
        // A malformed timeout is a usage error, not a fall-back: `waited >=
        // NaN` is always false, so an unfiltered NaN deadline polls forever,
        // and silently substituting the default hides that the operator's
        // intended (probably longer) window was never applied.
        const drainTimeoutSec =
          parseIntFlag(options.drainTimeout, '--drain-timeout', { min: 1 }) ??
          DRAIN_TIMEOUT_DEFAULT_SEC;
        process.exitCode = await runMaintenance(action, {
          env: options.env,
          skipDrain: options.skipDrain,
          drainTimeoutSec,
        });
      }
    );
}

function registerVarDeleteCommand(cli: CAC): void {
  cli
    .command('deploy:var-delete', 'Delete a Railway environment variable (the CLI cannot)')
    .option(ENV_OPTION, 'Target environment (dev or prod)', { default: 'dev' })
    .option('--service <service>', 'Service name whose variable to delete (or --shared, not both)')
    .option('--shared', 'Delete a shared (project-level) variable instead of a service variable', {
      default: false,
    })
    .option('--name <name>', 'Variable key to delete')
    .option(
      '--dry-run',
      'Show what would be deleted without calling the API (still reads railway status)',
      { default: false }
    )
    .option('--yes, -y', 'Skip the confirmation prompt', { default: false })
    .example('pnpm ops deploy:var-delete --env dev --service bot-client --name SOME_KEY --dry-run')
    .example('pnpm ops deploy:var-delete --env prod --shared --name SOME_KEY')
    .action(
      async (options: {
        env: string;
        service?: string;
        shared: boolean;
        name?: string;
        dryRun: boolean;
        yes: boolean;
      }) => {
        assertDevProdEnv(options.env);
        const name = options.name === undefined ? '' : String(options.name);
        if (name.length === 0) {
          throw new UsageError('--name <KEY> is required');
        }
        const hasService = options.service !== undefined;
        // Equal means both set or neither set — exactly one of the two is required.
        if (hasService === options.shared) {
          throw new UsageError('pass exactly one of --service <name> or --shared');
        }

        const { runVarDelete } = await import('../deployment/var-delete.js');
        await runVarDelete({
          env: options.env,
          service: options.shared ? null : String(options.service),
          name,
          dryRun: options.dryRun,
          yes: options.yes,
        });
      }
    );
}

export function registerDeployCommands(cli: CAC): void {
  cli.command('deploy:dev', 'Deploy to Railway development environment').action(async () => {
    const { deployDev } = await import('../deployment/deploy-dev.js');
    await deployDev();
  });

  cli.command('deploy:verify', 'Verify build before deployment').action(async () => {
    const { verifyBuild } = await import('../deployment/verify-build.js');
    await verifyBuild();
  });

  cli.command('deploy:update-gateway', 'Update gateway URL in Railway').action(async () => {
    const { updateGatewayUrl } = await import('../deployment/update-gateway-url.js');
    await updateGatewayUrl();
  });

  cli
    .command('deploy:setup-vars', 'Set up Railway environment variables from .env')
    .option(ENV_OPTION, 'Target environment (dev or prod)', { default: 'dev' })
    .option('--dry-run', 'Show what would be set without making changes', { default: false })
    .option('--yes, -y', 'Skip confirmation prompts', { default: false })
    .action(async (options: { env: string; dryRun: boolean; yes: boolean }) => {
      assertDevProdEnv(options.env);

      const { setupRailwayVariables } = await import('../deployment/setup-railway-variables.js');
      await setupRailwayVariables({
        env: options.env,
        dryRun: options.dryRun,
        yes: options.yes,
      });
    });

  registerVarDeleteCommand(cli);

  registerMaintenanceCommand(cli);

  cli
    .command('logs', 'Fetch logs from Railway services')
    .option(ENV_OPTION, 'Environment (dev or prod)', { default: 'dev' })
    .option('--service <service>', 'Service name (bot-client, api-gateway, ai-worker)')
    .option('--lines <n>', 'Number of lines to fetch (capped at ~5000 by the Railway CLI)')
    .option('--filter <text>', 'Server-side Railway query DSL (@level:error, "a AND b")')
    .option('--request-id <id>', 'Incident dig: local-match a request ID across app services')
    .option(
      '--job-id <id>',
      'Incident dig: local-match a BullMQ job ID across app services (short numeric IDs may substring-match unrelated numbers; prefer --request-id when both are known)'
    )
    .option(
      '--since <when>',
      'Time floor: ISO-8601 or relative (45m, 6h, 2d); enters dig mode (5000-line window, sweeps app services unless --service)'
    )
    .option('--follow', 'Follow logs in real-time')
    .example('ops logs --env dev')
    .example('ops logs --env dev --service api-gateway')
    .example('ops logs --env prod --request-id f333a5db-1234-5678-9abc-def012345678')
    .example('ops logs --env prod --job-id 42317 --since 2h')
    .action(
      async (options: {
        env: string;
        service?: string;
        lines?: number;
        filter?: string;
        // requestId / jobId are deliberately absent: they are read from argv
        // below rather than from cac's parsed (and possibly truncated) values.
        since?: string;
        follow?: boolean;
      }) => {
        assertDevProdEnv(options.env);

        const { fetchLogs } = await import('../deployment/logs.js');
        await fetchLogs({
          env: options.env,
          service: options.service,
          // No ceiling here: logs.ts clamps an over-large window to the
          // Railway CLI cap with a warning, which is friendlier than a hard
          // usage error for a flag whose cap is an external tool's limit.
          lines: parseIntFlag(options.lines, '--lines', { min: 1 }),
          filter: options.filter,
          // Read verbatim from argv: CAC auto-casts all-digit values to Number,
          // which silently truncates a job id past 2^53 (a snowflake) to a
          // different, still-snowflake-shaped id. Stringifying the parsed value
          // is too late — the digits are gone before cac hands it over.
          requestId: rawOptionValue(process.argv, '--request-id'),
          jobId: rawOptionValue(process.argv, '--job-id'),
          since: options.since === undefined ? undefined : String(options.since),
          follow: options.follow,
        });
      }
    );
}
