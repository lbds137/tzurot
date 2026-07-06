/**
 * Generation Schemas
 *
 * Zod schemas for AI generation requests, results, and error info.
 */

import { z } from 'zod';
import { ApiErrorType, ApiErrorCategory } from '../../constants/index.js';
import { TTS_PROVIDER_IDS } from '../../services/tts/TtsProvider.js';
import { loadedPersonalitySchema, requestContextSchema } from './personality.js';

/**
 * Source of the resolved LLM config in the cascade. Single source of truth:
 * the type, the runtime guard, and the Zod validator all derive from this
 * tuple, so a new layer is a one-line change here.
 */
export const CONFIG_SOURCE_IDS = ['personality', 'user-personality', 'user-default'] as const;

export type ConfigSourceId = (typeof CONFIG_SOURCE_IDS)[number];

/**
 * Generate request schema
 * Full validation schema for /ai/generate endpoint
 */
export const generateRequestSchema = z.object({
  personality: loadedPersonalitySchema,
  message: z.union([z.string(), z.object({}).passthrough()]),
  context: requestContextSchema,
  userApiKey: z.string().optional(),
});

/**
 * Error Info Schema
 *
 * Structured error information for LLM generation failures.
 * Includes classification for retry logic and user-friendly messages.
 */
const errorInfoSchema = z.object({
  /** Error type for retry logic (transient, permanent, unknown) */
  type: z.nativeEnum(ApiErrorType),
  /** Specific error category for user messaging */
  category: z.nativeEnum(ApiErrorCategory),
  /** HTTP status code if available */
  statusCode: z.number().optional(),
  /** User-friendly error message */
  userMessage: z.string(),
  /** Technical details for logging (e.g., raw HTTP error message) */
  technicalMessage: z.string().optional(),
  /** Unique reference ID for support */
  referenceId: z.string(),
  /** Whether this error should have been retried */
  shouldRetry: z.boolean(),
  /** OpenRouter request ID for support (from x-request-id header) */
  requestId: z.string().optional(),
  /** Unix timestamp (ms) when an active rate-limit window resets.
   *  Populated only on 429 errors that surfaced an `X-RateLimit-Reset` header. */
  rateLimitResetMs: z.number().optional(),
});

/**
 * Generation Payload Schema
 *
 * SINGLE SOURCE OF TRUTH for the core AI generation result payload.
 * This is the shared contract between:
 * - HTTP API responses (GenerateResponse.result)
 * - Internal job results (LLMGenerationResult)
 *
 * Following DRY principle while maintaining proper decoupling between
 * API contracts and internal formats.
 */
