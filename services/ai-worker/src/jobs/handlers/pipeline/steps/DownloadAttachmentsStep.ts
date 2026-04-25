/**
 * Download Attachments Step
 *
 * Downloads attachment bytes from Discord-CDN OR safe-external image URLs,
 * applies a size cap, resizes oversized images, and embeds the bytes in a
 * `data:` URL so that downstream consumers (LangChain vision, AudioProcessor
 * fetch) never hit the network again for these attachments.
 *
 * Replaces api-gateway's AttachmentStorageService.downloadAndStore — moving
 * this work off the synchronous HTTP request handler so `/ai/generate`
 * returns in milliseconds regardless of attachment size.
 *
 * Responsibilities (in order):
 * 1. Queue-age gate — fail fast with ExpiredJobError if job has sat long
 *    enough that Discord CDN URLs have likely expired.
 * 2. Two-tier URL routing: try strict Discord-CDN allowlist first; on
 *    allowlist failure, fall through to the safe-external fetcher
 *    (DNS-resolution + IP-range guard, browser User-Agent, Content-Type
 *    assertion). Other validation failures (protocol, credentials,
 *    IP-as-hostname) propagate as real client errors.
 * 3. Fetch bytes with a per-attachment timeout and size cap.
 * 4. Resize large images (≥ MAX_IMAGE_SIZE) in-memory.
 * 5. Rewrite `attachment.url` to a `data:` URL; preserve original CDN URL as
 *    `originalUrl` for VisionDescriptionCache cache keys.
 *
 * Failure behavior: per-attachment failures are logged with structured fields
 * and aggregated. The step throws ONLY when all attachments fail AND the
 * trigger message has no text content (which would leave the LLM with an
 * empty prompt and force a hallucinated "I don't see anything" response).
 * In every other case — partial failure, all-fail-with-text — survivors
 * proceed and the LLM gets whatever context is available. The throw, when
 * it fires, is classified by the outer LLMGenerationHandler catch as
 * MEDIA_NOT_FOUND so users see the failure list in a Discord spoiler tag.
 */

import { createLogger, type AttachmentMetadata } from '@tzurot/common-types';
import type { IPipelineStep, GenerationContext } from '../types.js';
import {
  validateAttachmentUrl,
  fetchAttachmentBytes,
  resizeImageIfNeeded,
  bufferToDataUrl,
  ExpiredJobError,
  AttachmentTooLargeError,
  HttpError,
  JobPayloadTooLargeError,
  isDataUrl,
  MAX_ATTACHMENT_BYTES,
  MAX_AGGREGATE_PAYLOAD_BYTES,
} from '../../../../utils/attachmentFetch.js';
import {
  validateExternalImageUrl,
  fetchExternalImageBytes,
} from '../../../../utils/safeExternalFetch.js';

const logger = createLogger('DownloadAttachmentsStep');

/**
 * Maximum age a job may have sat in the queue before its Discord CDN URLs
 * are considered expired. Discord tokens last ~24h; 12h gives a safety margin
 * that still lets pathological backpressure surface cleanly instead of
 * silently producing 403s from the CDN.
 */
export const MAX_QUEUE_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * True if the user's trigger-message payload carries any meaningful text.
 *
 * `job.data.message` is `string | object`. The string case is straightforward.
 * The object case is the typical structured shape with a `content` field
 * (from ConversationalRAGService); inspect that field if present.
 *
 * Unknown object shapes (no `content` field, or `content` not a string) are
 * treated as empty text — fails closed in the conservative direction so a
 * shape we don't recognize defaults to the throw path rather than silently
 * proceeding into an LLM call with no extractable user prompt. If a new
 * structured-message shape gets added upstream, extend this function before
 * shipping it; otherwise all-fail-attachments + that shape would reject when
 * proceed is correct.
 *
 * Used by `process()` to decide whether to throw when all attachments fail —
 * if the user said *anything* in text, the LLM has something to respond to.
 */
