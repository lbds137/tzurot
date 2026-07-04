/**
 * Worker-side vision-description persistence: the producer of attachment
 * descriptions persists them.
 *
 * The trigger user message is saved pre-submission with PLACEHOLDER
 * attachment text; once vision/transcription completes, the row's content is
 * upgraded to the rich descriptions. This write previously lived in
 * bot-client's delivery path (a result round-trip through Discord delivery),
 * which coupled the upgrade to generation success and left the placeholder
 * window open for the whole generation. Writing here — immediately
 * post-vision, via the worker's OWN Prisma (an AI-domain write, same class
 * as memory writes) — shrinks that window and persists descriptions even
 * when generation later fails.
 *
 * Never throws: the upgrade is an enhancement to history quality, not a
 * pipeline-critical step. A failed write leaves placeholders — the same
 * acceptable degradation the bot-side path had.
 */

import { AttachmentType } from '@tzurot/common-types/constants/media';
import { type JobContext } from '@tzurot/common-types/types/jobs';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type ConversationHistoryService } from '@tzurot/conversation-history';
import { buildAttachmentDescriptions } from '../RAGUtils.js';
import type { ProcessedAttachment } from '../MultimodalProcessor.js';

const logger = createLogger('VisionDescriptionWriter');

/**
 * Build a URL → description map from the per-reference processed attachments.
 * Only successful image descriptions are included: `referenceAttachments` is
 * assembled exclusively from successful image-description child jobs, so a
 * fallback marker for a failed image never reaches here.
 */
function buildReferenceDescriptionMap(
  referenceAttachments: Record<number, ProcessedAttachment[]>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const attachments of Object.values(referenceAttachments)) {
    for (const att of attachments) {
      if (
        att.type === AttachmentType.Image &&
        att.description.length > 0 &&
        att.originalUrl.length > 0
      ) {
        map.set(att.originalUrl, att.description);
      }
    }
  }
  return map;
}

export class VisionDescriptionWriter {
  constructor(private readonly history: ConversationHistoryService) {}

  /**
   * Upgrade the trigger user message's placeholders to rich descriptions.
   *
   * The enriched content mirrors the retired bot-side composition exactly:
   * `message + '\n\n' + descriptions`, or descriptions alone when the
   * message has no text (voice-only / image-only triggers).
   */
  async persistTriggerDescriptions(opts: {
    jobId: string | number | undefined;
    message: string | object;
    jobContext: JobContext;
    personalityId: string;
    processedAttachments: ProcessedAttachment[];
  }): Promise<void> {
    try {
      const { jobContext, personalityId } = opts;
      const descriptions = buildAttachmentDescriptions(opts.processedAttachments);
      // length check too: unrecognized attachment types format to '' and the
      // builder joins them to an empty string rather than undefined.
      if (descriptions === undefined || descriptions.length === 0) {
        return;
      }
      if (
        typeof opts.message !== 'string' ||
        jobContext.channelId === undefined ||
        jobContext.channelId.length === 0 ||
        jobContext.activePersonaId === undefined
      ) {
        logger.debug(
          { jobId: opts.jobId },
          'Skipping vision-description persist (non-string message or missing channel/persona)'
        );
        return;
      }

      const enrichedContent =
        opts.message.length > 0 ? `${opts.message}\n\n${descriptions}` : descriptions;

      const updated = await this.history.updateLastUserMessage(
        jobContext.channelId,
        personalityId,
        jobContext.activePersonaId,
        enrichedContent
      );
      logger.debug(
        { jobId: opts.jobId, updated, descriptionLength: descriptions.length },
        'Upgraded trigger-message placeholders to rich attachment descriptions'
      );
    } catch (error) {
      logger.warn(
        { err: error, jobId: opts.jobId },
        'Vision-description persist failed (placeholders remain)'
      );
    }
  }

  /**
   * Persist resolved image descriptions for the trigger message's *referenced*
   * (quoted / replied-to) images into durable stored metadata.
   *
   * Reference-image descriptions otherwise live only in the ~1h Redis vision
   * cache the hydrator reads from; once it expires, a quoted image renders as a
   * bare `[image/type: name]` marker on replay. Writing them into the trigger
   * row's `referencedMessages[].resolvedImageDescriptions` makes them durable.
   *
   * Only the dependency-job (production) path is covered: `referenceAttachments`
   * is built exclusively from successful image-description child jobs, so failed
   * descriptions are never persisted. The inline-fallback describe path is not
   * persisted — it only runs when a dependency job produced no result, i.e.
   * there is no successful description to persist anyway.
   *
   * Never throws: a history-quality enhancement, not a pipeline-critical step.
   */
  async persistReferenceDescriptions(opts: {
    jobId: string | number | undefined;
    jobContext: JobContext;
    personalityId: string;
    processedReferenceAttachments: Record<number, ProcessedAttachment[]>;
  }): Promise<void> {
    try {
      const { jobContext, personalityId, processedReferenceAttachments } = opts;
      const descriptionsByUrl = buildReferenceDescriptionMap(processedReferenceAttachments);
      if (descriptionsByUrl.size === 0) {
        return;
      }

      if (
        jobContext.channelId === undefined ||
        jobContext.channelId.length === 0 ||
        jobContext.activePersonaId === undefined
      ) {
        logger.debug(
          { jobId: opts.jobId },
          'Skipping reference-description persist (missing channel/persona)'
        );
        return;
      }

      const updatedRefs = await this.history.persistReferenceImageDescriptions(
        jobContext.channelId,
        personalityId,
        jobContext.activePersonaId,
        descriptionsByUrl
      );
      logger.debug(
        { jobId: opts.jobId, updatedRefs, imageCount: descriptionsByUrl.size },
        'Persisted reference image descriptions'
      );
    } catch (error) {
      logger.warn(
        { err: error, jobId: opts.jobId },
        'Reference-description persist failed (cache-only hydration remains)'
      );
    }
  }
}
