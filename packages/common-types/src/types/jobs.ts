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
import {
  type LoadedPersonality,
  type MentionedPersona,
  type ReferencedChannel,
  type ReferencedMessage,
  type AttachmentMetadata,
  type CrossChannelHistoryGroupEntry,
  type DiscordEnvironment,
  type LLMGenerationResult,
  type GuildMemberInfo,
  type RawAssemblyInputs,
  loadedPersonalitySchema,
  mentionedPersonaSchema,
  referencedChannelSchema,
  attachmentMetadataSchema,
  referencedMessageSchema,
  discordEnvironmentSchema,
  guildMemberInfoSchema,
  crossChannelHistoryGroupSchema,
  rawAssemblyInputsSchema,
  CONFIG_SOURCE_IDS,
  type ConfigSourceId,
} from './schemas/index.js';
import { JobType, JobStatus } from '../constants/queue.js';
import type { SttProvider } from './sttProvider.js';

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
  /**
   * Context-payload variant discriminant. `'envelope'` means the producer
   * (bot-client) omitted the re-derivable legacy fields (referencedMessages,
   * mentionedPersonas, referencedChannels) and the worker MUST assemble them
   * from `rawAssemblyInputs`. `'legacy'` (the default for
   * absent — i.e. in-flight jobs from an older bot) means the legacy fields are
   * authoritative. See jobContextBaseSchema.
   *
   * Optional here but `.default('legacy')` on the schema — intentional:
   * ValidationStep discards its parsed copy, so the default never materializes
   * on raw `job.data`; consumers read `kind ?? 'legacy'`.
   */
  kind?: 'legacy' | 'envelope';
  userId: string;
  userInternalId?: string;
  userName?: string;
  /** Discord message ID that triggered this request (for diagnostic lookup) */
  triggerMessageId?: string;
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
  /**
   * Guild info for other participants (from extended context, keyed by personaId)
   * @example { 'discord:user-123': { roles: ['Admin', 'Developer'], displayColor: '#FF5733' } }
   */
  participantGuildInfo?: Record<string, GuildMemberInfo>;
  /** Attachments from triggering message */
  attachments?: AttachmentMetadata[];
  /** Image attachments from extended context (limited by maxImages setting) */
  extendedContextAttachments?: AttachmentMetadata[];
  environment?: DiscordEnvironment;
  referencedMessages?: ReferencedMessage[];
  mentionedPersonas?: MentionedPersona[];
  referencedChannels?: ReferencedChannel[];
  /** Weigh-in mode: read-the-room prompt framing (system instruction, current
   *  channel only). Controls FRAMING, not anonymity — see `incognito`. */
  isWeighIn?: boolean;
  /** Anonymity for chime-in / random summons: when true (the default for those
   *  commands), skip persona injection + LTM read + memory write + STM epoch.
   *  When false, the summon is personal (persona + memories + recorded) while
   *  keeping the weigh-in framing. Defaults to `isWeighIn` when unset so existing
   *  weigh-in payloads stay anonymous. */
  incognito?: boolean;
  /** Cross-channel conversation history (grouped by channel, for cross-channel context) */
  crossChannelHistory?: CrossChannelHistoryGroupEntry[];
  /** Whether the triggering message was a voice message (used for voice-only TTS mode) */
  isVoiceMessage?: boolean;
  /**
   * Raw Discord-origin assembly inputs for worker-side context assembly
   * (burn-in instrumentation; present only when bot-client ships them via
   * CONTEXT_RAW_ENVELOPE=true). See rawAssemblyInputsSchema.
   */
  rawAssemblyInputs?: RawAssemblyInputs;
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
interface BaseJobData {
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
  /**
   * Cascade tier that produced the resolved LLM config, stamped by the gateway's
   * single-resolution step (jobChainOrchestrator). Diagnostic-only — surfaced via
   * /inspect and consumed by GenerationStep. Optional: absent on in-flight jobs
   * enqueued before this field existed, and on the gateway resolve-failure
   * fallback path; ConfigStep defaults it to 'personality'.
   */
  configSource?: ConfigSourceId;
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
 * Why an audio transcription failed. Carried across the BullMQ/Redis job boundary
 * (where Error instances can't survive serialization) so bot-client can pick the
 * right user-facing message: a self-hosted STT timeout or an over-the-cap "too long"
 * read very differently from a generic failure. Set only when `success === false`.
 *
 * - `timeout`     — voice-engine STT exceeded its budget (long audio / slow CPU).
 * - `too_long`    — audio exceeded the hard duration cap (rejected before inference).
 * - `unavailable` — no STT provider produced text (BYOK failed + voice-engine down/empty).
 * - `other`       — any other failure.
 */
export type SttFailureReason = 'timeout' | 'too_long' | 'unavailable' | 'other';

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
  /** Machine-readable failure cause (set only when success=false). Drives the
   *  bot-client's user-facing message — see {@link SttFailureReason}. */
  failureReason?: SttFailureReason;
  /** Which STT provider produced the transcript; surfaced as user-visible attribution. */
  provider?: SttProvider;
  /**
   * User's resolved `showModelFooter` user-default. When `false`, bot-client
   * suppresses the `-# Transcribed by X` attribution line beneath voice
   * transcripts. Optional for backward compatibility: `undefined` preserves
   * the legacy behavior of always showing the footer when a provider is
   * known. Resolved server-side via `ConfigCascadeResolver` at the
   * user-default tier so the bot-client doesn't need to fetch user
   * preferences separately for every voice message.
   *
   * **Populated only on the synchronous `?wait=true` path** of the
   * api-gateway transcribe route. Asynchronous-polling callers receive
   * `undefined` here and must resolve user preferences separately. The
   * sole caller, bot-client, always uses `?wait=true`, so this matters
   * only if a future caller adopts polling.
   */
  showModelFooter?: boolean;
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
  /** Machine-readable failure cause (set only when success=false) — see SttFailureReason. */
  failureReason: z.enum(['timeout', 'too_long', 'unavailable', 'other']).optional(),
  metadata: z
    .object({
      processingTimeMs: z.number().optional(),
      duration: z.number().optional(),
    })
    .optional(),
});

