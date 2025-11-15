/**
 * Job Chain Orchestrator
 *
 * Orchestrates creation of preprocessing jobs and main LLM generation jobs.
 * Handles job dependencies to ensure preprocessing completes before generation.
 */

import {
  createLogger,
  JobType,
  JOB_PREFIXES,
  JOB_REQUEST_SUFFIXES,
  REDIS_KEY_PREFIXES,
  CONTENT_TYPES,
  type AttachmentMetadata,
  type LoadedPersonality,
  type AudioTranscriptionJobData,
  type ImageDescriptionJobData,
  type LLMGenerationJobData,
  type JobDependency,
  type JobContext,
  type ResponseDestination,
  JobStatus,
} from '@tzurot/common-types';
import { flowProducer } from '../queue.js';
import type { FlowJob } from 'bullmq';

const logger = createLogger('JobChainOrchestrator');

/**
 * Separate attachments into audio and image categories
 */
function categorizeAttachments(attachments: AttachmentMetadata[]): {
  audio: AttachmentMetadata[];
  images: AttachmentMetadata[];
} {
  const audio: AttachmentMetadata[] = [];
  const images: AttachmentMetadata[] = [];

  for (const attachment of attachments) {
    if (
      attachment.contentType.startsWith(CONTENT_TYPES.AUDIO_PREFIX) ||
      attachment.isVoiceMessage
    ) {
      audio.push(attachment);
    } else if (attachment.contentType.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
      images.push(attachment);
    }
  }

  return { audio, images };
}

/**
 * Orchestrate job chain creation using BullMQ FlowProducer
 *
 * Flow:
 * 1. If attachments exist, categorize them (audio vs images)
 * 2. Build child jobs array (preprocessing jobs)
 * 3. Create flow with LLM as parent, preprocessing as children
 * 4. BullMQ runs children FIRST (in parallel), then parent when all complete
 * 5. Return the parent (LLM) job ID
 *
 * **Parallel Preprocessing**: BullMQ FlowProducer automatically executes all child jobs
 * concurrently (audio transcription + image description run simultaneously). The parent
 * (LLM) job is only queued after ALL children successfully complete.
 */
export async function createJobChain(params: {
  requestId: string;
  personality: LoadedPersonality;
  message: string | object;
  context: JobContext;
  responseDestination: ResponseDestination;
  userApiKey?: string;
}): Promise<string> {
  const { requestId, personality, message, context, responseDestination, userApiKey } = params;

  const config = await import('@tzurot/common-types').then(m => m.getConfig());
  const QUEUE_NAME = config.QUEUE_NAME;

  // Build child jobs array (preprocessing jobs that must complete first)
  const children: FlowJob[] = [];
  const dependencies: JobDependency[] = [];

  // Check if we have attachments that need preprocessing
  if (context.attachments && context.attachments.length > 0) {
    logger.info(
      {
        requestId,
        attachmentCount: context.attachments.length,
      },
      '[JobChain] Attachments detected - creating preprocessing jobs as flow children'
    );

    const { audio, images } = categorizeAttachments(context.attachments);

    // Create audio transcription child jobs
    for (let i = 0; i < audio.length; i++) {
      const attachment = audio[i];
      const audioRequestId = `${requestId}${JOB_REQUEST_SUFFIXES.AUDIO}-${i}`;
      const jobId = `${JOB_PREFIXES.AUDIO_TRANSCRIPTION}${audioRequestId}`;

      const jobData: AudioTranscriptionJobData = {
        requestId: audioRequestId,
        jobType: JobType.AudioTranscription,
        attachment,
        context: {
          userId: context.userId,
          channelId: context.channelId,
        },
        responseDestination,
      };

      children.push({
        name: JobType.AudioTranscription,
        data: jobData,
        queueName: QUEUE_NAME,
        opts: {
          jobId,
        },
      });

      dependencies.push({
        jobId,
        type: JobType.AudioTranscription,
        status: JobStatus.Queued,
        // Result stored in Redis with 1-hour TTL (see ai-worker/src/redis.ts:storeJobResult)
        resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}${jobId}`,
      });

      logger.info(
        {
          jobId,
          requestId: audioRequestId,
          attachmentName: attachment.name,
        },
        '[JobChain] Added audio transcription child job'
      );
    }

    // Create image description child job
    if (images.length > 0) {
      const imageRequestId = `${requestId}${JOB_REQUEST_SUFFIXES.IMAGE}`;
      const jobId = `${JOB_PREFIXES.IMAGE_DESCRIPTION}${imageRequestId}`;

      const jobData: ImageDescriptionJobData = {
        requestId: imageRequestId,
        jobType: JobType.ImageDescription,
        attachments: images,
        personality,
        context: {
          userId: context.userId,
          channelId: context.channelId,
        },
        responseDestination,
      };

      children.push({
        name: JobType.ImageDescription,
        data: jobData,
        queueName: QUEUE_NAME,
        opts: {
          jobId,
        },
      });

      dependencies.push({
        jobId,
        type: JobType.ImageDescription,
        status: JobStatus.Queued,
        // Result stored in Redis with 1-hour TTL (see ai-worker/src/redis.ts:storeJobResult)
        resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}${jobId}`,
      });

      logger.info(
        {
          jobId,
          requestId: imageRequestId,
          imageCount: images.length,
        },
        '[JobChain] Added image description child job'
      );
    }

    logger.info(
      {
        requestId,
        audioJobs: audio.length,
        imageJobs: images.length > 0 ? 1 : 0,
        totalChildren: children.length,
      },
      '[JobChain] Built preprocessing child jobs'
    );
  }

  // Create LLM generation job as parent (runs after all children complete)
  const llmJobId = `${JOB_PREFIXES.LLM_GENERATION}${requestId}`;
  const llmJobData: LLMGenerationJobData = {
    requestId,
    jobType: JobType.LLMGeneration,
    personality,
    message,
    context,
    responseDestination,
    userApiKey,
    dependencies: dependencies.length > 0 ? dependencies : undefined,
  };

  // Create flow with LLM as parent, preprocessing as children
  // FlowProducer automatically:
  // 1. Runs all children in parallel (audio + image jobs execute concurrently)
  // 2. Waits for ALL children to complete successfully
  // 3. Only then queues the parent (LLM) job for execution
  const flow = await flowProducer.add({
    name: JobType.LLMGeneration,
    data: llmJobData,
    queueName: QUEUE_NAME,
    opts: {
      jobId: llmJobId,
    },
    children: children.length > 0 ? children : undefined,
  });

  logger.info(
    {
      jobId: llmJobId,
      requestId,
      personalityName: personality.name,
      childCount: children.length,
    },
    '[JobChain] Created flow - LLM will wait for all children to complete'
  );

  // Return parent job ID (the LLM job)
  return flow.job.id ?? llmJobId;
}
