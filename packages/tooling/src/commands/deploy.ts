/**
 * Deployment CLI commands
 */

import type { CAC } from 'cac';

const ENV_OPTION = '--env <env>';

function registerMaintenanceCommand(cli: CAC): void {
  cli
    .command('maintenance <action>', 'Toggle maintenance mode (on | off | status)')
    .option(ENV_OPTION, 'Target environment (local, dev, or prod)', { default: 'dev' })
    .option('--skip-drain', 'Skip waiting for active BullMQ jobs to finish after "on"', {
      default: false,
    })
    .option('--drain-timeout <seconds>', 'Max seconds to wait for the queue to drain', {
      default: 120,
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
          console.error('Error: action must be "on", "off", or "status"');
          process.exit(1);
        }
        if (options.env !== 'local' && options.env !== 'dev' && options.env !== 'prod') {
          console.error('Error: --env must be "local", "dev", or "prod"');
          process.exit(1);
        }

        const { runMaintenance } = await import('../deployment/maintenance.js');
        // NaN-guard: `Number('abc')` is NaN, and `waited >= NaN` is always
        // false — an unfiltered NaN deadline would poll forever. Fall back to
        // the command default instead.
        const drainTimeout = Number(options.drainTimeout);
        process.exitCode = await runMaintenance(action, {
          env: options.env,
          skipDrain: options.skipDrain,
          drainTimeoutSec: Number.isFinite(drainTimeout) ? drainTimeout : undefined,
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
      if (options.env !== 'dev' && options.env !== 'prod') {
        console.error('Error: --env must be "dev" or "prod"');
        process.exit(1);
      }

      const { setupRailwayVariables } = await import('../deployment/setup-railway-variables.js');
      await setupRailwayVariables({
        env: options.env,
        dryRun: options.dryRun,
        yes: options.yes,
      });
    });

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
        requestId?: string;
        jobId?: string;
        since?: string;
        follow?: boolean;
      }) => {
        if (options.env !== 'dev' && options.env !== 'prod') {
          console.error('Error: --env must be "dev" or "prod"');
          process.exit(1);
        }

        const { fetchLogs } = await import('../deployment/logs.js');
        await fetchLogs({
          env: options.env,
          service: options.service,
          lines: options.lines === undefined ? undefined : Number(options.lines),
          filter: options.filter,
          // CAC auto-casts all-digit values to Number; an unstringed ID would
          // silently fail logs.ts's `typeof === 'string'` term filter.
          requestId: options.requestId === undefined ? undefined : String(options.requestId),
          jobId: options.jobId === undefined ? undefined : String(options.jobId),
          since: options.since === undefined ? undefined : String(options.since),
          follow: options.follow,
        });
      }
    );
}
