/**
 * Deployment CLI commands
 */

import type { CAC } from 'cac';

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
    .option('--env <env>', 'Target environment (dev or prod)', { default: 'dev' })
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

  cli
    .command('logs', 'Fetch logs from Railway services')
    .option('--env <env>', 'Environment (dev or prod)', { default: 'dev' })
    .option('--service <service>', 'Service name (bot-client, api-gateway, ai-worker)')
    .option('--lines <n>', 'Number of lines to fetch', { default: 100 })
    .option('--filter <text>', 'Filter logs by text or level (error, warn, info, debug)')
    .option('--follow', 'Follow logs in real-time')
    .example('ops logs --env dev')
    .example('ops logs --env dev --service api-gateway')
    .example('ops logs --env dev --filter error')
    .example('ops logs --env dev --follow')
    .action(
      async (options: {
        env: string;
        service?: string;
        lines: number;
        filter?: string;
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
          lines: options.lines,
          filter: options.filter,
          follow: options.follow,
        });
      }
    );
}