/**
 * Response Destination Schema
 * Where to send job results
 */
const responseDestinationSchema = z.object({
  type: z.enum(['discord', 'webhook', 'api']),
  channelId: z.string().optional(),
  webhookUrl: z.string().optional(),
  callbackUrl: z.string().optional(),
});

/**
 * Job Dependency Schema
 * Represents a preprocessing job that must complete first
 */
const jobDependencySchema = z.object({
  jobId: z.string(),
  type: z.nativeEnum(JobType),
  status: z.nativeEnum(JobStatus),
  resultKey: z.string().optional(),
});

/**
 * Job Context Schema
 * Shared context across all job types
 */
const jobContextBaseSchema = z.object({
  /**
   * Context-payload variant. `.default('legacy')` makes an absent discriminant
   * (in-flight jobs from an older bot) parse as legacy — which is why this is a
   * plain enum field, NOT a z.discriminatedUnion (a union would reject the
   * absent discriminant and fail every old-bot job the moment the new worker
   * deploys). The envelope-requires-rawAssemblyInputs invariant is enforced by
   * the LLM context schema's superRefine, not here, so the audio/image schemas
   * can still `.pick()` from this base.
   */
  kind: z.enum(['legacy', 'envelope']).default('legacy'),
  userId: z.string(),
  userInternalId: z.string().optional(),
  userName: z.string().optional(),
  triggerMessageId: z.string().optional(),
  discordUsername: z.string().optional(),
  userTimezone: z.string().optional(),
  channelId: z.string().optional(),
  serverId: z.string().optional(),
  sessionId: z.string().optional(),
  isProxyMessage: z.boolean().optional(),
  activePersonaId: z.string().optional(),
  activePersonaName: z.string().optional(),
  activePersonaGuildInfo: guildMemberInfoSchema.optional(),
  participantGuildInfo: z.record(z.string(), guildMemberInfoSchema).optional(),
  attachments: z.array(attachmentMetadataSchema).optional(),
  extendedContextAttachments: z.array(attachmentMetadataSchema).optional(),
  environment: discordEnvironmentSchema.optional(),
  referencedMessages: z.array(referencedMessageSchema).optional(),
  mentionedPersonas: z.array(mentionedPersonaSchema).optional(),
  referencedChannels: z.array(referencedChannelSchema).optional(),
  /** Weigh-in mode: read-the-room prompt framing (controls framing, not anonymity). */
  isWeighIn: z.boolean().optional(),
  /** Anonymity for chime-in/random: skip persona + LTM read/write + epoch when true. */
  incognito: z.boolean().optional(),
  crossChannelHistory: z.array(crossChannelHistoryGroupSchema).optional(),
  isVoiceMessage: z.boolean().optional(),
  rawAssemblyInputs: rawAssemblyInputsSchema.optional(),
});

/**
 * LLM-generation context schema: the base plus the envelope invariant. A
 * `kind: 'envelope'` payload MUST carry `rawAssemblyInputs` (the worker has no
 * legacy fields to fall back to), enforced here so a malformed thin payload
 * fails loud at both the gateway enqueue and the worker's ValidationStep.
 *
 * superRefine (→ ZodEffects) is applied ONLY here, not on the base, so the
 * audio/image schemas can still `.pick()` from jobContextBaseSchema.
 */
const llmGenerationContextSchema = jobContextBaseSchema.superRefine((data, ctx) => {
  if (data.kind === 'envelope' && data.rawAssemblyInputs === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rawAssemblyInputs'],
      message: "context.kind 'envelope' requires rawAssemblyInputs",
    });
  }
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
  /** Schema version for backward compatibility */
  version: z.literal(1).default(1),
});

