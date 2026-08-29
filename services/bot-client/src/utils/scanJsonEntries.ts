/**
 * Cursor-safe SCAN over a prefixed keyspace of JSON values.
 *
 * Both boot-recovery stores — `MultiTagPersistence` (coordinator entries) and
 * `SingleJobPersistence` (single-personality job contexts) — need the same
 * loop: SCAN a prefix, MGET each batch, parse each value, skip the unusable
 * ones. Only three things differ, and the extraction takes exactly one
 * callback, so it sits well under `02-code-standards.md`'s 2-callback ceiling:
 * the prefix, the parsed type, and the per-value parse.
 *
 * SCAN rather than KEYS so a large keyspace never blocks Redis. The cursor
 * loop is the part worth having in one place: `while (cursor !== '0')` with
 * the initial `'0'` is easy to write subtly wrong, and a mistake either
 * truncates recovery silently or spins forever.
 */

import type { Redis } from 'ioredis';

/**
 * Per-call SCAN hint — a guideline for how much work Redis does per round
 * trip, not a cap on results. Small enough not to block Redis, large enough
 * that a boot scan costs O(entries / 100) round trips.
 */
export const DEFAULT_SCAN_COUNT = 100;

/**
 * Scan every `${matchPrefix}*` key and return the values `parse` accepted.
 *
 * `parse` receives the key alongside the raw value so it can log which entry
 * it rejected, and returns `null` to skip one — an entry that is oversized,
 * corrupt, or written by an older deploy with a since-changed shape must not
 * abort the whole scan, because one bad key would then block recovery of
 * every other in-flight job. Callers own that logging: what counts as
 * unusable, and at what level to report it, differs per store.
 *
 * Redis errors are NOT caught here — a scan that cannot run at all is a
 * different failure from a single unparseable entry, and each caller already
 * decides how to degrade at startup.
 */
export async function scanJsonEntries<T>(
  redis: Redis,
  matchPrefix: string,
  parse: (key: string, raw: string | null) => T | null,
  scanCount: number = DEFAULT_SCAN_COUNT
): Promise<T[]> {
  const matchPattern = `${matchPrefix}*`;
  const found: T[] = [];
  let cursor = '0';

  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', matchPattern, 'COUNT', scanCount);
    cursor = next;
    if (keys.length === 0) {
      continue;
    }
    const values = await redis.mget(...keys);
    for (let i = 0; i < values.length; i++) {
      const parsed = parse(keys[i], values[i]);
      if (parsed !== null) {
        found.push(parsed);
      }
    }
  } while (cursor !== '0');

  return found;
}
