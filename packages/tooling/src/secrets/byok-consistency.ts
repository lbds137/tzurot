/**
 * Cross-service consistency checks for the staged BYOK key rotation: the
 * split-brain detector over CURRENT / PREVIOUS / NEXT, and the refusals stages 2
 * and 3 raise while a staged NEXT is still present.
 *
 * A NEXT equal to that same service's CURRENT decrypts nothing CURRENT does not,
 * so it counts as unset in every stage's checks (`effectiveNext`). Messages carry service
 * names and commands only, never a key value.
 */

import { BYOK_SERVICES, CURRENT_VAR, NEXT_VAR, PREVIOUS_VAR } from './byok-stage-helpers.js';

/** Absent-tolerant variable read: a missing variable and an empty one both return ''. */
export type ByokVarReader = (env: 'dev' | 'prod', service: string, key: string) => string;

/** A NEXT equal to its own service's CURRENT counts as unset. */
export function effectiveNext(current: string, nextRaw: string): string {
  return nextRaw === current ? '' : nextRaw;
}

/**
 * The refusal for a NEXT that differs from CURRENT where stage 1 will not
 * regenerate it. With a window open, stage 1 refuses too, so the only repair is
 * deleting the variable by hand; otherwise it is an interrupted stage 1 prepare.
 */
export function nextSetRefusal(args: {
  env: 'dev' | 'prod';
  windowOpen: boolean;
  servicesWithNext: readonly string[];
}): Error {
  const { env, windowOpen, servicesWithNext } = args;
  const list = servicesWithNext.join(', ');
  if (windowOpen) {
    const cmds = servicesWithNext
      .map(
        svc =>
          `\`pnpm ops deploy:var-delete --env ${env} --service ${svc} --name API_KEY_ENCRYPTION_KEY_NEXT --yes\``
      )
      .join('; ');
    return new Error(
      `${NEXT_VAR} is set on ${list} (${env}) and differs from ${CURRENT_VAR} while a rotation window is open. Stage 1 refuses an open window, so it did not write this value: delete it with ${cmds}, then re-run this stage. No variable was written and no row has been touched.`
    );
  }
  return new Error(
    `${NEXT_VAR} is set on ${list} (${env}) with no rotation window open — an interrupted stage 1 prepare. Re-run stage 1 (\`pnpm ops secrets:rotate-byok --env ${env} --stage 1\`), which reuses or regenerates it. No variable was written and no row has been touched.`
  );
}

/**
 * Refuse while NEXT is staged (and differs from CURRENT) on any BYOK service.
 * Reads every service, so a NEXT left on only one is caught too.
 */
export function assertNoPendingNext(args: {
  env: 'dev' | 'prod';
  read: ByokVarReader;
  current: string;
  windowOpen: boolean;
}): void {
  const { env, read, current, windowOpen } = args;
  const servicesWithNext = BYOK_SERVICES.filter(
    svc => effectiveNext(current, read(env, svc, NEXT_VAR)) !== ''
  );
  if (servicesWithNext.length > 0) {
    throw nextSetRefusal({ env, windowOpen, servicesWithNext });
  }
}

/**
 * Refuse to operate while the two BYOK services disagree on key variables —
 * the partial-failure detector for the stage-1/stage-3 write loop (e.g. the
 * api-gateway set succeeded but the ai-worker set threw). Without this, a
 * split-brain window is silent until ai-worker BYOK decrypts start failing.
 *
 * A service's `PREVIOUS` equal to its own `CURRENT` decrypts nothing `CURRENT`
 * does not, so it is normalised to `''` before comparing (pinned in
 * `rotation.test.ts`). That lets a stage 1 interrupted mid-`PREVIOUS` phase
 * re-run without being blocked as a split-brain state. `NEXT` gets the same
 * normalisation (`effectiveNext`); with `compareNext` a mismatch refuses, and
 * stage 1 passes `compareNext: false` because it repairs a NEXT mismatch by
 * regenerating the value.
 */
export function assertByokServicesConsistent(
  env: 'dev' | 'prod',
  read: ByokVarReader,
  options: { compareNext: boolean }
): void {
  const [first, second] = BYOK_SERVICES;
  const firstCurrent = read(env, first, CURRENT_VAR);
  const secondCurrent = read(env, second, CURRENT_VAR);
  if (firstCurrent !== secondCurrent) {
    throw new Error(
      `${CURRENT_VAR} DIFFERS between ${first} and ${second} (${env}) — a previous variable write partially failed. Re-set it on the lagging service (Railway dashboard history has the values), then re-run.`
    );
  }

  const firstPreviousRaw = read(env, first, PREVIOUS_VAR);
  const secondPreviousRaw = read(env, second, PREVIOUS_VAR);
  const firstPrevious = firstPreviousRaw === firstCurrent ? '' : firstPreviousRaw;
  const secondPrevious = secondPreviousRaw === secondCurrent ? '' : secondPreviousRaw;
  if (firstPrevious !== secondPrevious) {
    throw new Error(
      `${PREVIOUS_VAR} DIFFERS between ${first} and ${second} (${env}) — a previous variable write partially failed. Re-set it on the lagging service (Railway dashboard history has the values), then re-run.` +
        ` If stage 3 was interrupted (PREVIOUS deleted on one service only), delete it on the other with \`pnpm ops deploy:var-delete --env ${env} --service <name> --name API_KEY_ENCRYPTION_KEY_PREVIOUS --yes\` instead, then re-run stage 3 with --resume.`
    );
  }

  if (!options.compareNext) {
    return;
  }
  const firstNext = effectiveNext(firstCurrent, read(env, first, NEXT_VAR));
  const secondNext = effectiveNext(secondCurrent, read(env, second, NEXT_VAR));
  if (firstNext !== secondNext) {
    const servicesWithNext = [
      ...(firstNext !== '' ? [first] : []),
      ...(secondNext !== '' ? [second] : []),
    ];
    // The gateway (first service)'s normalised PREVIOUS decides whether stage 1
    // would refuse the window, matching stage 1's own open-window test.
    throw nextSetRefusal({ env, windowOpen: firstPrevious !== '', servicesWithNext });
  }
}
