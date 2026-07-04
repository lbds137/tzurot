/**
 * POST /ai/transcribe
 * Transcribe audio attachments via ElevenLabs STT (BYOK) or voice-engine
 */

import { type Request, type Response, type RequestHandler } from 'express';
import { randomUUID } from 'crypto';
import { JobStatus, JobType, JOB_PREFIXES } from '@tzurot/common-types/constants/queue';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { TranscribeRequestSchema } from '@tzurot/common-types/schemas/api/transcribe';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type AudioTranscriptionResult } from '@tzurot/common-types/types/jobs';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { sendZodError } from '../../utils/zodHelpers.js';
import { addValidatedJob } from '../../utils/validatedQueue.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('AIRouter');

/**
 * Resolve the user's `showModelFooter` user-default for the STT footer
 * attribution line. Hardcoded default is `true`; only an explicit user-default
 * `false` suppresses the footer. Returns `true` for unknown users so the
 * footer keeps showing in the legacy "system" / unprovisioned case.
 *
 * Inlined here (rather than going through the full ConfigCascadeResolver)
 * because the cascade is overkill for one boolean field with no personality
 * or channel scope.
 */
async function resolveShowModelFooter(prisma: PrismaClient, discordId: string): Promise<boolean> {
  if (discordId === 'system') {
    return true;
  }
  try {
    const user = await prisma.user.findFirst({
      // eslint-disable-next-line no-restricted-syntax -- transcribe endpoint receives the Discord ID directly in the request body (not via requireProvisionedUser middleware); a single non-cascading lookup keyed on it is the simplest way to read the user-default
      where: { discordId },
      select: { configDefaults: true },
    });
    // Prisma's `Json?` lands as `Prisma.JsonValue | null` which can also be
    // an array or primitive. Guard explicitly so the cast below is honest:
    // only an object literal can carry a `showModelFooter` field. All other
    // shapes (including null and arrays) fail open to true.
    const defaults = user?.configDefaults;
    if (defaults === null || typeof defaults !== 'object' || Array.isArray(defaults)) {
      return true;
    }
    return (defaults as Record<string, unknown>).showModelFooter !== false;
  } catch (err) {
    // Fail-open: any DB hiccup leaves the footer showing — preserves the
    // historical behavior rather than silently suppressing on a transient.
    logger.warn({ err, discordId }, 'showModelFooter lookup failed; defaulting to true');
    return true;
  }
}

/**
 * POST /api/internal/ai/transcribe — transcribe audio attachments.
 *
 * Query parameters:
 * - wait=true: Wait for job completion using Redis pub/sub (no polling).
 *   `result.showModelFooter` is resolved from the user's default and
 *   returned alongside the transcript.
 * - wait=false (default): Return job ID immediately. The caller is
 *   responsible for fetching the job result via polling; that path does
 *   NOT inject `showModelFooter`, so a polling caller that wants the
 *   toggle must resolve user preferences separately. The sole caller
 *   (bot-client) always uses `?wait=true`, which keeps this safe.
 */
export const handleAiTranscribe = (deps: RouteDeps): RequestHandler => {
  const { prisma, aiQueue, queueEvents } = deps;
  if (aiQueue === undefined || queueEvents === undefined) {
    return (_req, res) => {
      sendError(res, ErrorResponses.serviceUnavailable('BullMQ queue not configured'));
    };
  }
  return asyncHandler(async (req: Request, res: Response) => {
    const startTime = Date.now();
    const waitForCompletion = req.query.wait === 'true';

    // Validate request body with Zod schema
    const parseResult = TranscribeRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendZodError(res, parseResult.error);
    }

    const { attachments, userId } = parseResult.data;
    const requestId = randomUUID();

    if (attachments.length === 0) {
      return sendError(res, ErrorResponses.internalError('No audio attachment provided'));
    }

    // Attachment URL flows through unchanged — ai-worker's AudioProcessor
    // fetches the Discord CDN URL directly (with SSRF validation).
    const audioAttachment = attachments[0];

    // Create audio transcription job using new job type
    const jobData = {
      requestId,
      jobType: JobType.AudioTranscription,
      attachment: audioAttachment,
      context: {
        userId: userId ?? 'system',
        channelId: 'api',
      },
      responseDestination: {
        type: 'api' as const,
      },
    };

    // Add job to queue with automatic validation
    // Throws error if validation fails (caught by asyncHandler)
    const job = await addValidatedJob(aiQueue, JobType.AudioTranscription, jobData, {
      jobId: `${JOB_PREFIXES.AUDIO_TRANSCRIPTION}${requestId}`,
    });

    logger.info({ jobId: job.id, durationMs: Date.now() - startTime }, 'Created transcribe job');

    // If client wants to wait, use Redis pub/sub. `showModelFooter` is
    // resolved only on this path because the sole caller (bot-client)
    // always invokes with `?wait=true`. An async-polling caller would
    // see `showModelFooter: undefined` on the result, which the bot-client
    // treats as "render footer" (back-compat fallback) — if a future
    // caller adopts polling and needs the toggle, the resolution needs
    // to move into the non-wait branch (or run unconditionally).
    if (waitForCompletion) {
      try {
        const [result, showModelFooter] = await Promise.all([
          job.waitUntilFinished(
            queueEvents,
            TIMEOUTS.JOB_WAIT
          ) as Promise<AudioTranscriptionResult>,
          resolveShowModelFooter(prisma, userId ?? 'system'),
        ]);

        logger.info(
          { jobId: job.id, durationMs: Date.now() - startTime },
          'Transcribe job completed'
        );

        // Inject the user-default `showModelFooter` into the result so the
        // bot-client can gate the `-# Transcribed by X` attribution line
        // without a separate roundtrip. Resolution runs in parallel with
        // the transcription job, so this adds zero latency on the hot path.
        const enrichedResult: AudioTranscriptionResult = {
          ...result,
          showModelFooter,
        };

        return sendCustomSuccess(res, {
          jobId: job.id ?? requestId,
          requestId,
          status: JobStatus.Completed,
          result: enrichedResult,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ err: error, jobId: job.id }, `Transcribe job ${job.id} failed`);

        return sendError(
          res,
          ErrorResponses.jobFailed(
            error instanceof Error ? error.message : 'Transcription failed or timed out'
          )
        );
      }
    }

    // Default: return job ID immediately
    sendCustomSuccess(res, {
      jobId: job.id ?? requestId,
      requestId,
      status: JobStatus.Queued,
    });
  });
};
