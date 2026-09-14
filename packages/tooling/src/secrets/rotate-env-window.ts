/**
 * Rotation-window state, answered from the VERIFIER's point of view.
 *
 * `<NAME>_PREVIOUS` lives in the verifier service's OWN variable scope, not at
 * the shared (project) tier. Railway gates shared-variable inheritance per
 * service through an explicit enable list, and a NEWLY created shared variable
 * is inherited by no service until it is enabled for one — so a `_PREVIOUS`
 * written at the shared tier is invisible to the very service that has to read
 * it, and the dual-acceptance window it exists to open never opens. Writing it
 * at the verifier's own scope sidesteps inheritance entirely.
 *
 * Every question here is therefore asked against the verifier's EFFECTIVE
 * variable set — Railway's service-scoped `variables` query returns the merged
 * view (the service's own scope plus everything it inherits), which is exactly
 * the set the running process will see. Probe-verified, not assumed: that query
 * against the verifier returns the PRIMARY, which lives only at the shared tier.
 * Distinguishing an inherited value from a service's own override is a SEPARATE
 * and still-unverified property, hedged where it matters in `computeAffectedServices`.
 *
 * The PRIMARY stays shared: all three services inherit it and every presenter
 * reads it, so the primary-value read below deliberately passes no `serviceId`.
 */

import { listRailwayVariableNames, readRailwayVariableValue } from '../deployment/railway-api.js';

export interface VerifierWindowArgs {
  context: { projectId: string; environmentId: string };
  env: 'dev' | 'prod';
  verifier: { id: string; name: string };
  previousName: string;
}

/**
 * Whether a rotation window is OPEN: is `<NAME>_PREVIOUS` present in the
 * effective variable set of the verifier that must accept it?
 *
 * Reads NAMES only — `listRailwayVariableNames` returns `Object.keys` of
 * Railway's response and never a value.
 */
export async function isWindowOpenForVerifier(args: VerifierWindowArgs): Promise<boolean> {
  const names = await listRailwayVariableNames({
    projectId: args.context.projectId,
    environmentId: args.context.environmentId,
    serviceId: args.verifier.id,
    env: args.env,
  });
  return names.includes(args.previousName);
}

/**
 * Stage 1's read-back gate, run AFTER the variable writes and BEFORE the
 * verifier's redeploy.
 *
 * The deploy gate (`checkDeployedCodeAcceptsPrevious`) proves the verifier RUNS
 * code that accepts `<NAME>_PREVIOUS`; it never proves the VALUE reaches that
 * code. Those are two independent preconditions and only the first was gated,
 * so a `_PREVIOUS` the verifier could not see still redeployed it — into a
 * state where it rejected every presenter still holding the outgoing value.
 *
 * Refusing here is recoverable and redeploying is not: nothing has been
 * redeployed, so the verifier still runs the old process and every presenter
 * still holds the original value, whereas redeploying onto a configuration the
 * verifier cannot read is the outage itself.
 *
 * Recovery is NOT another stage 1 run. Stage 1 resumes a half-completed run
 * only down its window-OPEN path, and the window necessarily reads CLOSED here
 * — that closed read is what threw. A re-run therefore skips the resume branch,
 * takes the freshly minted primary as the current value, and overwrites
 * `<NAME>_PREVIOUS` with it, stranding the original that presenters still hold.
 *
 * Reads NAMES only; no value is read, printed, or compared.
 */
export async function assertPreviousReachesVerifier(args: VerifierWindowArgs): Promise<void> {
  const visible = await isWindowOpenForVerifier(args);
  if (visible) {
    return;
  }
  throw new Error(
    `"${args.previousName}" was written, but it is not visible in "${args.verifier.name}"'s ` +
      'effective variable set — refusing to redeploy the verifier, because it would then reject ' +
      'every service still presenting the outgoing value. Nothing was redeployed, so no service ' +
      'is affected yet: the verifier still runs the old process and every presenter still holds ' +
      'the original value. Do NOT run stage 1 again — the window reads CLOSED, so stage 1 would ' +
      'skip its resume path, take the freshly minted primary as the current value, and overwrite ' +
      `"${args.previousName}" with it, stranding the original value the presenters still hold. ` +
      `Investigate why "${args.previousName}" does not reach "${args.verifier.name}" before ` +
      'running any further stage.'
  );
}

/**
 * Read the primary and `_PREVIOUS` values and report whether they are EQUAL —
 * the signature of a stage 1 that upserted `_PREVIOUS` but died before minting
 * a fresh primary (a half-completed run, not a real rotation window). Shared by
 * stage 1 (to resume a half-completed run instead of refusing) and stage 3 (to
 * refuse to stamp a rotation that never happened).
 *
 * The two reads target DIFFERENT scopes on purpose: the primary is shared, and
 * `_PREVIOUS` is the verifier's own — the same scopes the writes use, so this
 * comparison and the window detection above can never disagree about which
 * variable they mean.
 *
 * Both reads are of SECRET VALUES: compared and discarded here, never printed,
 * logged, or included in a thrown error.
 */
export async function isDegenerateWindow(
  args: VerifierWindowArgs & { primaryName: string }
): Promise<boolean> {
  const [primaryValue, previousValue] = await Promise.all([
    readRailwayVariableValue({
      projectId: args.context.projectId,
      environmentId: args.context.environmentId,
      name: args.primaryName,
      env: args.env,
    }),
    readRailwayVariableValue({
      projectId: args.context.projectId,
      environmentId: args.context.environmentId,
      serviceId: args.verifier.id,
      name: args.previousName,
      env: args.env,
    }),
  ]);
  return primaryValue === previousValue;
}
