/**
 * Memory-archive auto-promotion — `system_settings` bag readers, split out
 * of `archivePromotion.ts` to keep that file under the `max-lines` limit.
 *
 * Two reader families, lenient vs. strict, over the same bag shape. An
 * ABSENT key (`undefined`) is the legitimate initial state — before the
 * first promotion run, or before an operator has ever touched the setting —
 * and both readers resolve it to the registry fallback. A PRESENT-but-
 * malformed value is a data fault, not an absent one: a stored JSON `null`
 * counts as present-and-malformed, not absent. The two families diverge on
 * what a data fault does. The lenient reader backs the batch-snapshot
 * classification, which is a pre-filter — it tolerates the fault (falls
 * back to the registry default and warns) because getting the classification
 * slightly wrong costs nothing; nothing is written from it directly. The
 * strict reader backs the two reads inside the promotion transaction, where
 * getting it wrong means persisting a list reconstructed from a fallback
 * instead of the operator's actual data — so it refuses to write at all,
 * throwing `MalformedSettingsList` and letting the transaction roll back.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import { SYSTEM_SETTINGS_REGISTRY } from '@tzurot/common-types/schemas/api/systemSettingsRegistry';

const logger = createLogger('archivePromotionSettings');

/** The stored bag as a plain object (null/array column → empty bag). Mirrors the sibling admin-settings handler's `asBag`. */
export function asBag(column: unknown): Record<string, unknown> {
  return typeof column === 'object' && column !== null && !Array.isArray(column)
    ? (column as Record<string, unknown>)
    : {};
}

export type SlugListKey =
  | 'archivePromotionOptOutPersonalities'
  | 'archiveSplitRenderPersonalities'
  | 'recentDaysDigestPersonalities';

export function readBoolSetting(bag: Record<string, unknown>): boolean {
  const value = bag.archivePromotionEnabled;
  return typeof value === 'boolean'
    ? value
    : SYSTEM_SETTINGS_REGISTRY.archivePromotionEnabled.fallback;
}

/**
 * Thrown when a render list is present but is not an array of strings;
 * caught per-candidate outside the promotion transaction so nothing
 * reconstructed is ever persisted.
 */
export class MalformedSettingsList extends Error {
  readonly key: SlugListKey;
  constructor(key: SlugListKey) {
    super(`Settings list ${key} is not an array of strings`);
    this.key = key;
  }
}

function isSlugList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/**
 * Used ONLY by the batch-snapshot reads, which are a pre-filter, never a
 * write: a malformed list falls back to the registry default and logs a
 * warning instead of throwing.
 */
export function readSlugListSettingLenient(
  bag: Record<string, unknown>,
  key: SlugListKey
): string[] {
  const value = bag[key];
  if (isSlugList(value)) {
    return value;
  }
  if (value !== undefined) {
    logger.warn(
      { key },
      'Archive promotion: settings list is malformed; classification uses the fallback and no promotion will write'
    );
  }
  return SYSTEM_SETTINGS_REGISTRY[key].fallback;
}

/**
 * Used by the two reads INSIDE the promotion transaction, so a malformed
 * list aborts the write instead of persisting a reconstruction.
 */
// @spec MEM-ARCH-037
export function readSlugListSettingStrict(
  bag: Record<string, unknown>,
  key: SlugListKey
): string[] {
  const value = bag[key];
  if (isSlugList(value)) {
    return value;
  }
  if (value !== undefined) {
    throw new MalformedSettingsList(key);
  }
  return SYSTEM_SETTINGS_REGISTRY[key].fallback;
}
