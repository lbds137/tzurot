/**
 * POST /api/internal/ai/generate
 * Create an AI generation job and return 202 Accepted immediately
 */

import { type Request, type Response, type RequestHandler } from 'express';
import { randomUUID } from 'crypto';
import { JobStatus } from '@tzurot/common-types/constants/queue';
import { generateRequestSchema } from '@tzurot/common-types/types/schemas/generation';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getDeduplicationCache } from '../../utils/deduplicationCache.js';
import type { ReserveResult } from '../../utils/RedisDeduplicationCache.js';
import { createJobChain, llmJobIdFor } from '../../utils/jobChainOrchestrator.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendSuccess, sendCustomSuccess, sendError } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { sendZodError } from '../../utils/zodHelpers.js';

const logger = createLogger('AIRouter');

import type { RouteDeps } from '../routeDeps.js';

/**
 * POST /api/internal/ai/generate — create an AI generation job.
 *
 * Reads `deps.llmConfigResolver` to resolve the effective LLM config once at
 * job-chain build time (see `createJobChain`), so the conversation job and the
 * image-description child job share the same user-cascaded model rather than the
 * personality seed. The resolver is required on RouteDeps (compile-enforced);
 * `createJobChain` still tolerates absence for direct-call tests only. The
 * deduplication cache and BullMQ job queue remain module-load singletons
 * accessed via getters.
 */
export const handleAiGenerate = (deps: RouteDeps): RequestHandler =>
  asyncHandler(async (req: Request, res: Response) => {
    const startTime = Date.now();

    // Validate request body
    const validationResult = generateRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      logger.warn({ errors: validationResult.error.issues }, 'Validation error');
      return sendZodError(res, validationResult.error);
    }

    const request = validationResult.data;

    const requestId = randomUUID();

    // The job schemas require kind:'envelope' (the legacy tolerance is
    // retired), while the HTTP schema keeps it optional for construction-site
    // ergonomics. Narrow here so a producer that forgot the discriminant gets
    // a clean 400 instead of an opaque enqueue failure.
    const { kind } = request.context;
    if (kind !== 'envelope') {
      logger.warn({ requestId }, "Rejected generate request without context.kind 'envelope'");
      return sendError(
        res,
        ErrorResponses.validationError(
          "context.kind must be 'envelope' (legacy payloads are no longer supported)",
          requestId
        )
      );
    }
    const jobContext = { ...request.context, kind };

    if (request.context.referencedMessages && request.context.referencedMessages.length > 0) {
      logger.info(
        { requestId, referencedMessagesCount: request.context.referencedMessages.length },
        `Request includes ${request.context.referencedMessages.length} referenced message(s)`
      );
    }

    // Claim the deduplication window BEFORE anything is enqueued: a gateway that
    // dies between enqueue and reservation would otherwise leave a billable job
    // with no dedup entry, and the client's retry would create a second chain.
    const deduplicationCache = getDeduplicationCache();
    // Held so `release` can prove the reservation it deletes is this request's
    // — see the compare-and-delete rationale on `release`.
    const reservedJobId = llmJobIdFor(requestId);
    let reservation: ReserveResult;
    try {
      reservation = await deduplicationCache.reserve(request, requestId, reservedJobId);
    } catch (error) {
      logger.error({ err: error, requestId }, 'Deduplication reservation failed; refusing request');
      return sendError(
        res,
        ErrorResponses.serviceUnavailable(
          'Request deduplication is unavailable; please retry shortly',
          requestId
        )
      );
    }

    if (reservation.kind === 'duplicate') {
      logger.info(
        { jobId: reservation.cached.jobId },
        'Returning cached job for duplicate request'
      );
      return sendSuccess(res, {
        jobId: reservation.cached.jobId,
        requestId: reservation.cached.requestId,
        status: JobStatus.Queued,
      });
    }

    // Scoped to the enqueue alone. A wider try would release the reservation
    // when a statement AFTER a successful createJobChain throws, deleting the
    // entry for a job that genuinely exists — a narrower version of the race
    // this reservation was added to close.
    let jobId: string;
    try {
      // Attachment URLs flow through unchanged. Bytes are downloaded inside
      // ai-worker's DownloadAttachmentsStep so this handler never blocks on
      // network I/O regardless of attachment size or count.
      jobId = await createJobChain({
        requestId,
        personality: request.personality,
        message: request.message,
        context: jobContext,
        responseDestination: { type: 'api' as const },
        userApiKey: request.userApiKey,
        llmConfigResolver: deps.llmConfigResolver,
        visionConfigResolver: deps.visionConfigResolver,
      });
    } catch (error) {
      // The reservation points at a job that never made it into the queue —
      // drop it so the client's retry isn't blocked for the whole window.
      //
      // This covers the THROWN path only. A process-level kill (the hardExitMs
      // backstop in processLifecycle, an OOM-kill, a SIGKILL) never reaches
      // here, so the reservation survives to its TTL and a duplicate arriving
      // in that window receives a job id that was never enqueued. The bound on
      // that case is REQUEST_DEDUP_WINDOW, not this handler's latency.
      await deduplicationCache.release(request, reservedJobId);

      const processingTime = Date.now() - startTime;
      logger.error(
        {
          err: error,
          userId: request.context.userId,
          personalityName: request.personality.name,
          processingTimeMs: processingTime,
        },
        `Error creating job (${processingTime}ms)`
      );
      throw error;
    }

    const creationTime = Date.now() - startTime;
    logger.info(
      { jobId, personalityName: request.personality.name, creationTimeMs: creationTime },
      'Created job chain'
    );

    sendCustomSuccess(res, { jobId, requestId, status: JobStatus.Queued }, 202);
  });
