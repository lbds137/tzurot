/**
 * The repair sentences for a service whose redeploy failed, built in one place
 * for every rotation path (single-shot, staged env, staged BYOK). A leaf with
 * respect to the rotation modules: it imports only the railway-api error class,
 * so the context, staged-env and BYOK helpers can all depend on it without
 * pulling in the rotation ledger (and its Prisma graph).
 */

import { RailwayRedeployRefusedError } from '../deployment/railway-api.js';

export interface RedeployFailure {
  name: string;
  error: unknown;
}

/**
 * Split redeploy failures for the repair text. A failure the redeploy helper
 * REFUSED (`RailwayRedeployRefusedError`: no SUCCESS latest deployment) is sent
 * to the dashboard first — `deploy:redeploy` refuses it for the same reason —
 * and the redeploy command follows as the retry once it settles. `commands`
 * lists only the other failures and `plainNames` names them; `refusedRepair`
 * (null when none were refused) covers the refused ones.
 */
export function partitionRedeployFailures(
  failures: RedeployFailure[],
  env: 'dev' | 'prod'
): { refusedRepair: string | null; commands: string; plainNames: string[] } {
  const isRefused = (f: RedeployFailure): boolean => f.error instanceof RailwayRedeployRefusedError;
  const commandsFor = (list: RedeployFailure[]): string =>
    list.map(f => `\`pnpm ops deploy:redeploy --env ${env} --service ${f.name} --yes\``).join('; ');
  const refused = failures.filter(isRefused);
  const refusedRepair =
    refused.length === 0
      ? null
      : refusedRedeployRepair(
          refused.map(f => f.name),
          commandsFor(refused)
        );
  const plain = failures.filter(f => !isRefused(f));
  return {
    refusedRepair,
    commands: commandsFor(plain),
    plainNames: plain.map(f => f.name),
  };
}

/**
 * The repair for services whose redeploy was REFUSED (the helper refuses a
 * latest deployment that is not SUCCESS; `deploy:redeploy` refuses it for the
 * same reason, so the dashboard comes first). `redeployCommands` is appended as
 * the retry once the deployment has settled, followed by the instruction to
 * wait for that redeploy to reach SUCCESS (`deploy:redeploy` returns right
 * after triggering it), so the text asks the operator to wait before taking the
 * caller's next step (the ledger stamp); it cannot enforce that.
 */
function refusedRedeployRepair(names: string[], redeployCommands: string): string {
  const plural = names.length > 1;
  const pronoun = plural ? 'them' : 'it';
  const waitClause = plural ? 'wait for each to reach SUCCESS' : 'wait for it to reach SUCCESS';
  return (
    `${names.join(', ')}: the redeploy was refused because the latest deployment is not SUCCESS — ` +
    `wait for it to settle, or fix it in the Railway dashboard, then redeploy ${pronoun} with ${redeployCommands}, ${waitClause}`
  );
}

/**
 * Join the refused-service repair with the repair for the other failures.
 * `refusedRepair` null means nothing was refused (the plain repair stands
 * alone); empty `commands` means every failure was refused (the plain repair
 * would name no service, so it is dropped). The plain repair is joined after
 * "for the rest:", so its first letter is lowercased there; alone it is
 * returned untouched.
 */
export function composeRedeployRepair(
  refusedRepair: string | null,
  commands: string,
  plainRepair: string
): string {
  if (refusedRepair === null) {
    return plainRepair;
  }
  if (commands === '') {
    return refusedRepair;
  }
  return `${refusedRepair}; for the rest: ${plainRepair.charAt(0).toLowerCase()}${plainRepair.slice(1)}`;
}
