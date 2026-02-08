/**
 * Generation Schemas
 *
 * Zod schemas for AI generation requests, results, and error info.
 */

import { z } from 'zod';
import { ApiErrorType, ApiErrorCategory } from '../../constants/index.js';
import { loadedPersonalitySchema, requestContextSchema } from './personality.js';

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
      /** Source of LLM config: 'personality' | 'user-personality' | 'user-default' */
      configSource: z.enum(['personality', 'user-personality', 'user-default']).optional(),
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
