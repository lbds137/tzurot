/**
 * Update Gateway URL
 *
 * Update gateway URL in Railway environment.
 *
 * TODO: Migrate from scripts/deployment/update-gateway-url.sh
 */

import chalk from 'chalk';

export async function updateGatewayUrl(): Promise<void> {
  console.log(chalk.yellow('⚠️  update-gateway-url not yet migrated to tooling package'));
  console.log(chalk.dim('   Original: scripts/deployment/update-gateway-url.sh'));
  console.log('\nFor now, use: ./scripts/deployment/update-gateway-url.sh');
}
