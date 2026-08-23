/**
 * Resolve the image input a vision provider should receive for an attachment.
 *
 * Extracted from VisionProcessor.ts to keep that file under the repo's
 * max-lines budget — this logic has no dependency on vision-model selection,
 * caching, or provider invocation, so it stands alone cleanly.
 */

import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isDataUrl, HttpError } from '../../utils/attachmentFetch.js';
import { downloadImageToDataUrl } from '../../utils/imageToDataUrl.js';
import { ExpiredCdnUrlError, isDiscordCdnUrl } from '../../utils/discordCdnExpiry.js';

const logger = createLogger('VisionProcessor');

/**
 * Diagnostic context needed to log a resolution attempt. A structural subset
 * of `VisionLoggingContext` (defined in VisionProcessor.ts) — kept local
 * rather than imported to avoid a circular import between the two files.
 */
export interface VisionImageResolutionLoggingContext {
  jobId?: string;
}

/**
 * Tagged result of resolving the vision provider's image input.
 * `dead` means the URL is a Discord CDN URL we've proven cannot succeed —
 * neither our own fetch nor a downstream provider fetch of the SAME signed
 * URL from the SAME host can work, so the caller must skip the vision call
 * entirely rather than hand the provider a doomed URL.
 */
export type VisionImageResolution =
  { kind: 'resolved'; imageUrl: string } | { kind: 'dead'; reason: string };

/**
 * Resolve the image URL the vision provider should receive: a `data:` URL of
 * worker-fetched bytes for remote images, so the provider never has to fetch a
 * URL it might be unable to reach. OpenRouter can't fetch Discord's external-
 * image proxy (`images-ext-1.discordapp.net`, 403s on its datacenter egress),
 * and signed Discord-CDN URLs expire — but our own SSRF-guarded fetcher pulls
 * both. Already-inlined images (a `data:` URL, e.g. from DownloadAttachmentsStep)
 * are returned untouched.
 *
 * On most download failures, falls back to the ORIGINAL remote URL so the
 * provider can try hosts our egress can't reach — logged so the fallback rate
 * is observable. The one exception is a Discord-CDN URL we've PROVEN dead
 * (expired signature, or our own fetch got 403/404 from that same host): the
 * provider would fetch the identical signed URL from the identical host, so
 * handing it over cannot succeed either — it only buys a billed call that
 * ends in `media_not_found`. That case reports `kind: 'dead'` instead of
 * falling back, so the caller can skip the provider call entirely.
 *
 * Returns only the URL/reason; the caller keeps the original `attachment` for
 * cache keys.
 */
export async function resolveVisionImageUrl(
  attachment: AttachmentMetadata,
  loggingContext: VisionImageResolutionLoggingContext
): Promise<VisionImageResolution> {
  if (isDataUrl(attachment.url)) {
    return { kind: 'resolved', imageUrl: attachment.url };
  }
  try {
    const { dataUrl } = await downloadImageToDataUrl(attachment.url, {
      contentType: attachment.contentType,
      name: attachment.name,
      jobId: loggingContext.jobId,
    });
    return { kind: 'resolved', imageUrl: dataUrl };
  } catch (error) {
    if (error instanceof ExpiredCdnUrlError) {
      return { kind: 'dead', reason: 'discord-cdn-url-expired' };
    }
    if (
      error instanceof HttpError &&
      (error.status === 403 || error.status === 404) &&
      isDiscordCdnUrl(attachment.url)
    ) {
      return { kind: 'dead', reason: `discord-cdn-http-${error.status}` };
    }
    // Broad by design: ANY OTHER download failure — including
    // AttachmentTooLargeError — degrades to handing the provider the original
    // URL. Unlike DownloadAttachmentsStep, where an over-size image is a hard
    // fail, the vision provider may accept larger images than our own fetch
    // cap, so we let it try rather than rethrow. Do NOT add an `instanceof
    // AttachmentTooLargeError` rethrow here thinking it closes a gap; the
    // fallback rate is observable via the imageFetchFallback log field below.
    logger.warn(
      {
        jobId: loggingContext.jobId,
        attachmentId: attachment.id,
        name: attachment.name,
        err: error,
        imageFetchFallback: true,
      },
      'Vision image download failed; falling back to provider URL fetch'
    );
    return { kind: 'resolved', imageUrl: attachment.url };
  }
}
