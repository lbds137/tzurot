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
  audioTranscriptionJobDataSchema,
  imageDescriptionJobDataSchema,
  llmGenerationJobDataSchema,
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
      attachment.isVoiceMessage === true
    ) {
      audio.push(attachment);
    } else if (attachment.contentType.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
      images.push(attachment);
    }
  }

  return { audio, images };
}

/** Parameters for creating audio transcription jobs */
interface AudioJobParams {
  audioAttachments: AttachmentMetadata[];
  requestId: string;
  requestIdSuffix: string;
  userId: string;
  channelId: string | undefined;
  responseDestination: ResponseDestination;
  queueName: string;
  referenceNumber?: number;
}

/** Parameters for creating image description jobs */
interface ImageJobParams {
  imageAttachments: AttachmentMetadata[];
  requestId: string;
  requestIdSuffix: string;
  userId: string;
  channelId: string | undefined;
  responseDestination: ResponseDestination;
  personality: LoadedPersonality;
  queueName: string;
  referenceNumber?: number;
}

/** Result from creating preprocessing jobs */
interface PreprocessingJobsResult {
  children: FlowJob[];
  dependencies: JobDependency[];
}

/**
 * Create audio transcription child jobs for a set of audio attachments
 */
function createAudioTranscriptionJobs(params: AudioJobParams): PreprocessingJobsResult {
  const {
    audioAttachments,
    requestId,
    requestIdSuffix,
    userId,
    channelId,
    responseDestination,
    queueName,
    referenceNumber,
  } = params;

  const children: FlowJob[] = [];
  const dependencies: JobDependency[] = [];

  for (let i = 0; i < audioAttachments.length; i++) {
    const attachment = audioAttachments[i];
    const audioRequestId = `${requestId}${requestIdSuffix}${JOB_REQUEST_SUFFIXES.AUDIO}-${i}`;
    const jobId = `${JOB_PREFIXES.AUDIO_TRANSCRIPTION}${audioRequestId}`;

    const jobData: AudioTranscriptionJobData = {
      requestId: audioRequestId,
      jobType: JobType.AudioTranscription,
      attachment,
      context: { userId, channelId },
      responseDestination,
      ...(referenceNumber !== undefined && { sourceReferenceNumber: referenceNumber }),
    };

    const validation = audioTranscriptionJobDataSchema.safeParse(jobData);
    if (!validation.success) {
      const errorContext = referenceNumber !== undefined ? `referenced message ` : '';
      logger.error(
        { requestId: audioRequestId, referenceNumber, errors: validation.error.format() },
        `[JobChain] ${errorContext}Audio transcription job validation failed`
      );
      throw new Error(
        `${errorContext}Audio transcription job validation failed: ${validation.error.message}`
      );
    }

    children.push({
      name: JobType.AudioTranscription,
      data: jobData,
      queueName,
      opts: { jobId },
    });

    dependencies.push({
      jobId,
      type: JobType.AudioTranscription,
      status: JobStatus.Queued,
      resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}${userId || 'unknown'}:${jobId}`,
    });

    logger.info(
      { jobId, requestId: audioRequestId, referenceNumber, attachmentName: attachment.name },
      '[JobChain] Added audio transcription child job'
    );
  }

  return { children, dependencies };
}

/**
 * Create image description child job for a set of image attachments
 */
function createImageDescriptionJob(params: ImageJobParams): PreprocessingJobsResult {
  const {
    imageAttachments,
    requestId,
    requestIdSuffix,
    userId,
    channelId,
    responseDestination,
    personality,
    queueName,
    referenceNumber,
  } = params;

  if (imageAttachments.length === 0) {
    return { children: [], dependencies: [] };
  }

  const imageRequestId = `${requestId}${requestIdSuffix}${JOB_REQUEST_SUFFIXES.IMAGE}`;
  const jobId = `${JOB_PREFIXES.IMAGE_DESCRIPTION}${imageRequestId}`;

  const jobData: ImageDescriptionJobData = {
    requestId: imageRequestId,
    jobType: JobType.ImageDescription,
    attachments: imageAttachments,
    personality,
    context: { userId, channelId },
    responseDestination,
    ...(referenceNumber !== undefined && { sourceReferenceNumber: referenceNumber }),
  };

  const validation = imageDescriptionJobDataSchema.safeParse(jobData);
  if (!validation.success) {
    const errorContext = referenceNumber !== undefined ? `referenced message ` : '';
    logger.error(
      { requestId: imageRequestId, referenceNumber, errors: validation.error.format() },
      `[JobChain] ${errorContext}Image description job validation failed`
    );
    throw new Error(
      `${errorContext}Image description job validation failed: ${validation.error.message}`
    );
  }

  const children: FlowJob[] = [
    {
      name: JobType.ImageDescription,
      data: jobData,
      queueName,
      opts: { jobId },
    },
  ];

  const dependencies: JobDependency[] = [
    {
      jobId,
      type: JobType.ImageDescription,
      status: JobStatus.Queued,
      resultKey: `${REDIS_KEY_PREFIXES.JOB_RESULT}${userId || 'unknown'}:${jobId}`,
    },
  ];

  logger.info(
    { jobId, requestId: imageRequestId, referenceNumber, imageCount: imageAttachments.length },
    '[JobChain] Added image description child job'
  );

  return { children, dependencies };
}

/**
 * Process attachments and create preprocessing jobs for them
 */
function processAttachmentsForJobs(
  attachments: AttachmentMetadata[],
  params: {
    requestId: string;
    requestIdSuffix: string;
    userId: string;
    channelId: string | undefined;
    responseDestination: ResponseDestination;
    personality: LoadedPersonality;
    queueName: string;
    referenceNumber?: number;
  }
): PreprocessingJobsResult {
  const { audio, images } = categorizeAttachments(attachments);
  const children: FlowJob[] = [];
  const dependencies: JobDependency[] = [];

  // Create audio transcription jobs
  if (audio.length > 0) {
    const audioResult = createAudioTranscriptionJobs({
      audioAttachments: audio,
      requestId: params.requestId,
      requestIdSuffix: params.requestIdSuffix,
      userId: params.userId,
      channelId: params.channelId,
      responseDestination: params.responseDestination,
      queueName: params.queueName,
      referenceNumber: params.referenceNumber,
    });
    children.push(...audioResult.children);
    dependencies.push(...audioResult.dependencies);
  }

  // Create image description job
  const imageResult = createImageDescriptionJob({
    imageAttachments: images,
    requestId: params.requestId,
    requestIdSuffix: params.requestIdSuffix,
    userId: params.userId,
    channelId: params.channelId,
    responseDestination: params.responseDestination,
    personality: params.personality,
    queueName: params.queueName,
    referenceNumber: params.referenceNumber,
  });
  children.push(...imageResult.children);
  dependencies.push(...imageResult.dependencies);

  return { children, dependencies };
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

  const baseJobParams = {
    requestId,
    userId: context.userId,
    channelId: context.channelId,
    responseDestination,
    personality,
    queueName: QUEUE_NAME,
  };

  // Process direct attachments
  if (context.attachments && context.attachments.length > 0) {
    logger.info(
      { requestId, attachmentCount: context.attachments.length },
      '[JobChain] Attachments detected - creating preprocessing jobs as flow children'
    );

    const result = processAttachmentsForJobs(context.attachments, {
      ...baseJobParams,
      requestIdSuffix: '',
    });
    children.push(...result.children);
    dependencies.push(...result.dependencies);

    logger.info(
      { requestId, totalChildren: children.length },
      '[JobChain] Built preprocessing child jobs for direct attachments'
    );
  }

  // Process attachments from referenced messages
  if (context.referencedMessages && context.referencedMessages.length > 0) {
    for (const refMsg of context.referencedMessages) {
      if (!refMsg.attachments || refMsg.attachments.length === 0) {
        continue;
      }

      const result = processAttachmentsForJobs(refMsg.attachments, {
        ...baseJobParams,
        requestIdSuffix: `-ref${refMsg.referenceNumber}`,
        referenceNumber: refMsg.referenceNumber,
      });
      children.push(...result.children);
      dependencies.push(...result.dependencies);
    }

    logger.info(
      {
        requestId,
        referencedMessageCount: context.referencedMessages.length,
        totalChildren: children.length,
      },
      '[JobChain] Built preprocessing child jobs including referenced messages'
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

  // Validate job payload against schema (contract testing)
  const validation = llmGenerationJobDataSchema.safeParse(llmJobData);
  if (!validation.success) {
    logger.error(
      { requestId, errors: validation.error.format() },
      '[JobChain] LLM generation job validation failed'
    );
    throw new Error(`LLM generation job validation failed: ${validation.error.message}`);
  }

  // Create flow with LLM as parent, preprocessing as children
  // FlowProducer automatically:
  // 1. Runs all children in parallel (audio + image jobs execute concurrently)
  // 2. Waits for ALL children to complete successfully
  // 3. Only then queues the parent (LLM) job for execution
  const flow = await flowProducer.add({
    name: JobType.LLMGeneration,
    data: llmJobData,
    queueName: QUEUE_NAME,
    opts: { jobId: llmJobId },
    children: children.length > 0 ? children : undefined,
  });

  logger.info(
    { jobId: llmJobId, requestId, personalityName: personality.name, childCount: children.length },
    '[JobChain] Created flow - LLM will wait for all children to complete'
  );

  // Return parent job ID (the LLM job)
  return flow.job.id ?? llmJobId;
}
