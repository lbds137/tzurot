/**
 * Job Types and Dependencies
 *
 * Defines BullMQ job structures, dependencies, and results for the job chain architecture.
 *
 * IMPORTANT: This file contains both Zod schemas (runtime validation) and TypeScript
 * interfaces (compile-time types). The schemas are the SINGLE SOURCE OF TRUTH for
 * contract testing between api-gateway (producer) and ai-worker (consumer).
 */

import { z } from 'zod';
import type {
  LoadedPersonality,
  MentionedPersona,
  ReferencedChannel,
  ReferencedMessage,
  AttachmentMetadata,
  DiscordEnvironment,
  LLMGenerationResult,
  GuildMemberInfo,
} from './schemas.js';
import {
  loadedPersonalitySchema,
  mentionedPersonaSchema,
  referencedChannelSchema,
  attachmentMetadataSchema,
  apiConversationMessageSchema,
  referencedMessageSchema,
  discordEnvironmentSchema,
  guildMemberInfoSchema,
} from './schemas.js';
import { JobType, JobStatus } from '../constants/queue.js';
import { MessageRole } from '../constants/message.js';

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
  userInternalId?: string;
  userName?: string;
  /** Discord username (e.g., 'lbds137') - used for disambiguation when persona name matches personality name */
  discordUsername?: string;
  /** User's preferred timezone (IANA format, e.g., 'America/New_York') */
  userTimezone?: string;
  channelId?: string;
  serverId?: string;
  sessionId?: string;
  isProxyMessage?: boolean;
  activePersonaId?: string;
  activePersonaName?: string;
  /** Guild-specific info about the active speaker (roles, color, join date) */
  activePersonaGuildInfo?: GuildMemberInfo;
  conversationHistory?: {
    id?: string;
    role: MessageRole;
    content: string;
    tokenCount?: number;
    createdAt?: string;
    personaId?: string;
    personaName?: string;
  }[];
  /** Attachments from triggering message */
  attachments?: AttachmentMetadata[];
  /** Image attachments from extended context (limited by maxImages setting) */
  extendedContextAttachments?: AttachmentMetadata[];
  environment?: DiscordEnvironment;
  referencedMessages?: ReferencedMessage[];
  mentionedPersonas?: MentionedPersona[];
  referencedChannels?: ReferencedChannel[];
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
  /** If from a referenced message, the reference number (1-indexed) */
  sourceReferenceNumber?: number;
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
  /** If from a referenced message, the reference number (1-indexed) */
  sourceReferenceNumber?: number;
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
export type AnyJobData = AudioTranscriptionJobData | ImageDescriptionJobData | LLMGenerationJobData;

/**
 * Audio transcription result
 */
