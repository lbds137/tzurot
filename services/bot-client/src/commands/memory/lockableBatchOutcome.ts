/**
 * Shared outcome mapping, upfront-skip rendering, and tally helpers for batch
 * surfaces whose items can be locked (memory facts and memories).
 *
 * Both flows run the same lockable-batch outcome rules and differ only in
 * their resource noun (`fact` / `memory`) and destroy verb (`forget` /
 * `delete`).
 */

import { GatewayClientError } from '@tzurot/clients';
import {
  ALREADY_GONE_NOTE,
  type BatchItemResult,
  type BatchResultLine,
} from '../../utils/browse/multiSelectBatch.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

/** Outcome counts for one finished lockable-item batch run. */
export interface LockableBatchCounts {
  succeeded: number;
  gone: number;
  failed: number;
  locked: number;
}

/** Resource noun and destroy verb for a lockable-item batch surface. */
export interface LockableBatchNouns {
  noun: string;
  destroyVerb: string;
}

/** Per-run verb polarity and resource nouns for lockable-item outcome rendering. */
export interface LockableBatchRunOptions {
  destroying: boolean;
  nouns: LockableBatchNouns;
}

/**
 * Resolved pre-loop state for one selected id. `isLocked` is null when the
 * state could not be determined: the item is missing from the fetched page
 * and its per-id read 404'd — such ids are also recorded in the gone set and
 * skip the run's mutations entirely (reported already gone).
 */
export interface ResolvedLockableLabel {
  label: string;
  isLocked: boolean | null;
}

/** Errors from per-id reads that also failed — keyed by the selected id. */
export type LockableLabelReadErrors = Map<string, unknown>;

/** Ids whose per-id read confirmed the item is already gone (a 404). */
export type LockableGoneIds = Set<string>;

/** The maps a per-id read batch populates. */
export interface LockableLabelCollectors {
  resolved: Map<string, ResolvedLockableLabel>;
  readErrors: LockableLabelReadErrors;
  goneIds: LockableGoneIds;
}

/**
 * One cohesive per-surface adapter for resolving a lockable item's label and
 * lock state by id (the three functions are authored together per item kind).
 */
export interface LockableLabelReader<T extends { isLocked: boolean }> {
  read: (id: string) => Promise<T | null>;
  toLabel: (item: T) => string;
  fallbackLabel: (id: string) => string;
}

/**
 * Resolve every id in `missingIds` through its per-id read in parallel: the
 * real label + lock state when the item still exists, a gone record + fallback
 * label when it 404s (`read` resolves `null`; the run skips the mutation for
 * that id and reports it already gone), and a recorded read error when the
 * read itself throws.
 */
export async function resolveMissingLockableLabels<T extends { isLocked: boolean }>(
  missingIds: readonly string[],
  reader: LockableLabelReader<T>,
  collectors: LockableLabelCollectors
): Promise<void> {
  const { read, toLabel, fallbackLabel } = reader;
  const { resolved, readErrors, goneIds } = collectors;
  await Promise.all(
    missingIds.map(async id => {
      try {
        const item = await read(id);
        if (item === null) {
          resolved.set(id, { label: fallbackLabel(id), isLocked: null });
          goneIds.add(id);
        } else {
          resolved.set(id, { label: toLabel(item), isLocked: item.isLocked });
        }
      } catch (error) {
        readErrors.set(id, error);
      }
    })
  );
}

/**
 * Map one executed batch item's result to its outcome line: on a destroy run a
 * 403 is the gateway's locked-item rejection; any other failure classifies
 * under the destroy action or the lock resource; resolved items map to success
 * or already-gone.
 */
export function toLockableResultLine(
  result: BatchItemResult<'success' | 'already-gone'>,
  label: string,
  opts: LockableBatchRunOptions
): BatchResultLine {
  const { destroying, nouns } = opts;
  if (!result.ok) {
    // On a destroy (forget/delete) run a 403 IS the gateway's locked-item
    // rejection. A lock state known before the run skips the id upfront, so
    // a 403 here means a per-id read failed or the item was locked after the
    // read. Render it as the locked outcome, not a generic failure.
    if (destroying && result.error instanceof GatewayClientError && result.error.status === 403) {
      return { label, status: 'locked', note: 'locked — unlock first' };
    }
    const failedAction = `${nouns.destroyVerb} the ${nouns.noun}`;
    const reason = renderSpec(
      destroying
        ? classifyGatewayFailure(result.error, nouns.noun, { failedAction })
        : classifyGatewayFailure(result.error, `${nouns.noun} lock`)
    );
    return { label, status: 'failed', note: reason };
  }
  if (result.value === 'success') {
    return { label, status: 'success' };
  }
  return { label, status: 'gone', note: ALREADY_GONE_NOTE };
}

/**
 * Original ids order: loop results where the id ran; the upfront skips for
 * the ids neither verb attempted (gone → already gone; locked-skip → locked;
 * every remaining id on a lock run is an unresolvable read — failed with
 * its classified reason, no mutation). Precondition: callers pass only ids
 * that did not run, so a non-gone, non-locked id has a recorded read error;
 * an id without one renders a failed line classified from `undefined`.
 */
export function buildSkippedLockableLine(
  id: string,
  label: string,
  skips: {
    goneIds: ReadonlySet<string>;
    lockedIds: ReadonlySet<string>;
    readErrors: ReadonlyMap<string, unknown>;
  },
  opts: LockableBatchRunOptions
): BatchResultLine {
  if (skips.goneIds.has(id)) {
    return { label, status: 'gone', note: ALREADY_GONE_NOTE };
  }
  if (skips.lockedIds.has(id)) {
    return {
      label,
      status: 'locked',
      note: opts.destroying ? 'locked — unlock first' : 'already locked',
    };
  }
  const readError = skips.readErrors.get(id);
  return {
    label,
    status: 'failed',
    note: renderSpec(classifyGatewayFailure(readError, opts.nouns.noun, { operation: 'read' })),
  };
}

/** Tally per-status outcome counts over a finished batch's result lines. */
export function countLockableBatchLines(lines: readonly BatchResultLine[]): LockableBatchCounts {
  return {
    succeeded: lines.filter(line => line.status === 'success').length,
    gone: lines.filter(line => line.status === 'gone').length,
    failed: lines.filter(line => line.status === 'failed').length,
    locked: lines.filter(line => line.status === 'locked').length,
  };
}

/** The verb-dependent counts summary line for the survival ladder's followUp fallback. */
export function formatLockableCountsLine(counts: LockableBatchCounts, destroying: boolean): string {
  const { succeeded, gone, locked, failed } = counts;
  return destroying
    ? `Batch finished: ${succeeded} succeeded, ${gone} already gone, ${locked} locked (skipped), ${failed} failed.`
    : `Batch finished: ${succeeded} succeeded, ${gone} already gone, ${locked} already locked, ${failed} failed.`;
}
