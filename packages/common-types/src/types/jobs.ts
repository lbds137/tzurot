/**
 * Job Types and Dependencies
 *
 * Defines BullMQ job structures, dependencies, and results for the job chain architecture.
 */

import type {
  LoadedPersonality,
  ReferencedMessage,
  AttachmentMetadata,
  DiscordEnvironment,
  LLMGenerationResult,
} from './schemas.js';
import { JobType, JobStatus } from '../constants/queue.js';
import type { MessageRole } from '../constants/message.js';

/**
 * Job dependency - represents a preprocessing job that must complete first
 */
export interface JobDependency {
  /** Unique job ID */
  jobId: string;
  /** Type of job (audio transcription, image description, etc.) */
  type: JobType;
  /** Current status */
  status: JobStatus;
  /** Redis key where result is stored (if completed) */
  resultKey?: string;
}

/**
 * Job context shared across all job types
 */
export interface JobContext {
  userId: string;
  userName?: string;
  channelId?: string;
  serverId?: string;
  sessionId?: string;
  isProxyMessage?: boolean;
  activePersonaId?: string;
  activePersonaName?: string;
  conversationHistory?: Array<{
    id?: string;
    role: MessageRole;
    content: string;
    tokenCount?: number;
    createdAt?: string;
    personaId?: string;
    personaName?: string;
  }>;
  attachments?: AttachmentMetadata[];
  environment?: DiscordEnvironment;
  referencedMessages?: ReferencedMessage[];
}

/**
 * Response destination configuration
 */
export interface ResponseDestination {
  type: 'discord' | 'webhook' | 'api';
  channelId?: string;
  webhookUrl?: string;
  callbackUrl?: string;
}

/**
 * Base job data - common fields for all job types
 */
export interface BaseJobData {
  /** Unique request ID */
  requestId: string;
  /** Job type */
  jobType: JobType;
  /** Where to send the result */
  responseDestination: ResponseDestination;
  /** User's API key (for BYOK) */
  userApiKey?: string;
}

/**
 * Audio transcription job data
 */
export interface AudioTranscriptionJobData extends BaseJobData {
  jobType: JobType.AudioTranscription;
  /** Audio attachment to transcribe */
  attachment: AttachmentMetadata;
  /** Context for logging/telemetry */
  context: Pick<JobContext, 'userId' | 'channelId'>;
}

/**
 * Image description job data
 */
export interface ImageDescriptionJobData extends BaseJobData {
  jobType: JobType.ImageDescription;
  /** Image attachments to describe */
  attachments: AttachmentMetadata[];
  /** Personality for vision model selection and system prompt */
  personality: LoadedPersonality;
  /** Context for logging/telemetry */
  context: Pick<JobContext, 'userId' | 'channelId'>;
}

/**
 * LLM generation job data
 */
export interface LLMGenerationJobData extends BaseJobData {
  jobType: JobType.LLMGeneration;
  /** Personality configuration */
  personality: LoadedPersonality;
  /** User's message */
  message: string | object;
  /** Full context */
  context: JobContext;
  /** Optional dependencies (preprocessing jobs) */
  dependencies?: JobDependency[];
  /**
   * Preprocessed attachments from dependency jobs
   * Populated by AIJobProcessor after fetching audio transcriptions and image descriptions
   * @internal
   */
  __preprocessedAttachments?: string;
}

/**
 * Union type for all job data types
 */
export type AnyJobData =
  | AudioTranscriptionJobData
  | ImageDescriptionJobData
  | LLMGenerationJobData;

/**
 * Audio transcription result
 */
export interface AudioTranscriptionResult {
  requestId: string;
  success: boolean;
  /** Transcribed text */
  transcript?: string;
  /** Error message if failed */
  error?: string;
  metadata?: {
    processingTimeMs?: number;
    duration?: number;
  };
}

/**
 * Image description result
 */
export interface ImageDescriptionResult {
  requestId: string;
  success: boolean;
  /** Descriptions for each image */
  descriptions?: Array<{
    url: string;
    description: string;
  }>;
  /** Error message if failed */
  error?: string;
  metadata?: {
    processingTimeMs?: number;
    imageCount?: number;
    /** Number of images that failed processing (graceful degradation) */
    failedCount?: number;
  };
}

/**
 * LLM generation result - imported from schemas.ts as schema-derived type
 * @see generationPayloadSchema, llmGenerationResultSchema in schemas.ts
 */
// Type re-exported from schemas.ts to prevent drift

/**
 * Union type for all job results
 */
export type AnyJobResult =
  | AudioTranscriptionResult
  | ImageDescriptionResult
  | LLMGenerationResult;
