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

import crypto from 'node:crypto';
import chalk from 'chalk';

import {
  deleteRailwayVariable,
  listRailwayVariableNames,
  readRailwayVariableValue,
  upsertRailwayVariable,
} from '../deployment/railway-api.js';
import { UsageError } from '../utils/errors.js';
import type { StageArgs } from './rotate-env-context.js';
import { printDryRunNotice } from './rotate-env-stage-output.js';

export interface VerifierWindowArgs {
  context: { projectId: string; environmentId: string };
  env: 'dev' | 'prod';
  verifier: { id: string; name: string };
  previousName: string;
}

export interface RollMarkerArgs {
  context: { projectId: string; environmentId: string };
  env: 'dev' | 'prod';
  verifier: { id: string; name: string };
  primaryName: string;
}

export function rollMarkerName(primaryName: string): string {
  return `${primaryName}_ROLLED`;
}

/**
 * Unsalted SHA-256 of the primary value for `<NAME>_ROLLED`. This relies on the
 * primary being high-entropy, as stage 1 mints it from `crypto.randomBytes(32)`
 * and stage 2 refuses a primary stage 1 never rotated (so the marker is only
 * written over a minted value; pinned by `stage 2 refuses to roll services when
 * _PREVIOUS equals the primary` in `rotate-env-stages.test.ts`); a
 * lower-entropy or operator-chosen secret would need a keyed hash.
 */
function hashPrimaryValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
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

export async function refuseIfDegenerateWindow(
  args: StageArgs,
  text: { dryRun: string; refusal: string }
): Promise<boolean> {
  const { options, context, verifier, previousName } = args;
  const degenerate = await isDegenerateWindow({
    context,
    env: options.env,
    verifier,
    previousName,
    primaryName: options.name,
  });
  if (!degenerate) {
    return false;
  }
  if (options.dryRun) {
    console.log(chalk.red(`\n⚠️  ${text.dryRun}`));
    printDryRunNotice();
    return true;
  }
  throw new UsageError(text.refusal);
}

/**
 * Read the current shared primary value and return its lowercase hex SHA-256
 * hash for `<NAME>_ROLLED`, or throw if the primary has no value.
 *
 * Neither the primary value nor its hash is ever printed, logged, or included
 * in a thrown error.
 */
export async function readRollMarkerValue(args: RollMarkerArgs): Promise<string> {
  const primaryValue = await readRailwayVariableValue({
    projectId: args.context.projectId,
    environmentId: args.context.environmentId,
    name: args.primaryName,
    env: args.env,
  });
  if (primaryValue === undefined || primaryValue.length === 0) {
    throw new Error(
      `"${args.primaryName}" has no value at the shared tier — cannot record "${rollMarkerName(args.primaryName)}".`
    );
  }
  return hashPrimaryValue(primaryValue);
}

/**
 * Record stage-2 roll completion in the verifier's own scope as `<NAME>_ROLLED`,
 * set to the hash returned by {@link readRollMarkerValue}.
 *
 * A stale marker stops matching once stage 1 mints a new primary, and a primary
 * changed after stage 2 fails the same match; the hash alone does not catch a
 * stage 1 that died before minting, because the primary still equals the
 * earlier rotation's, and stage 3's degenerate check refuses that case (pinned
 * by `refuses a degenerate window even when a leftover roll marker matches the
 * unrotated primary` in `rotate-env-stage3.test.ts`); together these are why
 * stage 1 does not have to clear the marker.
 */
export async function writeRollMarker(args: RollMarkerArgs, value: string): Promise<void> {
  await upsertRailwayVariable({
    projectId: args.context.projectId,
    environmentId: args.context.environmentId,
    serviceId: args.verifier.id,
    name: rollMarkerName(args.primaryName),
    value,
    skipDeploys: true,
    env: args.env,
  });
}

/**
 * Whether stage 2 has completed for the CURRENT primary: `<NAME>_ROLLED` is
 * present in the verifier's scope and equals the SHA-256 hash of a non-empty
 * shared primary value.
 */
export async function isRollComplete(args: RollMarkerArgs): Promise<boolean> {
  const [primaryValue, markerValue] = await Promise.all([
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
      name: rollMarkerName(args.primaryName),
      env: args.env,
    }),
  ]);
  if (
    primaryValue === undefined ||
    primaryValue.length === 0 ||
    markerValue === undefined ||
    markerValue.length === 0
  ) {
    return false;
  }
  return markerValue === hashPrimaryValue(primaryValue);
}

/** Delete `<NAME>_ROLLED` from the verifier's own variable scope. */
export async function deleteRollMarker(args: RollMarkerArgs): Promise<void> {
  await deleteRailwayVariable({
    projectId: args.context.projectId,
    environmentId: args.context.environmentId,
    serviceId: args.verifier.id,
    name: rollMarkerName(args.primaryName),
    env: args.env,
  });
}
