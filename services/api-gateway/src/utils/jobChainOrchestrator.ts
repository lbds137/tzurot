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
import { aiQueue } from '../queue.js';

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
 * Create audio transcription jobs for all audio attachments
 */
async function createAudioTranscriptionJobs(
  audioAttachments: AttachmentMetadata[],
  requestId: string,
  context: Pick<JobContext, 'userId' | 'channelId'>,
  responseDestination: ResponseDestination
): Promise<JobDependency[]> {
  const dependencies: JobDependency[] = [];

  for (let i = 0; i < audioAttachments.length; i++) {
    const attachment = audioAttachments[i];
    const audioRequestId = `${requestId}-audio-${i}`;

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

    const job = await aiQueue.add(JobType.AudioTranscription, jobData, {
      jobId: `${JOB_PREFIXES.AUDIO_TRANSCRIPTION}${audioRequestId}`,
    });

    logger.info(
      {
        jobId: job.id,
        requestId: audioRequestId,
        attachmentName: attachment.name,
      },
      '[JobChain] Created audio transcription job'
    );

    dependencies.push({
      jobId: job.id ?? audioRequestId,
      type: JobType.AudioTranscription,
      status: JobStatus.Queued,
      resultKey: `job-result:${job.id ?? audioRequestId}`,
    });
  }

  return dependencies;
}

/**
 * Create image description job for all image attachments
 * (processes all images in a single job for efficiency)
 */
async function createImageDescriptionJob(
  imageAttachments: AttachmentMetadata[],
  requestId: string,
  personality: LoadedPersonality,
  context: Pick<JobContext, 'userId' | 'channelId'>,
  responseDestination: ResponseDestination
): Promise<JobDependency | null> {
  if (imageAttachments.length === 0) {
    return null;
  }

  const imageRequestId = `${requestId}-image`;

  const jobData: ImageDescriptionJobData = {
    requestId: imageRequestId,
    jobType: JobType.ImageDescription,
    attachments: imageAttachments,
    personality,
    context: {
      userId: context.userId,
      channelId: context.channelId,
    },
    responseDestination,
  };

  const job = await aiQueue.add(JobType.ImageDescription, jobData, {
    jobId: `${JOB_PREFIXES.IMAGE_DESCRIPTION}${imageRequestId}`,
  });

  logger.info(
    {
      jobId: job.id,
      requestId: imageRequestId,
      imageCount: imageAttachments.length,
    },
    '[JobChain] Created image description job'
  );

  return {
    jobId: job.id ?? imageRequestId,
    type: JobType.ImageDescription,
    status: JobStatus.Queued,
    resultKey: `job-result:${job.id ?? imageRequestId}`,
  };
}

/**
 * Create LLM generation job with optional dependencies
 */
async function createLLMGenerationJob(
  requestId: string,
  personality: LoadedPersonality,
  message: string | object,
  context: JobContext,
  responseDestination: ResponseDestination,
  userApiKey?: string,
  dependencies?: JobDependency[]
): Promise<string> {
  const jobData: LLMGenerationJobData = {
    requestId,
    jobType: JobType.LLMGeneration,
    personality,
    message,
    context,
    responseDestination,
    userApiKey,
    dependencies,
  };

  const job = await aiQueue.add(JobType.LLMGeneration, jobData, {
    jobId: `${JOB_PREFIXES.LLM_GENERATION}${requestId}`,
  });

  logger.info(
    {
      jobId: job.id,
      requestId,
      personalityName: personality.name,
      dependencyCount: dependencies?.length || 0,
    },
    '[JobChain] Created LLM generation job'
  );

  return job.id ?? requestId;
}

/**
 * Orchestrate job chain creation based on request content
 *
 * Flow:
 * 1. If attachments exist, categorize them (audio vs images)
 * 2. Create preprocessing jobs for attachments
 * 3. Create LLM generation job with dependencies
 * 4. Return the main job ID
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

  const dependencies: JobDependency[] = [];

  // Check if we have attachments that need preprocessing
  if (context.attachments && context.attachments.length > 0) {
    logger.info(
      {
        requestId,
        attachmentCount: context.attachments.length,
      },
      '[JobChain] Attachments detected - creating preprocessing jobs'
    );

    const { audio, images } = categorizeAttachments(context.attachments);

    // Create audio transcription jobs
    if (audio.length > 0) {
      const audioDeps = await createAudioTranscriptionJobs(
        audio,
        requestId,
        context,
        responseDestination
      );
      dependencies.push(...audioDeps);
    }

    // Create image description job
    if (images.length > 0) {
      const imageDep = await createImageDescriptionJob(
        images,
        requestId,
        personality,
        context,
        responseDestination
      );
      if (imageDep) {
        dependencies.push(imageDep);
      }
    }

    logger.info(
      {
        requestId,
        audioJobs: audio.length,
        imageJobs: images.length > 0 ? 1 : 0,
        totalDependencies: dependencies.length,
      },
      '[JobChain] Created preprocessing jobs'
    );
  }

  // Create LLM generation job (with or without dependencies)
  const jobId = await createLLMGenerationJob(
    requestId,
    personality,
    message,
    context,
    responseDestination,
    userApiKey,
    dependencies.length > 0 ? dependencies : undefined
  );

  return jobId;
}
