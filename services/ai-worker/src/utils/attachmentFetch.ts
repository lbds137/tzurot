/**
 * Attachment Fetch Utilities
 *
 * Shared helpers for validating and fetching Discord attachment URLs.
 * Lifted from api-gateway's AttachmentStorageService as part of the
 * attachment-download-to-ai-worker refactor.
 *
 * Used by:
 * - DownloadAttachmentsStep (LLM generation pipeline)
 * - VisionProcessor / AudioProcessor (preprocessing job fetch sites)
 *
 * Security model: only https URLs from the Discord CDN allowlist are fetched.
 * Size caps are enforced via Content-Length before any body read to prevent
 * memory-exhaustion attacks via tarpit servers.
 */

import sharp from 'sharp';
import { createLogger, MEDIA_LIMITS, CONTENT_TYPES } from '@tzurot/common-types';

const logger = createLogger('attachmentFetch');

const ALLOWED_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];

/**
 * Hard cap on attachment download size, pre-resize.
 * Enforced via Content-Length header and a streaming guard.
 * Discord's own attachment cap is 25 MiB for non-Nitro uploads; we match it.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Error thrown when an HTTP fetch returns a non-OK status. Carries the status
 * code as a typed field so callers can classify by number instead of parsing
 * the message string. 403 specifically is the Discord-CDN expiration signal
 * (non-retryable — re-fetching an expired URL just produces another 403).
 */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, statusText: string) {
    super(`HTTP ${status}: ${statusText}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Error thrown when an attachment exceeds the size cap.
 * Non-retryable — re-fetching the same URL will always produce the same size.
 */
export class AttachmentTooLargeError extends Error {
  readonly size: number;
  readonly limit: number;
  constructor(size: number, limit: number) {
    super(
      `Attachment is ${(size / 1024 / 1024).toFixed(1)} MiB, exceeds limit of ${(limit / 1024 / 1024).toFixed(0)} MiB`
    );
    this.name = 'AttachmentTooLargeError';
    this.size = size;
    this.limit = limit;
  }
}

/**
 * Maximum aggregate size of all attachments (post-resize) carried inside a
 * single BullMQ job's data. Stays well under Redis's 512 MiB per-key limit
 * with headroom for non-attachment payload fields. Image attachments are
 * resized down well below this; the cap really only fires for non-image
 * attachments (audio/video) that bypass resize.
 *
 * Note: this cap is in **binary bytes** (pre-base64). Data URLs in `job.data`
 * are base64-encoded, inflating each attachment by ~33% — so a 50 MiB binary
 * payload produces ~67 MiB of base64 in the serialized job. Still well under
 * Redis's 512 MiB per-key limit; the conservative cap exists so the
 * BullMQ JSON.stringify boundary never runs close to the limit.
 */
export const MAX_AGGREGATE_PAYLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Error thrown when the aggregate size of all downloaded attachments in a
 * single job exceeds MAX_AGGREGATE_PAYLOAD_BYTES. Per-attachment caps are
 * enforced via AttachmentTooLargeError; this one fires at the job level
 * after all per-attachment downloads have settled. "Non-retryable" describes
 * the contract — re-running with the same inputs would just hit the cap
 * again. Operationally, this and the other pipeline errors never propagate
 * to BullMQ's retry mechanism: LLMGenerationHandler.processJob's catch block
 * converts ALL pipeline-step errors into `success: false` result objects, so
 * BullMQ sees a successful job invocation that returned a failure result.
 * The "non-retryable" guarantee is therefore automatic, not configuration-
 * dependent.
 *
 * Hazard scenario this guards: 10× 20 MB audio/video files, each under
 * MAX_ATTACHMENT_BYTES = 25 MiB but together ~260 MB of base64 in
 * job.data — would otherwise blow Redis's 512 MiB per-key limit at the
 * BullMQ JSON.stringify boundary with an opaque DataCloneError.
 */
export class JobPayloadTooLargeError extends Error {
  readonly totalBytes: number;
  readonly limit: number;
  constructor(totalBytes: number, limit: number) {
    super(
      `Job attachments total ${(totalBytes / 1024 / 1024).toFixed(1)} MiB after resize, exceeds aggregate limit of ${(limit / 1024 / 1024).toFixed(0)} MiB`
    );
    this.name = 'JobPayloadTooLargeError';
    this.totalBytes = totalBytes;
    this.limit = limit;
  }
}

/**
 * Validate an attachment URL against SSRF-prevention rules and return a
 * sanitized URL string suitable for fetching.
 *
 * Rules:
 * - Protocol must be https
 * - No credentials (username/password)
 * - No non-standard ports
 * - Hostname is not an IP address (IPv4 or IPv6)
 * - Hostname is on the Discord CDN allowlist
 *
 * @throws Error with a user-safe message on any rule violation.
 */
export function validateAttachmentUrl(rawUrl: string): string {
  const url = new URL(rawUrl);

  if (url.protocol !== 'https:') {
    throw new Error('Invalid attachment URL: protocol must be https:');
  }

  // Node's URL constructor normalizes the default HTTPS port to ''; an
  // explicit `:443` becomes empty string, so `url.port !== ''` alone catches
  // all non-default ports (e.g. `cdn.discordapp.com:8443` yields `'8443'`).
  if (url.port !== '') {
    throw new Error('Invalid attachment URL: non-standard port not allowed');
  }

  if (url.username !== '' || url.password !== '') {
    throw new Error('Invalid attachment URL: credentials not allowed');
  }

  // ReDoS-safe: {1,16} ceiling; DNS absolute form has ≤2 trailing dots.
  const normalizedHostname = url.hostname.replace(/\.{1,16}$/, '');

  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Pattern = /^\[?[0-9a-f:]+\]?$/i;
  if (ipv4Pattern.test(normalizedHostname) || ipv6Pattern.test(normalizedHostname)) {
    throw new Error('Invalid attachment URL: IP addresses not allowed');
  }

  if (!ALLOWED_HOSTS.includes(normalizedHostname)) {
    // The substring "must be from Discord CDN" is matched by
    // DownloadAttachmentsStep.routeAttachmentUrl to detect this specific
    // failure mode and route to the safe-external fallback. Edits that would
    // BREAK the routing: rephrasing the prefix ("must come from", "needs to
    // be from"), changing capitalization, removing "Discord CDN", or
    // i18n/template wrapping. Adding hosts to the parenthetical list is
    // safe (the routing matches the leading substring, not the host list).
    // Keep the prefix stable until the typed `AllowlistRejectionError`
    // BACKLOG entry ships and the substring-coupling can be retired.
    throw new Error(
      `Invalid attachment URL: must be from Discord CDN (${ALLOWED_HOSTS.join(', ')})`
    );
  }

  // Reconstruct from validated components to break taint flow into the fetch call.
  // Fragment (`url.hash`) is intentionally dropped: undici strips it before the
  // wire request anyway, so including it in the returned "sanitized" URL would
  // be misleading and creates spurious differentiation if the value ever gets
  // logged or used as a cache key (`/x.png` vs `/x.png#section`).
  return `https://${normalizedHostname}${url.pathname}${url.search}`;
}

/**
 * True if a URL is a `data:` URL. Data URLs carry the bytes inline and skip
 * network fetches; they don't need SSRF validation.
 */
export function isDataUrl(url: string): boolean {
  return url.startsWith('data:');
}

export interface FetchAttachmentBytesOptions {
  /** Maximum bytes to accept. Defaults to MAX_ATTACHMENT_BYTES. */
  maxBytes?: number;
  /** Per-attachment timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /**
   * Additional request headers (e.g. `User-Agent`). The Discord CDN path uses
   * none; the external-image fallback path passes a browser UA so Reddit/Imgur
   * and similar hosts don't 403 us before SSRF defenses even matter.
   */
  headers?: Record<string, string>;
  /**
   * If set, after the status check we assert the response Content-Type starts
   * with this prefix BEFORE consuming the body. Memory-exhaustion guard for
   * the external-image path — without it, an attacker-controlled embed URL
   * could point at a 10 MiB text/HTML payload that we'd buffer-then-reject.
   */
  assertContentTypePrefix?: string;
}

/**
 * Fetch an attachment's bytes from a validated URL, enforcing a size cap.
 *
 * Throws:
 * - Error with 403 message if Discord CDN rejects (URL expired)
 * - AttachmentTooLargeError if Content-Length or actual size exceeds the cap
 * - Error if `assertContentTypePrefix` is set and the response Content-Type
 *   doesn't start with that prefix
 * - Error on network failures and timeouts
 */
export async function fetchAttachmentBytes(
  url: string,
  options: FetchAttachmentBytesOptions = {}
): Promise<Buffer> {
  const maxBytes = options.maxBytes ?? MAX_ATTACHMENT_BYTES;
  const timeoutMs = options.timeoutMs ?? 30_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // redirect: 'error' closes an SSRF gap: validateAttachmentUrl only guards
    // the initial URL, so a 302 response from the CDN to an internal address
    // would sneak past the allowlist. Discord's CDN doesn't redirect in
    // practice today — if that ever changes, we'd rather hard-fail than
    // silently follow the redirect out of the allowlist.
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
      headers: options.headers,
    });
    if (!response.ok) {
      // Do not let CDN 403s trip any future outbound-HTTP circuit breaker —
      // this is a per-URL lifetime issue, not a Discord availability issue.
      throw new HttpError(response.status, response.statusText);
    }

    if (options.assertContentTypePrefix !== undefined) {
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().startsWith(options.assertContentTypePrefix.toLowerCase())) {
        throw new Error(
          `Unexpected Content-Type "${contentType}"; expected prefix "${options.assertContentTypePrefix}"`
        );
      }
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
      const declaredSize = Number.parseInt(contentLength, 10);
      if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
        throw new AttachmentTooLargeError(declaredSize, maxBytes);
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    // Guard against servers that lied about Content-Length (or omitted it entirely).
    if (buffer.byteLength > maxBytes) {
      throw new AttachmentTooLargeError(buffer.byteLength, maxBytes);
    }
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Result of a resize operation. `contentType` reflects the *output* MIME type,
 * which differs from the input when resize fires (always produces JPEG). The
 * caller is responsible for using this contentType in the downstream data URL
 * or HTTP header — mixing input MIME with post-resize bytes would produce a
 * payload like `data:image/png;base64,<JPEG bytes>`, which is technically
 * wrong even though major LLM providers auto-detect from bytes.
 */
