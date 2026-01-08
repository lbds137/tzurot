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
}
