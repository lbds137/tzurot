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

import {
  createLogger,
  type ConversationHistoryService,
  type JobContext,
} from '@tzurot/common-types';
import { buildAttachmentDescriptions } from '../RAGUtils.js';
import type { ProcessedAttachment } from '../MultimodalProcessor.js';

const logger = createLogger('VisionDescriptionWriter');

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
}
