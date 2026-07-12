/**
 * Short-lived Redis stash for /admin db-sync detail reports.
 *
 * The full report is derived from the sync response, which exists only in the
 * command handler — a later "Show details" button click has nothing to
 * re-derive it from. So the handler stashes the rendered report here and the
 * button custom-id carries the key (state-in-custom-id per 04-discord; the
 * text itself is far past the 100-char custom-id cap, hence the indirection).
 *
 * Fail-open on both sides: a failed store returns null (the caller falls back
 * to inline delivery, the pre-button behavior) and a failed/expired fetch
 * returns null (the click answers "expired — re-run").
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { redis } from '../../redis.js';

const logger = createLogger('DbSyncReportStore');

const KEY_PREFIX = 'dbsync:report:';

/** Long enough to read the summary and decide; short enough to never pile up. */
export const DB_SYNC_REPORT_TTL_SECONDS = 30 * 60;

/**
 * Stash a rendered report; returns the retrieval key, or null when Redis is
 * unavailable (caller falls back to inline delivery).
 */
export async function storeDbSyncReport(text: string): Promise<string | null> {
  // randomUUID (not a deterministic generator) is correct here: the key is a
  // short-lived unguessable cache token, not a domain entity id that must be
  // reconstructible from inputs — same exception as MultiTagCoordinator.
  const key = randomUUID();
  try {
    await redis.setex(`${KEY_PREFIX}${key}`, DB_SYNC_REPORT_TTL_SECONDS, text);
    return key;
  } catch (error) {
    logger.warn({ err: error }, 'Failed to stash db-sync report — falling back to inline');
    return null;
  }
}

/** Fetch a stashed report; null = expired, unknown key, or Redis unavailable. */
export async function fetchDbSyncReport(key: string): Promise<string | null> {
  try {
    return await redis.get(`${KEY_PREFIX}${key}`);
  } catch (error) {
    logger.warn({ err: error }, 'Failed to fetch db-sync report');
    return null;
  }
}
