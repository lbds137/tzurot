/**
 * Download Attachments Step
 *
 * Downloads attachment bytes from Discord CDN URLs, applies a size cap,
 * resizes oversized images, and embeds the bytes in a `data:` URL so that
 * downstream consumers (LangChain vision, AudioProcessor fetch) never hit
 * the network again for these attachments.
 *
 * Replaces api-gateway's AttachmentStorageService.downloadAndStore — moving
 * this work off the synchronous HTTP request handler so `/ai/generate`
 * returns in milliseconds regardless of attachment size.
 *
 * Responsibilities (in order):
 * 1. Queue-age gate — fail fast with ExpiredJobError if job has sat long
 *    enough that Discord CDN URLs have likely expired.
 * 2. Validate each URL against the SSRF allowlist.
 * 3. Fetch bytes with a per-attachment timeout and size cap.
 * 4. Resize large images (≥ MAX_IMAGE_SIZE) in-memory.
 * 5. Rewrite `attachment.url` to a `data:` URL; preserve Discord CDN URL as
 *    `originalUrl` for VisionDescriptionCache cache keys.
 *
 * Failure behavior: any fatal per-attachment failure fails the whole step,
 * which the outer pipeline handler surfaces to Discord via the existing async
 * error-result path.
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

const logger = createLogger('DownloadAttachmentsStep');

/**
 * Maximum age a job may have sat in the queue before its Discord CDN URLs
 * are considered expired. Discord tokens last ~24h; 12h gives a safety margin
 * that still lets pathological backpressure surface cleanly instead of
 * silently producing 403s from the CDN.
 */
export const MAX_QUEUE_AGE_MS = 12 * 60 * 60 * 1000;

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

    // Run both groups in parallel. downloadAll never throws — it returns
    // per-attachment successes and failures separately, so neither group can
    // abort the other's in-flight downloads. (Old Promise.all-with-throws
    // would have orphaned the second group's downloads if the first rejected
    // first; bytes downloaded, buffers allocated, then GC'd. Wasted work.)
    const [triggerResult, extendedResult] = await Promise.all([
      this.downloadAll(triggerAttachments, 'trigger', job.id),
      this.downloadAll(extendedAttachments, 'extended', job.id),
    ]);

    // Aggregate failures from both groups before throwing — one combined
    // error message lists every failed attachment with its array context,
    // so a log-grepping responder sees both the filename and which group.
    const allFailures = [...triggerResult.failures, ...extendedResult.failures];
    if (allFailures.length > 0) {
      throw new Error(
        `Failed to download ${allFailures.length} attachment(s): ${allFailures.join('; ')}`
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
      return attachment;
    }

    const sanitizedUrl = validateAttachmentUrl(attachment.url);

    const buffer = await this.fetchWithRetry(sanitizedUrl, attachment.name, jobId);
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

  private async fetchWithRetry(
    url: string,
    name: string | undefined,
    jobId: string | undefined
  ): Promise<Buffer> {
    try {
      return await fetchAttachmentBytes(url, { maxBytes: MAX_ATTACHMENT_BYTES });
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
      logger.warn({ jobId, name, err: error }, 'Attachment fetch failed, retrying once');
      await new Promise(resolve => setTimeout(resolve, this.retryDelayMs));
      return fetchAttachmentBytes(url, { maxBytes: MAX_ATTACHMENT_BYTES });
    }
  }
}