function hasMessageText(message: string | object | undefined): boolean {
  if (message === undefined) {
    return false;
  }
  if (typeof message === 'string') {
    return message.trim().length > 0;
  }
  if (typeof message === 'object' && message !== null && 'content' in message) {
    const content = (message as { content?: unknown }).content;
    return typeof content === 'string' && content.trim().length > 0;
  }
  // TODO: when a new structured-message shape lands upstream (e.g. an
  // array-of-parts shape, or a wrapper with a non-`content` text field),
  // add a branch here BEFORE merging that change. The current shapes are:
  //   - string                      → handled above
  //   - { content: string, ... }    → handled above (ConversationalRAGService)
  //   - anything else                → reaches this `return false` and is
  //                                    treated as text-empty (fail closed).
  return false;
}

export class DownloadAttachmentsStep implements IPipelineStep {
  readonly name = 'DownloadAttachments';

  /**
   * @param retryDelayMs - Backoff before the single retry on transient network
   *   failures. Defaults to 500ms. Tests pass 0 to avoid waiting on real time;
   *   production code has no reason to override it.
   */
  constructor(private readonly retryDelayMs = 500) {}

  async process(context: GenerationContext): Promise<GenerationContext> {
    const { job } = context;

    const triggerAttachments = job.data.context?.attachments ?? [];
    const extendedAttachments = job.data.context?.extendedContextAttachments ?? [];

    // No attachments → nothing to expire. Short-circuit before the queue-age
    // gate so text-only jobs that sit through a backpressure incident don't
    // fail with "URLs have likely expired" when there are no URLs to expire.
    if (triggerAttachments.length === 0 && extendedAttachments.length === 0) {
      return context;
    }

    // Queue-age gate — runs only when we're actually about to fetch CDN URLs.
    // Hits before any fetch so a backed-up queue fails with a clear classified
    // error instead of a pile of 403s from the CDN.
    const queueAgeMs = Date.now() - job.timestamp;
    if (queueAgeMs > MAX_QUEUE_AGE_MS) {
      logger.warn(
        { jobId: job.id, queueAgeMs, maxQueueAgeMs: MAX_QUEUE_AGE_MS },
        'Job exceeded queue-age threshold; Discord CDN URLs likely expired'
      );
      throw new ExpiredJobError(queueAgeMs);
    }

    logger.info(
      {
        jobId: job.id,
        triggerCount: triggerAttachments.length,
        extendedCount: extendedAttachments.length,
      },
      'Downloading attachments in parallel'
    );

    // Invariant: downloadAll never throws — it always returns a settled
    // { successes, failures } pair. This means Promise.all here can never
    // reject, so neither group can abort the other's in-flight downloads.
    const [triggerResult, extendedResult] = await Promise.all([
      this.downloadAll(triggerAttachments, 'trigger', job.id),
      this.downloadAll(extendedAttachments, 'extended', job.id),
    ]);

    // Aggregate failures from both groups. Conditional throw: log every
    // per-attachment failure and proceed with the successes when ANY of the
    // following holds:
    //   - at least one attachment succeeded (LLM has visual context)
    //   - the user message itself has text content (LLM has something to
    //     respond to even if all attachments dropped)
    // Throw only when nothing usable remains — otherwise the LLM would receive
    // an empty prompt and emit a confused/hallucinated "I don't see anything"
    // response. The throw is intentionally classified by the outer
    // LLMGenerationHandler catch as MEDIA_NOT_FOUND so users see the per-URL
    // failure list in the bot reply's spoiler tag.
    const allFailures = [...triggerResult.failures, ...extendedResult.failures];
    for (const failure of allFailures) {
      logger.warn({ jobId: job.id, failure }, 'Attachment download failed');
    }

    const allSuccessesEmpty =
      triggerResult.successes.length === 0 && extendedResult.successes.length === 0;
    const hasUserText = hasMessageText(job.data.message);

    if (allFailures.length > 0 && allSuccessesEmpty && !hasUserText) {
      throw new Error(
        `Failed to download ${allFailures.length} attachment(s) and no text content present: ${allFailures.join('; ')}`
      );
    }

    // Aggregate-size cap: per-attachment cap (MAX_ATTACHMENT_BYTES) is
    // already enforced inside fetchAttachmentBytes, but a job carrying
    // many large non-image attachments (which bypass resize) could still
    // exceed Redis's 512 MiB per-key limit at the BullMQ JSON.stringify
    // boundary. Sum the post-resize sizes and fail with a classified
    // error instead of producing an opaque DataCloneError downstream.
    const totalBytes =
      triggerResult.successes.reduce((sum, a) => sum + (a.size ?? 0), 0) +
      extendedResult.successes.reduce((sum, a) => sum + (a.size ?? 0), 0);
    if (totalBytes > MAX_AGGREGATE_PAYLOAD_BYTES) {
      logger.warn(
        {
          jobId: job.id,
          totalBytes,
          limit: MAX_AGGREGATE_PAYLOAD_BYTES,
          attachmentCount: triggerResult.successes.length + extendedResult.successes.length,
        },
        'Job aggregate attachment payload exceeds limit'
      );
      throw new JobPayloadTooLargeError(totalBytes, MAX_AGGREGATE_PAYLOAD_BYTES);
    }

    // Mutate the job.data view of attachments so downstream steps see data URLs.
    // job.data is a plain object on this worker's copy of the job — safe to assign.
    if (job.data.context !== undefined) {
      job.data.context.attachments = triggerResult.successes;
      job.data.context.extendedContextAttachments = extendedResult.successes;
    }

    return context;
  }

