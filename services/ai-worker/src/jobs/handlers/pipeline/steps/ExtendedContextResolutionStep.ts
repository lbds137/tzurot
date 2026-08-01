/**
 * Extended-Context Resolution Step
 *
 * Resolves `context.extendedContextAttachments` ONCE, at the pipeline's front
 * door, so that no later step has to interpret the field's absence.
 *
 * ## Why this step exists
 *
 * bot-client stopped shipping the resolved list with the thin envelope, and the
 * pipeline compensated by treating an ABSENT field as an unnamed instruction:
 * "derive the list from the raw envelope instead." Nothing typed that
 * convention and nothing named it, so a correct-looking normalization
 * (`?? []`) in an unrelated step switched extended-context vision off for the
 * whole service — silently, because an empty list and a filtered-to-empty list
 * are indistinguishable downstream. That was a live production regression.
 *
 * The seam test added alongside the fix catches THAT instance. It cannot stop
 * the next one, because the hazard is the convention, not the line. Resolving
 * here removes the convention: after this step the field is always a real
 * array, so there is no absence left to misread and `??` has nothing to fall
 * through to.
 *
 * ## Why here specifically
 *
 * Two constraints, and only the second one fixes the position:
 *
 * - **After `ConfigStep`**, which is what populates `configOverrides.maxImages`
 *   — the cap the derivation needs. That is a lower bound, not a placement:
 *   anywhere after ConfigStep would satisfy it.
 * - **Before `DownloadAttachmentsStep`**, which is the reason it sits exactly
 *   here. Resolving first means extended-context images enter that step's
 *   download grouping at all, so they go through the same fetch and queue-age
 *   gate as trigger attachments. Previously the field was absent when that step
 *   ran, so they skipped it entirely and reached vision as raw CDN URLs that
 *   could have expired while the job sat in a backed-up queue.
 */

import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { IPipelineStep, GenerationContext } from '../types.js';

const logger = createLogger('ExtendedContextResolution');

/**
 * Derive the extended-context image list from the raw envelope.
 *
 * The raw list is images-only and uncapped (the channel fetcher collects only
 * images; raw inputs ship pre-decision) — apply the SAME cap rule the bot
 * applied at ship time: most-recent-maxImages via `slice(-cap)`, and
 * `maxImages <= 0` means the feature is off.
 *
 * `rawImages` is oldest-first (the fetcher's collection order, preserved on the
 * wire), so `slice(-cap)` keeps the most-recent `cap` items — matching the bot's
 * own `slice(-maxImages)` on the same-ordered list.
 *
 * Returns `[]` rather than `undefined` for the off/empty cases: this function
 * feeds the front-door resolution, whose entire purpose is that no downstream
 * reader ever sees an absent field again.
 */
export function deriveExtendedContextImages(
  rawImages: AttachmentMetadata[] | undefined,
  maxImages: number | undefined
): AttachmentMetadata[] {
  if (rawImages === undefined) {
    return [];
  }
  const cap = maxImages ?? 0;
  if (cap <= 0) {
    return [];
  }
  return rawImages.slice(-cap);
}

/**
 * Resolve the list the rest of the pipeline will use.
 *
 * A list the payload shipped explicitly wins outright — including an explicitly
 * EMPTY one, which is a real decision ("this job has no extended-context
 * images") and must not be second-guessed by re-deriving from the envelope.
 * That distinction is the one thing about the old absent-field convention worth
 * preserving, and `!== undefined` preserves it where `??` on a resolved field
 * no longer can.
 *
 * Invariant this keeps: a payload field must never be the only carrier of data
 * the envelope also holds — otherwise dropping it from the thin payload
 * silently loses the data.
 */
export function resolveExtendedContextImages(
  jobContext: GenerationContext['job']['data']['context'] | undefined,
  maxImages: number | undefined
): AttachmentMetadata[] {
  if (jobContext?.extendedContextAttachments !== undefined) {
    return jobContext.extendedContextAttachments;
  }
  return deriveExtendedContextImages(
    jobContext?.rawAssemblyInputs?.rawExtendedContextImageAttachments,
    maxImages
  );
}

export class ExtendedContextResolutionStep implements IPipelineStep {
  readonly name = 'ExtendedContextResolution';

  process(context: GenerationContext): Promise<GenerationContext> {
    const jobContext = context.job.data.context;
    if (jobContext === undefined) {
      return Promise.resolve(context);
    }

    const shippedByPayload = jobContext.extendedContextAttachments !== undefined;
    const resolved = resolveExtendedContextImages(jobContext, context.configOverrides?.maxImages);
    jobContext.extendedContextAttachments = resolved;

    if (resolved.length > 0) {
      logger.debug(
        {
          count: resolved.length,
          source: shippedByPayload ? 'payload' : 'envelope',
          maxImages: context.configOverrides?.maxImages,
        },
        'Resolved extended-context images'
      );
    }

    return Promise.resolve(context);
  }
}
