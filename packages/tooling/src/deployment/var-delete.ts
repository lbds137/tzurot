/**
 * `pnpm ops deploy:var-delete` — deletes one Railway environment variable via
 * the public GraphQL API, since the Railway CLI has no delete command.
 */

import chalk from 'chalk';

import { requireRailwayApiToken, deleteRailwayVariable } from './railway-api.js';
import { resolveRailwayIds } from './railway-status.js';
import { confirmPrompt } from '../utils/confirm.js';
import { getRailwayEnvName } from '../utils/env-runner.js';

export interface VarDeleteOptions {
  env: 'dev' | 'prod';
  /** `null` means a shared (project-level) variable, not a service one. */
  service: string | null;
  name: string;
  dryRun: boolean;
  yes: boolean;
}

/**
 * Order matters: the token check runs BEFORE resolving Railway ids, so a
 * missing token fails fast without ever calling `railway status`. Resolving
 * the ids does shell out to `railway status --json` (a network-backed CLI
 * call that needs a linked, logged-in checkout), including on a dry run; the
 * scope plan is printed before any GraphQL call, and a dry run returns before
 * `deleteRailwayVariable` — hence before any fetch — is reached.
 */
export async function runVarDelete(options: VarDeleteOptions): Promise<void> {
  requireRailwayApiToken();

  const { projectId, environmentId, serviceId } = resolveRailwayIds(options.env, options.service);

  const railwayEnvName = getRailwayEnvName(options.env);
  const scopeLabel =
    options.service === null ? 'shared (project-level)' : `service ${options.service}`;
  console.log(chalk.yellow(`\nAbout to delete Railway variable "${options.name}"`));
  console.log(chalk.dim(`  Environment: ${railwayEnvName}`));
  console.log(chalk.dim(`  Scope: ${scopeLabel}`));

  if (options.dryRun) {
    console.log(chalk.green('\n[DRY RUN] No changes made.'));
    return;
  }

  if (!options.yes) {
    const confirmed = await confirmPrompt('This will permanently delete the variable above.');
    if (!confirmed) {
      console.log('Aborted.');
      return;
    }
  }

  await deleteRailwayVariable({
    projectId,
    environmentId,
    ...(serviceId === undefined ? {} : { serviceId }),
    name: options.name,
  });

  console.log(chalk.green(`\n✓ Deleted "${options.name}" from Railway ${railwayEnvName}`));
  console.log(
    chalk.dim(
      'Railway is documented to redeploy services automatically when variables change ' +
        '(docs/reference/RAILWAY_CLI_REFERENCE.md); not probed here.'
    )
  );
}
