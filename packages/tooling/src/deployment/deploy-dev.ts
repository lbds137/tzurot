/**
 * Deploy to Development
 *
 * Deploy to Railway development environment.
 *
 * TODO: Migrate from scripts/deployment/deploy-railway-dev.sh
 */

import chalk from 'chalk';

export async function deployDev(): Promise<void> {
  console.log(chalk.yellow('⚠️  deploy-dev not yet migrated to tooling package'));
  console.log(chalk.dim('   Original: scripts/deployment/deploy-railway-dev.sh'));
  console.log('\nFor now, use: ./scripts/deployment/deploy-railway-dev.sh');
}
