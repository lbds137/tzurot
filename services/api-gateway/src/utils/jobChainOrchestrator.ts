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
  type ConfigSourceId,
  JobStatus,
  audioTranscriptionJobDataSchema,
  imageDescriptionJobDataSchema,
  llmGenerationJobDataSchema,
} from '@tzurot/common-types';
import type { LlmConfigResolver, VisionConfigResolver } from '@tzurot/config-resolver';
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
        `${errorContext}Audio transcription job validation failed`
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
      'Added audio transcription child job'
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
      `${errorContext}Image description job validation failed`
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
    'Added image description child job'
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
 * Resolve the user's effective TEXT model AND vision model ONCE and stamp both onto
 * the personality, so every job in the chain (the conversation job AND the
 * image-description child job) shares the same user-cascaded values. Without this,
 * the image-description job would consume the personality SEED values (the load-time
 * defaults) because it never runs ai-worker's `ConfigStep` cascade.
 *
 * The TEXT model (`personality.model`) and the VISION model (`personality.visionModel`,
 * the carrier `selectVisionModel` reads at priority 1) resolve through INDEPENDENT
 * cascades — `LlmConfigResolver` (kind='text') and `VisionConfigResolver` (kind='vision').
 * Vision stamps regardless of the text source, since it's its own config axis.
 *
 * `provider` is intentionally NOT stamped: `ResolvedLlmConfig` carries no provider
 * (all configs are OpenRouter; ai-worker's ProviderRouter auto-promotes by model-name
 * prefix), so the configured seed provider must survive for AuthStep's routing to fire.
 *
 * Fails open per axis: a resolver throw (or no resolver wired) leaves that axis on the
 * seed value — never block job creation on config resolution. An unstamped vision model
 * (undefined) makes `selectVisionModel` fall to priority-2/3; the guest downgrade of a
 * stamped paid vision model stays in AuthStep.
 */
async function stampResolvedConfig(
  personality: LoadedPersonality,
  userId: string,
  requestId: string,
  llmConfigResolver?: LlmConfigResolver,
  visionConfigResolver?: VisionConfigResolver
): Promise<{ personality: LoadedPersonality; configSource: ConfigSourceId }> {
  let stamped = personality;
  let configSource: ConfigSourceId = 'personality';

  // TEXT model: stamp personality.model from the user cascade.
  if (llmConfigResolver !== undefined) {
    try {
      const resolved = await llmConfigResolver.resolveConfig(userId, personality.id, personality);
      // Only the two user-override tiers stamp a model.
      // - 'personality': the resolved model equals the seed already → leave unchanged.
      // - 'free-default'/'hardcoded': LlmConfigResolver should never produce these
      //   (TtsConfigResolver tiers). Warn so the contract violation stays observable.
      if (resolved.source === 'free-default' || resolved.source === 'hardcoded') {
        logger.warn(
          { requestId, personalityId: personality.id, unexpectedSource: resolved.source },
          'LlmConfigResolver returned a TTS-only config source — using personality seed'
        );
      } else if (resolved.source !== 'personality') {
        // user-personality | user-default → stamp the resolved (already-merged) model.
        stamped = { ...stamped, model: resolved.config.model };
        configSource = resolved.source;
      }
    } catch (error) {
      logger.warn(
        { err: error, requestId, personalityId: personality.id },
        'LLM config resolution failed at job-chain build — using personality seed'
      );
    }
  }

  // VISION model: stamp personality.visionModel from the INDEPENDENT vision cascade.
  if (visionConfigResolver !== undefined) {
    try {
      const vision = await visionConfigResolver.resolveConfig(userId, personality.id, personality);
      stamped = { ...stamped, visionModel: vision.config.model };
    } catch (error) {
      logger.warn(
        { err: error, requestId, personalityId: personality.id },
        'Vision config resolution failed at job-chain build — leaving vision model unstamped'
      );
    }
  }

  return { personality: stamped, configSource };
}

/** Base params shared by every preprocessing job in a chain (per-job suffix/ref added at call site). */
interface BasePreprocessingParams {
  requestId: string;
  userId: string;
  channelId: string | undefined;
  responseDestination: ResponseDestination;
  personality: LoadedPersonality;
  queueName: string;
}

/**
 * Collect preprocessing child jobs for direct attachments AND referenced-message
 * attachments. Both share the (already config-stamped) `baseJobParams.personality`.
 */
function collectPreprocessingJobs(
  context: JobContext,
  baseJobParams: BasePreprocessingParams
): PreprocessingJobsResult {
  const { requestId } = baseJobParams;
  const children: FlowJob[] = [];
  const dependencies: JobDependency[] = [];

  // Process direct attachments
  if (context.attachments && context.attachments.length > 0) {
    logger.info(
      { requestId, attachmentCount: context.attachments.length },
      'Attachments detected - creating preprocessing jobs as flow children'
    );
    const result = processAttachmentsForJobs(context.attachments, {
      ...baseJobParams,
      requestIdSuffix: '',
    });
    children.push(...result.children);
    dependencies.push(...result.dependencies);

    logger.info(
      { requestId, totalChildren: children.length },
      'Built preprocessing child jobs for direct attachments'
    );
  }

  // Process attachments from referenced messages. In thin (kind:'envelope')
  // mode the bot drops context.referencedMessages, so fall back to the raw
  // envelope's snapshots: they carry the same attachments + referenceNumber
  // (buildRawReference), and the worker preserves raw reference numbers, so the
  // dep jobs' sourceReferenceNumber keys still line up with the assembled refs.
  // Without this fallback, a reply/link to an image goes undescribed under thin.
  const referencedMessages =
    context.referencedMessages ?? context.rawAssemblyInputs?.rawReferencedMessages ?? [];
  if (referencedMessages.length > 0) {
    for (const refMsg of referencedMessages) {
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
        referencedMessageCount: referencedMessages.length,
        totalChildren: children.length,
      },
      'Built preprocessing child jobs including referenced messages'
    );
  }

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
  llmConfigResolver?: LlmConfigResolver;
  visionConfigResolver?: VisionConfigResolver;
}): Promise<string> {
  const {
    requestId,
    message,
    context,
    responseDestination,
    userApiKey,
    llmConfigResolver,
    visionConfigResolver,
  } = params;

  const config = await import('@tzurot/common-types').then(m => m.getConfig());
  const QUEUE_NAME = config.QUEUE_NAME;

  // Resolve the user's effective text + vision models once and stamp both onto the
  // personality used by EVERY job in this chain (conversation + image-desc).
  const { personality, configSource } = await stampResolvedConfig(
    params.personality,
    context.userId,
    requestId,
    llmConfigResolver,
    visionConfigResolver
  );

  // Build child jobs (preprocessing jobs that must complete before the LLM job).
  // Both direct + referenced-message attachments share the config-stamped personality.
  const { children, dependencies } = collectPreprocessingJobs(context, {
    requestId,
    userId: context.userId,
    channelId: context.channelId,
    responseDestination,
    personality,
    queueName: QUEUE_NAME,
  });

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
    configSource,
    dependencies: dependencies.length > 0 ? dependencies : undefined,
  };

  // Validate job payload against schema (contract testing)
  const validation = llmGenerationJobDataSchema.safeParse(llmJobData);
  if (!validation.success) {
    logger.error(
      { requestId, errors: validation.error.format() },
      'LLM generation job validation failed'
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
    'Created flow - LLM will wait for all children to complete'
  );

  // Return parent job ID (the LLM job)
  return flow.job.id ?? llmJobId;
}
