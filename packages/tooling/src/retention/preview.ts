/**
 * `pnpm ops retention:preview` — the purge-eligible cohort, read-only.
 *
 * Reports who would be purged (unreachable/gone AND inactive past the retention
 * window), what would happen to the characters they own, and how large the
 * cohort is relative to the userbase. It mutates NOTHING — there is deliberately
 * no confirmation prompt, and it is safe to run against prod.
 *
 * The cohort comes from the gateway (`GET /internal/retention/preview`) rather
 * than a local query, so the operator reviews exactly the predicate the purge
 * will act on — re-deriving it here would fork the definition.
 */

import chalk from 'chalk';
import type { RetentionPreviewResponse } from '@tzurot/common-types/schemas/api/internal';
import {
  type Environment,
  validateEnvironment,
  showEnvironmentBanner,
} from '../utils/env-runner.js';
import { getServiceClientForEnv } from '../utils/gateway-client.js';

export interface RetentionPreviewOptions {
  env: Environment;
}

/** Human-readable eligibility reason. */
const REASON_LABEL: Record<RetentionPreviewResponse['users'][number]['reason'], string> = {
  unreachable: 'DMs closed / left every shared server',
  account_gone: 'Discord account deleted',
};

/** Print the cohort report. Exported for testing without the transport. */
export function renderPreview(preview: RetentionPreviewResponse): void {
  const { users, totals } = preview;

  if (users.length === 0) {
    console.log(
      chalk.green('\nNo users are purge-eligible — nobody is both unreachable and inactive.')
    );
    return;
  }

  console.log(chalk.bold('\nPurge-eligible cohort:'));
  for (const user of users) {
    const inactiveSince = user.inactiveSince.slice(0, 10);
    const characters =
      user.ownedCharacters.toDelete + user.ownedCharacters.toReHome === 0
        ? 'no characters'
        : `${user.ownedCharacters.toDelete} to delete, ${user.ownedCharacters.toReHome} to re-home`;
    console.log(
      `  ${user.discordId}  inactive since ${inactiveSince}  ` +
        `${chalk.dim(REASON_LABEL[user.reason])}  ${chalk.dim(`(${characters})`)}`
    );
  }

  console.log(chalk.bold('\nTotals:'));
  console.log(
    `  eligible: ${totals.eligibleCount} of ${totals.userbaseCount} users ` +
      `(${totals.percentOfUserbase}% of the userbase)`
  );
  console.log(
    `  characters: ${totals.charactersToDelete} would be deleted, ` +
      `${totals.charactersToReHome} would be re-homed to the Orphaned Characters bucket`
  );

  if (totals.breakerWarning) {
    console.log(
      chalk.red(
        `\n⚠️  Circuit-breaker warning: the cohort is ${totals.percentOfUserbase}% of the userbase. ` +
          'That is large enough to be a tracking-signal glitch rather than genuine churn — ' +
          'confirm the numbers before purging anything.'
      )
    );
  }

  console.log(chalk.dim('\nRead-only — nothing was deleted.'));
}

/** Entry point for `pnpm ops retention:preview`. */
export async function retentionPreview(options: RetentionPreviewOptions): Promise<void> {
  const { env } = options;
  validateEnvironment(env);
  showEnvironmentBanner(env);

  // No prod-confirm: the command is read-only by construction (D5).
  // Credential resolution can throw (Railway CLI not logged in, missing
  // variable) — surface it the same way as a failed call rather than as an
  // unhandled rejection.
  let client;
  try {
    client = getServiceClientForEnv(env);
  } catch (error) {
    console.error(chalk.red(`\n${error instanceof Error ? error.message : 'Unknown error'}`));
    process.exitCode = 1;
    return;
  }

  const result = await client.retentionPreview();

  if (!result.ok) {
    console.error(
      chalk.red(`\nFailed to fetch the retention preview (${result.kind}): ${result.error}`)
    );
    process.exitCode = 1;
    return;
  }

  renderPreview(result.data);
}
