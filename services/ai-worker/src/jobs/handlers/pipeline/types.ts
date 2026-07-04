/**
 * Pipeline Types for LLM Generation
 *
 * Defines the context and step interfaces for the generation pipeline.
 * This pattern ensures thread-safety by passing state through function arguments
 * instead of storing it on class instances.
 */

import type { Job } from 'bullmq';
import type { AIProvider } from '@tzurot/common-types/constants/ai';
import type { ResolvedConfigOverrides } from '@tzurot/common-types/schemas/api/configOverrides';
import type { AudioProviderId } from '@tzurot/common-types/types/audio-provider';
import type { LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import type { CrossChannelHistoryGroupEntry } from '@tzurot/common-types/types/schemas/message';
import type { SttDispatch } from '@tzurot/common-types/types/sttProvider';
import type { BaseMessage } from '@langchain/core/messages';
import type { DiagnosticCollector } from '../../../services/DiagnosticCollector.js';
import type { ProcessedAttachment } from '../../../services/MultimodalProcessor.js';
import type { FallbackRoute } from '../../../services/ProviderRouter.js';

/**
 * Conversation history entry (raw format from job data)
 */
export interface ConversationHistoryEntry {
  /** Message ID (Discord message ID for extended context, UUID for DB history) */
  id?: string;
  role: string;
  content: string;
  createdAt?: string;
  tokenCount?: number;
  /** Whether this message was forwarded from another channel */
  isForwarded?: boolean;
  /** User's persona ID */
  personaId?: string;
  /** User's persona display name */
  personaName?: string;
  /** Discord username for disambiguation when persona name matches personality name */
  discordUsername?: string;
  /** AI personality ID (for multi-AI channel attribution) */
  personalityId?: string;
  /** AI personality's display name (for multi-AI channel attribution) */
  personalityName?: string;
  /** Structured metadata (referenced messages, attachments) - formatted at prompt time */
  messageMetadata?: {
    referencedMessages?: {
      discordMessageId: string;
      authorUsername: string;
      authorDisplayName: string;
      content: string;
      embeds?: string;
      timestamp: string;
      locationContext: string;
      attachments?: {
        id?: string;
        url: string;
        contentType: string;
        name?: string;
        size?: number;
      }[];
      isForwarded?: boolean;
      authorDiscordId?: string;
      resolvedPersonaId?: string;
      resolvedPersonaName?: string;
      resolvedImageDescriptions?: { filename: string; description: string }[];
    }[];
  };
}

/**
 * Participant in a conversation
 */
export interface Participant {
  personaId: string;
  personaName: string;
  isActive: boolean;
}

/**
 * Resolved LLM configuration with user overrides applied
 */
export interface ResolvedConfig {
  /** Effective personality with config overrides */
  effectivePersonality: LLMGenerationJobData['personality'];
  /** Source of the config */
  configSource: 'personality' | 'user-personality' | 'user-default';
}

/**
 * Resolved API key information
 */
export interface ResolvedAuth {
  /** The resolved API key (undefined means use system key) */
  apiKey: string | undefined;
  /**
   * The effective provider after any routing decisions. May differ from the
   * `LlmConfig.provider` when ProviderRouter applied a fallthrough (e.g.,
   * configured `zai-coding` redirected to `openrouter` for a user without a
   * z.ai-coding key).
   *
   * Typed as `AIProvider | undefined` (not `string | undefined`) because the
   * sole producer is `ProviderRouter.resolveRoute`, whose `effectiveProvider`
   * field is `AIProvider`. Narrowing here lets consumers (e.g., the vision
   * cross-provider auth path) avoid `as AIProvider` casts and catches
   * mis-assignments at compile time.
   */
  provider: AIProvider | undefined;
  /** Whether in guest mode (free models only) */
  isGuestMode: boolean;
  /**
   * Audio-provider credentials keyed by provider id. One key authorizes ALL
   * of that provider's audio endpoints (TTS + STT + cloning) — Mistral's
   * `/v1/audio/speech` and `/v1/audio/transcriptions` use the same key, as
   * does ElevenLabs across cloning + TTS + Scribe.
   *
   * **Required on the type**. AuthStep always sets it — empty `Map` if no
   * audio keys are configured. Required-but-possibly-empty is the right
   * shape: consumers can do `auth.audioProviderKeys.get('elevenlabs')`
   * without a defensive `?? new Map()`, and TS rejects test fixtures that
   * forget the field.
   */
  audioProviderKeys: ReadonlyMap<AudioProviderId, string>;
  /**
   * Resolved STT dispatch (provider + matching BYOK key when applicable).
   * Computed by AuthStep from `audioProviderKeys` + `SttResolver` so the
   * downstream attachment-processing path picks up the user's STT preference
   * without each step needing to re-resolve. Optional because AuthStep can
   * skip computation when no SttResolver is wired (test fixtures); the
   * downstream consumers fall back to a voice-engine dispatch in that case.
   */
  sttDispatch?: SttDispatch;
  /**
   * `true` when ProviderRouter auto-promoted an OpenRouter `z-ai/<model>`
   * request to z.ai-direct. Together with `fallback`, enables GenerationStep
   * to retry-with-fallback if the promoted z.ai request fails.
   */
  wasAutoPromoted?: boolean;
  /**
   * Pre-computed OpenRouter passthrough route — populated when (and only
   * when) `wasAutoPromoted` is true. Contains everything GenerationStep
   * needs to swap to OpenRouter on a z.ai failure (catalog drift defense
   * in depth — the whitelist may go stale if z.ai deprecates a model).
   *
   * `model` is the ORIGINAL `z-ai/<model>` namespaced form (not the
   * stripped form sent to z.ai), so the OpenRouter retry uses the right
   * route on its end. Shape defined in `services/ai-worker/src/services/ProviderRouter.ts`.
   */
  fallback?: FallbackRoute;
}

/**
 * Preprocessing results from dependency jobs
 */
export interface PreprocessingResults {
  /** Processed attachments from direct message */
  processedAttachments: ProcessedAttachment[];
  /** Audio transcriptions (direct only, for backward compat) */
  transcriptions: string[];
  /** Attachments from referenced messages, keyed by reference number */
  referenceAttachments: Record<number, ProcessedAttachment[]>;
  /** Processed attachments from extended context (inline processing) */
  extendedContextAttachments?: ProcessedAttachment[];
}

/**
 * Prepared context for RAG generation
 */
export interface PreparedContext {
  /** Conversation history in BaseMessage format */
  conversationHistory: BaseMessage[];
  /** Raw conversation history entries */
  rawConversationHistory: ConversationHistoryEntry[];
  /** Oldest timestamp in history (for LTM deduplication) */
  oldestHistoryTimestamp?: number;
  /** All participants in the conversation */
  participants: Participant[];
  /** Cross-channel conversation history groups (from other channels with same personality) */
  crossChannelHistory?: CrossChannelHistoryGroupEntry[];
}

/**
 * Generation context that flows through the pipeline
 *
 * This object accumulates state as it passes through each step.
 * It is created fresh for each job, ensuring thread safety.
 */
export interface GenerationContext {
  /** The BullMQ job being processed */
  job: Job<LLMGenerationJobData>;

  /** Processing start time */
  startTime: number;

  /** Preprocessing results from dependency jobs (set by DependencyStep) */
  preprocessing?: PreprocessingResults;

  /** Resolved LLM config with user overrides (set by ConfigStep) */
  config?: ResolvedConfig;

  /** Resolved config cascade overrides (set by ConfigStep) */
  configOverrides?: ResolvedConfigOverrides;

  /** Resolved API key/auth info (set by AuthStep) */
  auth?: ResolvedAuth;

  /** Prepared conversation context (set by ContextStep) */
  preparedContext?: PreparedContext;

  /** Final response (set by GenerationStep) */
  result?: LLMGenerationResult;

  /**
   * Diagnostic collector instance, populated by GenerationStep so later
   * pipeline stages (notably TTSStep) can record additional data before
   * the orchestrator finalizes + stores the diagnostic log. Optional
   * because GenerationStep only sets it when the diagnostic flight-recorder
   * is active for this job (debug mode / always-on per config).
   *
   * Storage is asymmetric by design: success-path persistence happens
   * post-pipeline in the orchestrator (after TTSStep contributes its
   * attribution data), while error paths persist inline in GenerationStep
   * because the pipeline aborts before reaching TTSStep on failure.
   */
  diagnosticCollector?: DiagnosticCollector;
}

/**
 * Pipeline step interface
 *
 * Each step processes the context and returns an updated context.
 * Steps should be stateless and idempotent where possible.
 */
export interface IPipelineStep {
  /** Name of this step (for logging) */
  readonly name: string;

  /**
   * Process this step
   * @param context - Current context
   * @returns Updated context with this step's results added (sync or async)
   */
  process(context: GenerationContext): GenerationContext | Promise<GenerationContext>;
}
