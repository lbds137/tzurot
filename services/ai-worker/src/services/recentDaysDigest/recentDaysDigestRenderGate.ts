/**
 * Pure render-gate for the recent-days digest. Status is filtered SQL-side
 * by `readRenderableDigest`; this only decides freshness and epoch match —
 * no Prisma, no logger, so it stays trivially unit-testable.
 */

import type { RenderableDigestRow } from './recentDaysDigestStore.js';
import { RECENT_DAYS_DIGEST } from '@tzurot/common-types/constants/recentDaysDigest';

export interface SelectRenderableDigestTextOptions {
  now: Date;
  currentEpoch: Date | null;
}

/**
 * Returns the digest text only when the row exists, is still within the
 * freshness window, and its stored epoch matches the caller's current
 * context epoch (both null counts as a match; exactly one null does not).
 * Epoch comparison is by value (`getTime()`), never by object identity —
 * the two epochs come from distinct reads and are never the same object.
 */
export function selectRenderableDigestText(
  row: RenderableDigestRow | null,
  opts: SelectRenderableDigestTextOptions
): string | undefined {
  if (row === null) {
    return undefined;
  }

  const ageMs = opts.now.getTime() - row.generatedAt.getTime();
  if (ageMs > RECENT_DAYS_DIGEST.WINDOW_DAYS * 86_400_000) {
    return undefined;
  }

  if (!epochsMatch(row.sourceEpoch, opts.currentEpoch)) {
    return undefined;
  }

  return row.text;
}

function epochsMatch(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.getTime() === b.getTime();
}