/**
 * Audio Transcription Job Data Schema
 * SINGLE SOURCE OF TRUTH for audio transcription job payloads
 */
export const audioTranscriptionJobDataSchema = baseJobDataSchema.extend({
  jobType: z.literal(JobType.AudioTranscription),
  attachment: attachmentMetadataSchema,
  context: jobContextBaseSchema.pick({ userId: true, channelId: true }),
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
  context: jobContextBaseSchema.pick({ userId: true, channelId: true }),
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
  context: llmGenerationContextSchema,
  configSource: z.enum(CONFIG_SOURCE_IDS).optional(),
  dependencies: z.array(jobDependencySchema).optional(),
  /**
   * Preprocessed attachments from dependency jobs
   * Populated by AIJobProcessor after fetching audio transcriptions and image descriptions
   * @internal
   */
  __preprocessedAttachments: z.string().optional(),
});

/**
 * Fact Extraction Job Data Schema (memory Phase 2)
 * SINGLE SOURCE OF TRUTH for fact-extraction job payloads.
 *
 * The worker reads episode content by sourceMemoryIds from THIS payload — never
 * from the Redis pending-list, which is cleared at enqueue time. windowStart is
 * the first pending episode id and anchors the deterministic jobId.
 */
export const factExtractionJobDataSchema = baseJobDataSchema.extend({
  jobType: z.literal(JobType.FactExtraction),
  channelId: z.string(),
  personalityId: z.string().uuid(),
  /** Episode Memory.ids to extract facts from (the batch window). */
  sourceMemoryIds: z.array(z.string().uuid()).min(1),
  /** First pending episode id — the deterministic-jobId anchor, for traceability. */
  windowStart: z.string().uuid(),
  /** Owner-initiated backfill jobs skip the per-personality daily budget: the
   * tripwire bounds MALFUNCTIONS (runaway loops), not deliberate finite work —
   * a backfill's job set is fixed at enqueue time. The worker gates both
   * tryConsume and the busy-path refund on this flag. */
  budgetExempt: z.boolean().optional(),
  /** Count of provider-busy delay cycles this job has been through. The worker
   * increments it on each busy requeue and ejects the batch (fail-to-skip)
   * past the cap — a batch that times out on EVERY attempt is a poison batch,
   * and unbounded delay cycles would block it in the queue forever. No schema
   * upper bound: the cap is application logic (MAX_BUSY_CYCLES_PER_JOB in
   * factExtractionSetup), not a validity constraint on the payload. */
  busyCycles: z.number().int().min(0).optional(),
});

export type FactExtractionJobData = z.infer<typeof factExtractionJobDataSchema>;

/** One DM recipient inside a broadcast batch. */
const releaseBroadcastRecipientSchema = z.object({
  /** Deterministic ReleaseDeliveryLog row id — the per-recipient delivery ledger key. */
  deliveryLogId: z.string().uuid(),
  /** Internal users.id UUID (delivery reporting joins on this). */
  userId: z.string().uuid(),
  /** Discord snowflake the DM is sent to. */
  discordUserId: z.string(),
  /**
   * The user's most recent prior release DM still standing (ledger rows with
   * a sentMessageId and no messageDeletedAt). The worker deletes it before
   * sending, so a DM channel holds at most one release note; the ledger row
   * id comes back on the delivery report to stamp messageDeletedAt.
   */
  previousDm: z
    .object({
      deliveryLogId: z.string().uuid(),
      messageId: z.string(),
    })
    .optional(),
});

/**
 * Release-Broadcast DM Job Data Schema
 * SINGLE SOURCE OF TRUTH for broadcast DM batch payloads.
 *
 * The worker re-filters recipients against the delivery log (pending-only)
 * before sending, so a stalled-and-rerun batch never double-DMs.
 */
export const releaseBroadcastDmJobDataSchema = baseJobDataSchema.extend({
  jobType: z.literal(JobType.ReleaseBroadcastDm),
  /** ReleaseAnnouncement row this batch delivers. */
  releaseId: z.string().uuid(),
  /** Announcement version label (log/trace context only). */
  version: z.string().min(1),
  /** Pre-formatted DM body (the worker appends the opt-out footer). */
  body: z.string().min(1),
  recipients: z.array(releaseBroadcastRecipientSchema).min(1).max(50),
});

export type ReleaseBroadcastDmJobData = z.infer<typeof releaseBroadcastDmJobDataSchema>;
export type ReleaseBroadcastRecipient = z.infer<typeof releaseBroadcastRecipientSchema>;

/**
 * Union schema for all job data types
 * Used for generic job validation
 */
export const anyJobDataSchema = z.discriminatedUnion('jobType', [
  audioTranscriptionJobDataSchema,
  imageDescriptionJobDataSchema,
  llmGenerationJobDataSchema,
  factExtractionJobDataSchema,
  releaseBroadcastDmJobDataSchema,
]);
