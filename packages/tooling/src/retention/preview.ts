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
import { resolveServiceClientOrExit } from '../utils/gateway-client.js';

export interface RetentionPreviewOptions {
  env: Environment;
}

/** Human-readable eligibility reason. */
const REASON_LABEL: Record<RetentionPreviewResponse['users'][number]['reason'], string> = {
  unreachable: 'DMs closed / left every shared server',
  account_gone: 'Discord account deleted',
  grace_expired: 'warned, grace window expired',
};

/** The reachable branch's pipeline states — printed on both cohort branches. */
function renderReachableBranch(totals: RetentionPreviewResponse['totals']): void {
  // All THREE counts gate the line: grace-expired users left the other two
  // counts (window passed, already warned), so a graceExpired-only steady
  // state is real and must still render.
  if (totals.reachableToNotify === 0 && totals.inGrace === 0 && totals.graceExpired === 0) {
    return;
  }
  console.log(
    `  reachable branch: ${String(totals.reachableToNotify)} awaiting a warning DM, ` +
      `${String(totals.inGrace)} in grace, ${String(totals.graceExpired)} grace-expired`
  );
}

/** Print the cohort report. Exported for testing without the transport. */
export function renderPreview(preview: RetentionPreviewResponse): void {
  const { users, totals } = preview;

  if (users.length === 0) {
    // Print the denominator even here: an "all clear" that shows no numbers is
    // indistinguishable from a query that silently returned nothing, which
    // undercuts the one job a read-only report has.
    console.log(
      chalk.green('\nNo users are purge-eligible — no inactive user is unreachable or past grace.')
    );
    console.log(chalk.dim(`  eligible: 0 of ${String(totals.userbaseCount)} users`));
    renderReachableBranch(totals);
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
  renderReachableBranch(totals);

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
  const client = resolveServiceClientOrExit(env);
  if (client === null) {
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
