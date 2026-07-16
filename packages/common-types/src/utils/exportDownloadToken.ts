/**
 * Export download-URL tokens.
 *
 * Export job IDs are DETERMINISTIC (uuidv5 over (userId, source, format) for
 * idempotency — a re-export upserts the same row). That makes the job ID
 * computable offline from a user's Discord ID, so it must NEVER appear in a
 * public, unauthenticated download URL. The download URL instead carries this
 * unguessable random token, regenerated on every job (re)creation so a shared
 * or leaked URL dies as soon as the export is re-run.
 */

import crypto from 'crypto';

/** 32 bytes = 256 bits of entropy, hex-encoded to 64 chars. */
const TOKEN_BYTES = 32;

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** Mint a fresh, unguessable download token for an export job's public URL. */
export function generateExportDownloadToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * Cheap shape guard for the download route: reject anything that isn't a
 * 64-char lowercase-hex token before touching the database.
 */
export function isExportDownloadToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}
