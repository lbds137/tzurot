/**
 * Attachment cache-key derivation
 *
 * Discord CDN URLs carry volatile signature query params (`?ex=&is=&hs=`) that
 * Discord re-signs on every re-fetch — so the *same* attachment yields a
 * *different* URL each time. Keying a cache on the full signed URL therefore
 * misses on every re-fetch, defeating the cache. This derives a STABLE key:
 *
 *   - prefer the Discord attachment `id` (an immutable snowflake), else
 *   - hash the query-stripped base URL — the path itself already embeds the
 *     immutable attachment id
 *     (`/attachments/{channelId}/{attachmentId}/{filename}`), so stripping the
 *     signature query is sufficient for stability even without an explicit id.
 *
 * Shared by `VoiceTranscriptCache` (transcripts) and `VisionDescriptionCache`
 * (image descriptions) so the two normalization strategies can't drift.
 */

import crypto from 'crypto';

/** The minimal attachment fields needed to derive a stable cache key. */
export interface AttachmentCacheKeyParts {
  /** Discord attachment id — an immutable snowflake. Preferred when present. */
  id?: string;
  /** Discord CDN URL. Query-stripped + hashed when no `id` is supplied. */
  url: string;
}

/**
 * Build a stable Redis cache key for a Discord attachment.
 *
 * @param prefix Redis key namespace (e.g. `transcript:`, `vision:`).
 * @param parts  Attachment id (preferred) and/or url (fallback).
 * @returns `${prefix}id:${id}` when an id is present, else
 *   `${prefix}url:${sha256(baseUrl)}` with the signature query stripped.
 */
export function deriveAttachmentCacheKey(prefix: string, parts: AttachmentCacheKeyParts): string {
  if (parts.id !== undefined && parts.id !== '') {
    return `${prefix}id:${parts.id}`;
  }

  const baseUrl = parts.url.split('?')[0];
  const urlHash = crypto.createHash('sha256').update(baseUrl).digest('hex');
  return `${prefix}url:${urlHash}`;
}