  private async downloadAll(
    attachments: AttachmentMetadata[],
    label: 'trigger' | 'extended',
    jobId: string | undefined
  ): Promise<{ successes: AttachmentMetadata[]; failures: string[] }> {
    const results = await Promise.allSettled(
      attachments.map(attachment => this.downloadOne(attachment, jobId))
    );

    const failures: string[] = [];
    const successes: AttachmentMetadata[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        successes.push(result.value);
      } else {
        const message =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        // Prefix with the array label so the eventual aggregated error tells
        // an incident responder which group the failure came from, not just
        // the filename.
        failures.push(`${label}/${attachments[i].name ?? attachments[i].url}: ${message}`);
      }
    }

    return { successes, failures };
  }

  private async downloadOne(
    attachment: AttachmentMetadata,
    jobId: string | undefined
  ): Promise<AttachmentMetadata> {
    // Defensive: if the upstream producer pre-populated a data URL, or the
    // step were ever invoked twice inside a single pipeline execution, skip
    // the network round-trip. This does NOT protect against BullMQ retries —
    // those re-deserialize job.data from Redis, which still holds the original
    // Discord CDN URLs, so the queue-age gate and full download run on each
    // retry. Safety boundary is "within one pipeline execution," not "across
    // job retries."
    if (isDataUrl(attachment.url)) {
      // Estimate `size` from the data URL string length when the upstream
      // producer omitted it. The aggregate-payload guard in process() folds
      // missing sizes as 0, which would silently undercount pre-populated
      // data URLs. Data URL length ≈ `4/3 × binary_bytes + small prefix`, so
      // `Math.ceil(url.length * 3/4)` reverses the base64 inflation factor
      // and lands within a few bytes of the true binary size. The remaining
      // `data:image/png;base64,` prefix is rounded into the ceiling, keeping
      // this an honest upper-bound estimate.
      return attachment.size !== undefined
        ? attachment
        : { ...attachment, size: Math.ceil((attachment.url.length * 3) / 4) };
    }

    // Two-tier validation: Discord-CDN strict allowlist first (fast path, no
    // DNS lookup needed). On allowlist failure ONLY, fall through to the safe
    // external-image fetcher which adds DNS-resolution + IP-range check + UA +
    // Content-Type assertion. Other validation failures (bad protocol, creds,
    // IP-as-hostname) propagate — those are real client errors, not allowlist
    // misses, and shouldn't be retried via a more permissive path.
    const { sanitizedUrl, isExternal } = this.routeAttachmentUrl(attachment.url);

    const buffer = await this.fetchWithRetry(sanitizedUrl, attachment.name, jobId, isExternal);
    // Use the *output* contentType from resize when building the data URL —
    // resize always produces JPEG, so the data URL's MIME must reflect that
    // even if the original upload was PNG. attachment.contentType (the metadata
    // field) stays as the original upload type for downstream bookkeeping.
    const { buffer: finalBuffer, contentType: finalContentType } = await resizeImageIfNeeded(
      buffer,
      attachment.contentType
    );
    const dataUrl = bufferToDataUrl(finalBuffer, finalContentType);

    logger.debug(
      {
        jobId,
        name: attachment.name,
        originalUrl: attachment.url,
        fetchedBytes: buffer.byteLength,
        finalBytes: finalBuffer.byteLength,
      },
      'Attachment downloaded'
    );

    return {
      ...attachment,
      url: dataUrl,
      // Preserve the Discord CDN URL for VisionDescriptionCache key stability.
      // Overwrite any prior local-URL originalUrl; after this refactor the
      // Discord URL flows end-to-end through api-gateway unchanged.
      originalUrl: attachment.originalUrl ?? attachment.url,
      size: finalBuffer.byteLength,
    };
  }

  /**
   * Route a URL to either the Discord-CDN strict path or the safe-external
   * fallback. Returns the sanitized URL plus a flag the fetcher uses to pick
   * the right downloader.
   *
   * Discord-CDN failures from `validateAttachmentUrl` come in two flavors:
   *   - "must be from Discord CDN" → fall through to the external path
   *   - protocol / credentials / port / IP-as-hostname → propagate (these are
   *     real client errors, not allowlist misses)
   *
   * Match by error-message substring for the allowlist case. A typed
   * `AllowlistRejectionError` is the intended structural fix — tracked in
   * BACKLOG. The producer-side comment in `attachmentFetch.validateAttachmentUrl`
   * (search "must be from Discord CDN") documents which message edits would
   * silently break this routing; until the typed error class lands, that
   * substring is load-bearing on both ends. Failure mode if the substring
   * coupling breaks: external URLs stop falling through to the safe path
   * and start failing as if they were real client errors — i.e. the exact
   * production regression this PR was written to fix.
   */
  private routeAttachmentUrl(rawUrl: string): { sanitizedUrl: string; isExternal: boolean } {
    try {
      return { sanitizedUrl: validateAttachmentUrl(rawUrl), isExternal: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('must be from Discord CDN')) {
        throw error;
      }
      // Allowlist miss → try the safe-external path. validateExternalImageUrl
      // throws on its own surface checks (https, no creds, etc.); those errors
      // also propagate as real client errors.
      return { sanitizedUrl: validateExternalImageUrl(rawUrl), isExternal: true };
    }
  }

  private async fetchWithRetry(
    url: string,
    name: string | undefined,
    jobId: string | undefined,
    isExternal: boolean
  ): Promise<Buffer> {
    const fetchOnce = (): Promise<Buffer> =>
      isExternal
        ? fetchExternalImageBytes(url, { maxBytes: MAX_ATTACHMENT_BYTES })
        : fetchAttachmentBytes(url, { maxBytes: MAX_ATTACHMENT_BYTES });

    try {
      return await fetchOnce();
    } catch (error) {
      // 403 is the CDN-expiration signal; don't retry — re-fetching an expired
      // URL just produces another 403 and wastes time. Size-cap violations
      // also don't benefit from retry. Match by typed class and status field
      // rather than message string, so future message-format tweaks can't
      // silently break the guard.
      if (
        (error instanceof HttpError && error.status === 403) ||
        error instanceof AttachmentTooLargeError
      ) {
        throw error;
      }
      logger.warn(
        { jobId, name, err: error, isExternal },
        'Attachment fetch failed, retrying once'
      );
      await new Promise(resolve => setTimeout(resolve, this.retryDelayMs));
      return fetchOnce();
    }
  }
}
