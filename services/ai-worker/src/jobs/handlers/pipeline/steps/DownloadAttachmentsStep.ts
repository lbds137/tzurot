/**
 * Download Attachments Step
 *
 * Downloads attachment bytes from Discord-CDN OR safe-external image URLs,
 * applies a size cap, resizes oversized images, and embeds the bytes in a
 * `data:` URL so that downstream consumers (LangChain vision, AudioProcessor
 * fetch) never hit the network again for these attachments.
 *
 * Replaces api-gateway's AttachmentStorageService.downloadAndStore — moving
 * this work off the synchronous HTTP request handler so the AI generate
 * route returns in milliseconds regardless of attachment size.
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

import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { IPipelineStep, GenerationContext } from '../types.js';
import {
  JobPayloadTooLargeError,
  isDataUrl,
  MAX_AGGREGATE_PAYLOAD_BYTES,
} from '../../../../utils/attachmentFetch.js';
import { checkQueueAge } from '../../../../utils/jobAgeGate.js';
import { downloadImageToDataUrl } from '../../../../utils/imageToDataUrl.js';

const logger = createLogger('DownloadAttachmentsStep');

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

/**
 * Drop sticker-sourced attachments when sticker vision is switched off.
 *
 * Filtering here rather than at the describe call is what makes "off" actually
 * free: a dropped sticker is never downloaded, never resized, and never counted
 * against the job's aggregate payload cap.
 */
function keepStickersIf(enabled: boolean, attachments: AttachmentMetadata[]): AttachmentMetadata[] {
  return enabled ? attachments : attachments.filter(a => a.isSticker !== true);
}

/**
 * Apply the sticker filter WITHOUT inventing a value for a field that was absent.
 *
 * `undefined` and `[]` are different states on `extendedContextAttachments`, and
 * a later step reads the difference: bot-client stopped shipping the field with
 * the thin envelope, so `DependencyStep` treats absence as "derive the list from
 * the raw envelope instead" via `?? deriveExtendedContextImages(...)`. `??` does
 * not fall through on `[]`. Normalizing absent to empty here therefore switched
 * OFF every extended-context image description — silently, because an empty list
 * and a filtered-to-empty list look identical downstream.
 *
 * Filtering an absent list still yields absent; only a list that was really there
 * can be really emptied.
 */
function filterOptional(
  enabled: boolean,
  attachments: AttachmentMetadata[] | undefined
): AttachmentMetadata[] | undefined {
  return attachments === undefined ? undefined : keepStickersIf(enabled, attachments);
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

    // Sticker attachments are dropped here, before any network work, when the
    // runtime switch is off — bot-client always sends them (it has no reader for
    // system settings), so this is the single point where the feature is on or
    // off. Dropping them costs the message nothing: the `[Stickers: …]` line
    // that bot-client renders into the content names every sticker regardless,
    // so the character still knows one arrived and what it was called.
    const stickerVisionEnabled = getSystemSetting('stickerVisionEnabled');
    const triggerAttachments = keepStickersIf(
      stickerVisionEnabled,
      job.data.context?.attachments ?? []
    );
    // Absence is load-bearing on this field — see filterOptional. Keep the
    // possibly-undefined form for the write-back; the local download work below
    // uses the `?? []` view.
    const extendedOptional = filterOptional(
      stickerVisionEnabled,
      job.data.context?.extendedContextAttachments
    );
    const extendedAttachments = extendedOptional ?? [];

    // Publish the filtered view BEFORE the short-circuit below. When the switch
    // drops the only attachment on a message, the early return fires and the
    // write-back at the end of process() never runs — leaving the dropped
    // sticker visible to every downstream step, which is the opposite of off.
    if (job.data.context !== undefined) {
      job.data.context.attachments = triggerAttachments;
      job.data.context.extendedContextAttachments = extendedOptional;
    }

    // No attachments → nothing to expire. Short-circuit before the queue-age
    // gate so text-only jobs that sit through a backpressure incident don't
    // fail with "URLs have likely expired" when there are no URLs to expire.
    if (triggerAttachments.length === 0 && extendedAttachments.length === 0) {
      return context;
    }

    // Queue-age gate — runs only when we're actually about to fetch CDN URLs.
    // Hits before any fetch so a backed-up queue fails with a clear classified
    // error instead of a pile of 403s from the CDN.
    checkQueueAge(job, logger);

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
    //
    // The extended write-back stays absence-preserving for the same reason as
    // the one above: a job carrying trigger attachments but no extended list
    // reaches here with `extendedOptional === undefined`, and writing this
    // group's (empty) successes would re-close the derive path for exactly
    // those jobs.
    if (job.data.context !== undefined) {
      job.data.context.attachments = triggerResult.successes;
      job.data.context.extendedContextAttachments =
        extendedOptional === undefined ? undefined : extendedResult.successes;
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

    // Route (Discord allowlist → safe external fallback) + fetch (one retry) +
    // resize + base64, via the shared helper that describeImage also uses, so
    // the two image→vision fetch paths can't diverge.
    const { dataUrl, bytes } = await downloadImageToDataUrl(attachment.url, {
      contentType: attachment.contentType,
      retryDelayMs: this.retryDelayMs,
      jobId,
      name: attachment.name,
    });

    logger.debug(
      { jobId, name: attachment.name, originalUrl: attachment.url, finalBytes: bytes },
      'Attachment downloaded'
    );

    return {
      ...attachment,
      url: dataUrl,
      // Preserve the Discord CDN URL for VisionDescriptionCache key stability.
      // Overwrite any prior local-URL originalUrl; after this refactor the
      // Discord URL flows end-to-end through api-gateway unchanged.
      originalUrl: attachment.originalUrl ?? attachment.url,
      size: bytes,
    };
  }
}