export interface ResizeResult {
  buffer: Buffer;
  contentType: string;
}

/**
 * Resize an image buffer if it exceeds MEDIA_LIMITS.MAX_IMAGE_SIZE.
 * Non-images are returned as-is. When resize fires, the output is always JPEG.
 *
 * Lifted from api-gateway's AttachmentStorageService.resizeImageIfNeeded —
 * same algorithm, same JPEG output. Moved here so ai-worker owns the whole
 * download + resize pipeline. Return type widened to carry the output MIME
 * so callers can build correctly-typed data URLs.
 */
export async function resizeImageIfNeeded(
  buffer: Buffer,
  contentType: string
): Promise<ResizeResult> {
  if (!contentType.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
    return { buffer, contentType };
  }

  const originalSize = buffer.byteLength;
  if (originalSize <= MEDIA_LIMITS.MAX_IMAGE_SIZE) {
    // debug, not info: fires on every non-oversized image; a typical message
    // with several attachments would produce one of these lines per image
    // at info level and bury more important signals in the log aggregator.
    logger.debug({ originalSize }, 'Image within size limit, no resize needed');
    return { buffer, contentType };
  }

  logger.info(
    {
      originalSize,
      maxSize: MEDIA_LIMITS.MAX_IMAGE_SIZE,
      sizeMB: (originalSize / 1024 / 1024).toFixed(2),
    },
    'Image exceeds size limit, resizing...'
  );

  const scaleFactor = Math.sqrt(MEDIA_LIMITS.IMAGE_TARGET_SIZE / originalSize);
  const metadata = await sharp(buffer).metadata();
  // 2048 fallback: sharp couldn't read dimensions (malformed/truncated image).
  // Buffer is already size-capped at MAX_ATTACHMENT_BYTES and allowlist-checked,
  // so this is a safety net, not a security concern. 2048px is roughly the
  // median width of Discord screenshot/image uploads we see in practice.
  // Warn so post-deploy debugging can trace which image triggered the fallback.
  if (metadata.width === undefined) {
    logger.warn(
      { originalSize, contentType },
      'Could not read image width from metadata; using 2048 fallback for resize'
    );
  }
  const newWidth = Math.floor((metadata.width ?? 2048) * scaleFactor);

  const resized = await sharp(buffer)
    .resize(newWidth, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: MEDIA_LIMITS.IMAGE_QUALITY })
    .toBuffer();

  logger.info(
    {
      originalSize,
      resizedSize: resized.byteLength,
      reduction: ((1 - resized.byteLength / originalSize) * 100).toFixed(1) + '%',
      newWidth,
    },
    'Image resized successfully'
  );

  return { buffer: resized, contentType: CONTENT_TYPES.IMAGE_JPG };
}

/**
 * Encode a buffer as a `data:` URL with the given content type.
 * Used to flow pre-downloaded bytes through code paths that expect a URL
 * (LangChain's `image_url.url`, `fetch(url)` in AudioProcessor) without
 * re-fetching — Node's fetch and every major LLM SDK accept data URLs.
 */
export function bufferToDataUrl(buffer: Buffer, contentType: string): string {
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}