const generationPayloadSchema = z.object({
  content: z.string(),
  attachmentDescriptions: z.string().optional(),
  referencedMessagesDescriptions: z.string().optional(),
  metadata: z
    .object({
      retrievedMemories: z.number().optional(),
      /** Input/prompt tokens consumed */
      tokensIn: z.number().optional(),
      /** Output/completion tokens consumed */
      tokensOut: z.number().optional(),
      processingTimeMs: z.number().optional(),
      modelUsed: z.string().optional(),
      /** AI provider used (from API key resolution) */
      providerUsed: z.string().optional(),
      /**
       * Provider of the auto-promotion fallback route that was attempted and
       * ALSO failed — only set on a both-routes-failed error. Lets the error
       * footer render the full route chain ("via Z.AI Coding Plan → OpenRouter
       * (both routes failed)") instead of mis-attributing the primary as the
       * only attempt.
       */
      fallbackProviderAttempted: z.string().optional(),
      /** Source of LLM config (derived from CONFIG_SOURCE_IDS — single source of truth). */
      configSource: z.enum(CONFIG_SOURCE_IDS).optional(),
      /** Whether response was generated using guest mode (free model, no API key) */
      isGuestMode: z.boolean().optional(),
      /** Whether cross-turn duplication was detected (same response as previous turn) */
      crossTurnDuplicateDetected: z.boolean().optional(),
      /** Whether focus mode was active (LTM retrieval skipped) */
      focusModeEnabled: z.boolean().optional(),
      /** Whether incognito mode was active (LTM storage skipped) */
      incognitoModeActive: z.boolean().optional(),
      /**
       * Extracted thinking/reasoning content from <think> tags.
       * Only present if the model included thinking blocks in its response.
       * Display to users depends on showThinking setting.
       */
      thinkingContent: z.string().optional(),
      /**
       * Whether to display thinking content to users.
       * From the preset's show_thinking setting.
       */
      showThinking: z.boolean().optional(),
      /** Pipeline step that failed (only set on error) */
      failedStep: z.string().optional(),
      /** Last successfully completed pipeline step (only set on error) */
      lastSuccessfulStep: z.string().optional(),
      /** Error stack trace for debugging (only set on error) */
      errorStack: z.string().optional(),
      /** Discord message ID that triggered the request (for idempotency tracking) */
      triggerMessageId: z.string().optional(),
      /** Reason processing was skipped (e.g., 'idempotency_check_failed') */
      skipReason: z.string().optional(),
      /** Whether to show the model footer on the response (from config cascade) */
      showModelFooter: z.boolean().optional(),
      /** Redis key for TTS audio buffer (format: tts-audio:{jobId}) */
      ttsAudioKey: z.string().optional(),
      /** MIME type of TTS audio — determines Discord file extension (.wav or .mp3).
       *  Expected values: 'audio/wav' (voice-engine) or 'audio/mpeg' (ElevenLabs).
       *  Consumer defaults to .wav for unrecognized types. */
      ttsAudioContentType: z.string().optional(),
      /** TTS provider that ACTUALLY produced the audio (post-dispatch). May
       *  differ from the user's configured provider if the dispatcher fell
       *  through to a fallback. Surfacing this catches the same misattribution
       *  class that hid the Mistral STT bug — silent fallbacks mean a user
       *  configured Mistral but heard self-hosted output and couldn't tell.
       *  Constrained to the runtime TtsProviderId union (derived from the
       *  shared TTS_PROVIDER_IDS tuple — single source of truth). */
      ttsProviderUsed: z.enum(TTS_PROVIDER_IDS).optional(),
      /** Whether the TTS dispatcher fell through from the configured provider
       *  to a fallback. True iff `ttsProviderUsed` differs from the user's
       *  resolved configured provider for this turn. Surfaces silent-fallback
       *  cases in the diagnostic UI without requiring users to compare
       *  provider IDs themselves. */
      ttsUsedFallback: z.boolean().optional(),
      /** Bot-owner-visible diagnostics from the TTS dispatcher's fallback walk —
       *  e.g., "Mistral skipped because reference audio exceeds 30s". Rendered
       *  by bot-client only when the receiving user is the bot owner; silent
       *  for other users (the audio still plays via fallback, no UX disruption).
       *
       *  Bounded to defend against a future contributor inadvertently sending
       *  a notice that would push the response past Discord's 2000-char per-message
       *  limit. The 500-char per-notice cap and 10-notice array cap each give 2x
       *  headroom over the single-provider-chain worst case. */
      ttsNotices: z.array(z.string().max(500)).max(10).optional(),
      /** Tier-aware quota fallback fired for this turn: the configured
       *  preset's model was quota-blocked and the request retargeted to the
       *  admin default. Announced in the footer — a model swap is never
       *  silent (an unexplained voice shift reads as a bug). `mode`
       *  distinguishes the pre-dispatch cache short-circuit ('proactive')
       *  from the in-turn retry after a fresh failure ('reactive'). */
      quotaFallback: z
        .object({
          fromModel: z.string(),
          toModel: z.string(),
          category: z.enum(['quota_exceeded', 'credit_exhaustion']),
          mode: z.enum(['proactive', 'reactive']),
        })
        .optional(),
    })
    .optional(),
});

/**
 * LLM Generation Result Schema
 *
 * SINGLE SOURCE OF TRUTH for internal job results passed through Redis streams.
 * Extends GenerationPayload with success/error fields for internal processing.
 */
export const llmGenerationResultSchema = generationPayloadSchema.extend({
  requestId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  // Override content to be optional when success=false
  content: z.string().optional(),
  // Custom error message from personality (for webhook response on failures)
  personalityErrorMessage: z.string().optional(),
  // Structured error info for retry logic and user messaging
  errorInfo: errorInfoSchema.optional(),
});

// Infer TypeScript types from schemas
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

/** Structured error info type for error classification consumers */
export type ApiErrorInfo = z.infer<typeof errorInfoSchema>;

export type LLMGenerationResult = z.infer<typeof llmGenerationResultSchema>;
