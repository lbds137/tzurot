/**
 * Image → base64 `data:` URL download (SSRF-guarded).
 *
 * The single place the worker turns an image URL into provider-ready inline
 * bytes. Used by BOTH DownloadAttachmentsStep (trigger-message attachments) and
 * describeImage (referenced-message / vision-description images) so the two
 * paths can't diverge: the vision provider never has to fetch a URL it might be
 * unable to reach (Discord's external-image proxy 403s OpenRouter; signed
 * Discord-CDN URLs expire), and SSRF guards run uniformly on OUR egress.
 *
 * Composes the existing primitives in attachmentFetch.ts + safeExternalFetch.ts;
 * the route+fetch+resize+base64 combination was previously private to
 * DownloadAttachmentsStep.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  validateAttachmentUrl,
  fetchAttachmentBytes,
  resizeImageIfNeeded,
  bufferToDataUrl,
  AttachmentTooLargeError,
  HttpError,
  MAX_ATTACHMENT_BYTES,
} from './attachmentFetch.js';
import { validateExternalImageUrl, fetchExternalImageBytes } from './safeExternalFetch.js';

const logger = createLogger('imageToDataUrl');

export interface DownloadImageOptions {
  /**
   * Source content-type hint. When absent, defaults to `image/png` — harmless,
   * because resize re-encodes to JPEG when it fires and the final data: MIME is
   * taken from the resize output, not this hint. The DownloadAttachmentsStep
   * path always supplies the attachment's metadata contentType; the vision path
   * (resolveVisionImageUrl) does too, so the default rarely fires in practice.
   */
  contentType?: string;
  /** Max download bytes (defaults to MAX_ATTACHMENT_BYTES). */
  maxBytes?: number;
  /**
   * Backoff before the single transient retry. Defaults to 500ms. The
   * DownloadAttachmentsStep path injects its own (tests pass 0); the vision path
   * (resolveVisionImageUrl) inherits the 500ms default, so a transient fetch
   * failure there adds up to 500ms to the vision-description latency ceiling.
   */
  retryDelayMs?: number;
  /** Diagnostic correlation only. */
  jobId?: string;
  name?: string;
}

/**
 * Two-tier URL routing: the Discord-CDN strict allowlist first (fast, no DNS),
 * falling through to the safe external-image fetcher ONLY on an allowlist miss.
 * Other validation failures (bad protocol, credentials, IP-as-hostname) propagate
 * — those are real client errors, not allowlist misses.
 *
 * The allowlist-miss branch matches `validateAttachmentUrl`'s "must be from
 * Discord CDN" message by substring — load-bearing on both ends until a typed
 * AllowlistRejectionError lands (tracked in backlog).
 */
export function routeImageUrl(rawUrl: string): { sanitizedUrl: string; isExternal: boolean } {
  try {
    return { sanitizedUrl: validateAttachmentUrl(rawUrl), isExternal: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('must be from Discord CDN')) {
      throw error;
    }
    return { sanitizedUrl: validateExternalImageUrl(rawUrl), isExternal: true };
  }
}

async function fetchImageWithRetry(
  url: string,
  isExternal: boolean,
  options: DownloadImageOptions
): Promise<Buffer> {
  const maxBytes = options.maxBytes ?? MAX_ATTACHMENT_BYTES;
  const fetchOnce = (): Promise<Buffer> =>
    isExternal
      ? fetchExternalImageBytes(url, { maxBytes })
      : fetchAttachmentBytes(url, { maxBytes });

  try {
    return await fetchOnce();
  } catch (error) {
    // 403 is the CDN-expiration signal — re-fetching an expired URL just 403s
    // again. Size-cap violations won't improve on retry either. Match by typed
    // class / status field so a future message-format tweak can't break the guard.
    if (
      (error instanceof HttpError && error.status === 403) ||
      error instanceof AttachmentTooLargeError
    ) {
      throw error;
    }
    logger.warn(
      { jobId: options.jobId, name: options.name, err: error, isExternal },
      'Image fetch failed, retrying once'
    );
    await new Promise(resolve => setTimeout(resolve, options.retryDelayMs ?? 500));
    return fetchOnce();
  }
}

/**
 * Route → fetch (one transient retry) → resize → base64. Returns the `data:`
 * URL and its byte length. Throws on fetch/validation failure; the caller owns
 * the fallback decision.
 */
export async function downloadImageToDataUrl(
  rawUrl: string,
  options: DownloadImageOptions = {}
): Promise<{ dataUrl: string; bytes: number }> {
  const { sanitizedUrl, isExternal } = routeImageUrl(rawUrl);
  const buffer = await fetchImageWithRetry(sanitizedUrl, isExternal, options);
  // Use the resize *output* contentType for the data URL — resize always emits
  // JPEG, so the MIME must reflect that even when the source was PNG.
  const { buffer: resized, contentType } = await resizeImageIfNeeded(
    buffer,
    options.contentType ?? 'image/png'
  );
  return { dataUrl: bufferToDataUrl(resized, contentType), bytes: resized.byteLength };
}
