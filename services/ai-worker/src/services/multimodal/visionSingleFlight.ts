/**
 * Vision single-flight coalescing.
 *
 * A multi-character fan-out sends N simultaneous describes for the SAME image
 * (one job chain per tagged character) — without coalescing, all N burn a
 * provider request, because the canonical cache only fills after the first
 * response. The single-flight marker makes exactly one caller (the WINNER)
 * invoke the provider; the others (LOSERS) wait on the winner's canonical
 * cache write instead.
 *
 * Every failure mode — Redis down, winner crash, wait ceiling — falls through
 * to the pre-feature behavior (the caller runs its own provider call), so the
 * mechanism can only remove calls, never add failures. Known benign race: the
 * winner's fallback-chain tier transitions briefly release the marker between
 * tiers; a waiter that catches that gap starts its own call, which is exactly
 * the pre-feature behavior.
 */

import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { visionDescriptionCache } from '../../redis.js';
import { isValidVisionDescription } from './visionDescriptionValidity.js';

const logger = createLogger('VisionSingleFlight');

/** Poll cadence for single-flight waiters — cheap Redis reads, not provider calls. */
const SINGLE_FLIGHT_POLL_MS = 500;
/**
 * Wait ceiling — derived from the vision invoke's own timeout so the two can't
 * drift: a maximally slow SUCCESSFUL winner (model call capped at
 * `TIMEOUTS.VISION_MODEL`) plus download/store overhead must fit under it, or
 * waiters duplicate the call in exactly the slow-model window coalescing
 * exists for. The ceiling is the CRASHED-winner backstop only — a winner whose
 * call fails/times out releases the marker in its `finally`, and waiters exit
 * on the marker-vanish check within one poll, long before this.
 */
const SINGLE_FLIGHT_MAX_WAIT_MS = TIMEOUTS.VISION_MODEL + 30_000;

/** Cache-identity options shared with VisionDescriptionCache. */
interface SingleFlightKeyOptions {
  attachmentId?: string;
  url: string;
  model?: string;
}

/** Outcome of entering the single-flight section. */
export interface SingleFlightEntry {
  /**
   * This caller owns the in-flight marker and MUST release it when its
   * describe attempt finishes (win or lose) — see `exitSingleFlight`.
   */
  acquired: boolean;
  /**
   * A concurrent winner's description, when coalescing succeeded — the caller
   * returns it directly and makes no provider call.
   */
  coalesced: string | null;
}

/**
 * Enter the single-flight section for one image describe. `skipCache` callers
 * bypass entirely (they explicitly want a fresh call). Losers wait for the
 * winner's cache write; a null `coalesced` with `acquired: false` means the
 * winner died or the ceiling passed — proceed with an own call.
 */
export async function enterSingleFlight(
  cacheKeyOptions: SingleFlightKeyOptions,
  attachment: AttachmentMetadata,
  skipCache: boolean
): Promise<SingleFlightEntry> {
  if (skipCache) {
    return { acquired: false, coalesced: null };
  }
  const acquired = await visionDescriptionCache.tryAcquireInflight(cacheKeyOptions);
  if (acquired) {
    return { acquired: true, coalesced: null };
  }
  return {
    acquired: false,
    coalesced: await waitForCoalescedDescription(cacheKeyOptions, attachment),
  };
}

/**
 * Release the in-flight marker if this caller owns it. Runs in the describe
 * attempt's `finally`: on success the canonical cache is already written
 * (waiters read it); on failure waiters must stop waiting and run their own
 * attempts. Only the owner releases — a fallen-through waiter deleting the
 * winner's marker would double-release.
 */
export async function exitSingleFlight(
  entry: SingleFlightEntry,
  cacheKeyOptions: SingleFlightKeyOptions
): Promise<void> {
  if (entry.acquired) {
    await visionDescriptionCache.releaseInflight(cacheKeyOptions);
  }
}

/**
 * Wait for a concurrent describe (the single-flight winner) to publish its
 * canonical description. Returns the description on success, or null when the
 * winner disappeared without writing (its call failed) or the wait ceiling
 * passed — callers then proceed with their own provider call.
 */
async function waitForCoalescedDescription(
  cacheKeyOptions: SingleFlightKeyOptions,
  attachment: AttachmentMetadata
): Promise<string | null> {
  const deadline = Date.now() + SINGLE_FLIGHT_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const cached = await visionDescriptionCache.get(cacheKeyOptions);
    if (cached !== null && isValidVisionDescription(cached)) {
      logger.info(
        { attachmentId: attachment.id, attachmentName: attachment.name },
        'Coalesced onto concurrent vision describe — no extra provider call'
      );
      return cached;
    }
    if (!(await visionDescriptionCache.isInflight(cacheKeyOptions))) {
      // Winner released without a (valid) cache write — its call failed.
      return null;
    }
    await new Promise(resolve => setTimeout(resolve, SINGLE_FLIGHT_POLL_MS));
  }
  logger.warn(
    { attachmentId: attachment.id },
    'Single-flight wait ceiling passed — proceeding with own vision call'
  );
  return null;
}