export interface AudioTranscriptionResult {
  requestId: string;
  success: boolean;
  /** Transcribed text (uses 'content' for consistency with LLMGenerationResult) */
  content?: string;
  /** Original attachment URL (for converting to ProcessedAttachment) */
  attachmentUrl?: string;
  /** Original attachment name */
  attachmentName?: string;
  /** If from a referenced message, the reference number (1-indexed) */
  sourceReferenceNumber?: number;
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
  descriptions?: {
    url: string;
    description: string;
  }[];
  /** If from a referenced message, the reference number (1-indexed) */
  sourceReferenceNumber?: number;
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
export type AnyJobResult = AudioTranscriptionResult | ImageDescriptionResult | LLMGenerationResult;

// ============================================================================
// ZOD SCHEMAS FOR CONTRACT TESTING
// ============================================================================

// ----------------------------------------------------------------------------
// RESULT SCHEMAS
// These schemas define the contract for job results returned by ai-worker
// ----------------------------------------------------------------------------

/**
 * Audio Transcription Result Schema
 * SINGLE SOURCE OF TRUTH for audio transcription job results
 *
 * Produced by: ai-worker (AudioTranscriptionJob.ts)
 * Consumed by: api-gateway (transcribe.ts), ai-worker (DependencyStep.ts)
 */
export const audioTranscriptionResultSchema = z.object({
  requestId: z.string(),
  success: z.boolean(),
  /** Transcribed text (uses 'content' for consistency with LLMGenerationResult) */
  content: z.string().optional(),
  /** Original attachment URL (for converting to ProcessedAttachment) */
  attachmentUrl: z.string().optional(),
  /** Original attachment name */
  attachmentName: z.string().optional(),
  /** If from a referenced message, the reference number (1-indexed) */
  sourceReferenceNumber: z.number().optional(),
  /** Error message if failed */
  error: z.string().optional(),
  metadata: z
    .object({
      processingTimeMs: z.number().optional(),
      duration: z.number().optional(),
    })
    .optional(),
});

// Type inference from result schema
export type AudioTranscriptionResultFromSchema = z.infer<typeof audioTranscriptionResultSchema>;

/**
 * Response Destination Schema
 * Where to send job results
 */
export const responseDestinationSchema = z.object({
  type: z.enum(['discord', 'webhook', 'api']),
  channelId: z.string().optional(),
  webhookUrl: z.string().optional(),
  callbackUrl: z.string().optional(),
});

/**
 * Job Dependency Schema
 * Represents a preprocessing job that must complete first
 */
export const jobDependencySchema = z.object({
  jobId: z.string(),
  type: z.nativeEnum(JobType),
  status: z.nativeEnum(JobStatus),
  resultKey: z.string().optional(),
});

/**
 * Job Context Schema
 * Shared context across all job types
 */
export const jobContextSchema = z.object({
  userId: z.string(),
  userInternalId: z.string().optional(),
  userName: z.string().optional(),
  discordUsername: z.string().optional(),
  userTimezone: z.string().optional(),
  channelId: z.string().optional(),
  serverId: z.string().optional(),
  sessionId: z.string().optional(),
  isProxyMessage: z.boolean().optional(),
  activePersonaId: z.string().optional(),
  activePersonaName: z.string().optional(),
  activePersonaGuildInfo: guildMemberInfoSchema.optional(),
  conversationHistory: z.array(apiConversationMessageSchema).optional(),
  attachments: z.array(attachmentMetadataSchema).optional(),
  extendedContextAttachments: z.array(attachmentMetadataSchema).optional(),
  environment: discordEnvironmentSchema.optional(),
  referencedMessages: z.array(referencedMessageSchema).optional(),
  mentionedPersonas: z.array(mentionedPersonaSchema).optional(),
  referencedChannels: z.array(referencedChannelSchema).optional(),
});

/**
 * Base Job Data Schema
 * Common fields for all job types
 */
const baseJobDataSchema = z.object({
  requestId: z.string(),
  jobType: z.nativeEnum(JobType),
  responseDestination: responseDestinationSchema,
  userApiKey: z.string().optional(),
  /** Schema version for backward compatibility (Phase 1 migrations) */
  version: z.literal(1).default(1),
});

/**
 * Audio Transcription Job Data Schema
 * SINGLE SOURCE OF TRUTH for audio transcription job payloads
 */
export const audioTranscriptionJobDataSchema = baseJobDataSchema.extend({
  jobType: z.literal(JobType.AudioTranscription),
  attachment: attachmentMetadataSchema,
  context: jobContextSchema.pick({ userId: true, channelId: true }),
  sourceReferenceNumber: z.number().optional(),
});

/**
 * Image Description Job Data Schema
 * SINGLE SOURCE OF TRUTH for image description job payloads
 */
export const imageDescriptionJobDataSchema = baseJobDataSchema.extend({
  jobType: z.literal(JobType.ImageDescription),
  attachments: z
    .array(attachmentMetadataSchema)
    .min(1, 'At least one image attachment is required'),
  personality: loadedPersonalitySchema,
  context: jobContextSchema.pick({ userId: true, channelId: true }),
  sourceReferenceNumber: z.number().optional(),
});

/**
 * LLM Generation Job Data Schema
 * SINGLE SOURCE OF TRUTH for LLM generation job payloads
 */
export const llmGenerationJobDataSchema = baseJobDataSchema.extend({
  jobType: z.literal(JobType.LLMGeneration),
  personality: loadedPersonalitySchema,
  message: z.union([z.string(), z.object({}).passthrough()]),
  context: jobContextSchema,
  dependencies: z.array(jobDependencySchema).optional(),
  /**
   * Preprocessed attachments from dependency jobs
   * Populated by AIJobProcessor after fetching audio transcriptions and image descriptions
   * @internal
   */
  __preprocessedAttachments: z.string().optional(),
});

/**
 * Union schema for all job data types
 * Used for generic job validation
 */
export const anyJobDataSchema = z.discriminatedUnion('jobType', [
  audioTranscriptionJobDataSchema,
  imageDescriptionJobDataSchema,
  llmGenerationJobDataSchema,
]);

// Type inference from schemas (ensures types stay in sync with schemas)
export type ResponseDestinationFromSchema = z.infer<typeof responseDestinationSchema>;
export type JobDependencyFromSchema = z.infer<typeof jobDependencySchema>;
export type JobContextFromSchema = z.infer<typeof jobContextSchema>;
export type AudioTranscriptionJobDataFromSchema = z.infer<typeof audioTranscriptionJobDataSchema>;
export type ImageDescriptionJobDataFromSchema = z.infer<typeof imageDescriptionJobDataSchema>;
export type LLMGenerationJobDataFromSchema = z.infer<typeof llmGenerationJobDataSchema>;
export type AnyJobDataFromSchema = z.infer<typeof anyJobDataSchema>;
