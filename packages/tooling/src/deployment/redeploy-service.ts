/**
 * `pnpm ops deploy:redeploy` — redeploys one Railway service by reusing its
 * current image via the public GraphQL API, targeting the explicit `--env`
 * rather than the CLI's linked environment.
 */

import chalk from 'chalk';

import {
  requireRailwayApiToken,
  assertRailwayServiceDeploymentReady,
  redeployRailwayServiceReusingImage,
} from './railway-api.js';
import { resolveRailwayIds } from './railway-status.js';
import { confirmPrompt } from '../utils/confirm.js';
import { getRailwayEnvName } from '../utils/env-runner.js';

export interface RedeployServiceOptions {
  env: 'dev' | 'prod';
  service: string;
  dryRun: boolean;
  yes: boolean;
}

/**
 * Redeploy one service in the target Railway environment.
 *
 * Checks the API token before calling `resolveRailwayIds`, returns on
 * `--dry-run` before any GraphQL call, and verifies deployment readiness via
 * `assertRailwayServiceDeploymentReady` before calling
 * `redeployRailwayServiceReusingImage` (pinned in `redeploy-service.test.ts`).
 */
export async function runRedeployService(options: RedeployServiceOptions): Promise<void> {
  requireRailwayApiToken(options.env);

  const { environmentId, serviceId } = resolveRailwayIds(options.env, options.service);
  if (serviceId === undefined) {
    throw new Error(
      `Railway service "${options.service}" resolved without a service id (${options.env})`
    );
  }

  const railwayEnvName = getRailwayEnvName(options.env);
  console.log(chalk.yellow(`\nAbout to redeploy Railway service "${options.service}"`));
  console.log(chalk.dim(`  Environment: ${railwayEnvName}`));

  if (options.dryRun) {
    console.log(chalk.green('\n[DRY RUN] No changes made.'));
    return;
  }

  if (!options.yes) {
    const confirmed = await confirmPrompt(
      'This will redeploy the service above by reusing its running image.'
    );
    if (!confirmed) {
      console.log('Aborted.');
      return;
    }
  }

  await assertRailwayServiceDeploymentReady({
    environmentId,
    serviceId,
    serviceName: options.service,
    env: options.env,
  });

  const deploymentId = await redeployRailwayServiceReusingImage({
    environmentId,
    serviceId,
    env: options.env,
  });

  console.log(
    chalk.green(
      `\n✓ Redeployed "${options.service}" in Railway ${railwayEnvName} (deployment ${deploymentId})`
    )
  );
}
