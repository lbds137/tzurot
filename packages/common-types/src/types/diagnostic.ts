/**
 * Diagnostic Types for LLM Flight Recorder
 *
 * These types define the structure of diagnostic data captured during LLM requests.
 * The data is stored as JSONB in the llm_diagnostic_logs table for debugging
 * prompt construction issues.
 *
 * @module diagnostic
 */

/**
 * Top-level diagnostic payload stored in the database.
 * Contains the complete "narrative" of an LLM request from input to output.
 */
export interface DiagnosticPayload {
  /** Metadata about the request */
  meta: DiagnosticMeta;

  /** Stage 1: Input processing results */
  inputProcessing: DiagnosticInputProcessing;

  /** Stage 2: Memory retrieval results */
  memoryRetrieval: DiagnosticMemoryRetrieval;

  /** Stage 3: Token budget allocation */
  tokenBudget: DiagnosticTokenBudget;

  /** Stage 4: Full assembled prompt (CRITICAL - no truncation) */
  assembledPrompt: DiagnosticAssembledPrompt;

  /** Stage 5: LLM configuration used */
  llmConfig: DiagnosticLlmConfig;

  /** Stage 6: Raw LLM response (FULL - no truncation) */
  llmResponse: DiagnosticLlmResponse;

  /** Stage 7: Post-processing applied */
  postProcessing: DiagnosticPostProcessing;

  /** Timing breakdown */
  timing: DiagnosticTiming;

  /** Error info (present only for failed requests) */
  error?: DiagnosticError;
}

/**
 * Error information for failed requests
 */
export interface DiagnosticError {
  /** Error message */
  message: string;
  /** Error category (from apiErrorParser) */
  category: string;
  /** Reference ID for support */
  referenceId?: string;
  /** Raw error details (sanitized) */
  rawError?: Record<string, unknown>;
  /** Which pipeline stage failed */
  failedAtStage: string;
}

/**
 * Request metadata for identification and filtering
 */
export interface DiagnosticMeta {
  /** Unique request identifier (used for lookup) */
  requestId: string;
  /** Discord message ID that triggered this request (for lookup by message) */
  triggerMessageId?: string;
  /** Personality UUID */
  personalityId: string;
  /** Personality display name */
  personalityName: string;
  /** Discord ID of the personality owner. Captured at write time as an
   *  immutable telemetry snapshot — survives personality deletion within the
   *  24h log retention window. Used by /inspect view-builders to redact
   *  character internals (system prompt, memory previews) for non-owners.
   *  Stored as Discord snowflake (matching `userId` field semantics) so
   *  bot-client can compare directly against `interaction.user.id` without a
   *  Discord-ID-to-internal-UUID lookup. Optional for backward compatibility
   *  with logs written before PR #898. */
  personalityOwnerDiscordId?: string;
  /** Discord user ID */
  userId: string;
  /** Discord guild ID (null for DMs) */
  guildId: string | null;
  /** Discord channel ID */
  channelId: string;
  /** ISO timestamp of request start */
  timestamp: string;
}

/**
 * Stage 1: Input processing - what the user sent
 */
export interface DiagnosticInputProcessing {
  /** Raw user message text */
  rawUserMessage: string;
  /** Descriptions of processed attachments */
  attachmentDescriptions: string[];
  /** Voice message transcript if any */
  voiceTranscript: string | null;
  /** Discord message IDs being replied to */
  referencedMessageIds: string[];
  /** Full content of referenced messages */
  referencedMessagesContent: string[];
  /** Query string used for memory search */
  searchQuery: string | null;
}

/**
 * Stage 2: Memory retrieval results
 */
export interface DiagnosticMemoryRetrieval {
  /** Memories found during retrieval */
  memoriesFound: DiagnosticMemoryEntry[];
  /** Whether focus mode was enabled (skips LTM retrieval) */
  focusModeEnabled: boolean;
}

/**
 * Individual memory entry with relevance info
 */
export interface DiagnosticMemoryEntry {
  /** Memory UUID */
  id: string;
  /** Similarity score (0-1) */
  score: number;
  /** Preview: first 100 + last 100 chars */
  preview: string;
  /** Whether this memory was included in the final prompt */
  includedInPrompt: boolean;
}

/**
 * Stage 3: Token budget allocation
 */
export interface DiagnosticTokenBudget {
  /** Total context window size in tokens */
  contextWindowSize: number;
  /** Tokens used by system prompt (base) */
  systemPromptTokens: number;
  /** Tokens used by included memories */
  memoryTokensUsed: number;
  /** Tokens used by conversation history */
  historyTokensUsed: number;
  /** Number of memories dropped due to budget */
  memoriesDropped: number;
  /** Number of history messages dropped due to budget */
  historyMessagesDropped: number;
}

/**
 * Stage 4: The exact prompt sent to the LLM (NEVER truncate!)
 */
export interface DiagnosticAssembledPrompt {
  /** The EXACT messages array sent to the LLM */
  messages: DiagnosticMessage[];
  /** Estimated total tokens */
  totalTokenEstimate: number;
}

/**
 * A single message in the prompt
 */
export interface DiagnosticMessage {
  /** Message role */
  role: 'system' | 'user' | 'assistant';
  /** Full message content - NO truncation */
  content: string;
}

/**
 * Stage 5: LLM configuration used for generation
 */
export interface DiagnosticLlmConfig {
  /** Model identifier (e.g., "openrouter/anthropic/claude-3.5-sonnet") */
  model: string;
  /** Provider name */
  provider: string;
  /** Sampling temperature */
  temperature?: number;
  /** Top-p sampling */
  topP?: number;
  /** Top-k sampling */
  topK?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Frequency penalty */
  frequencyPenalty?: number;
  /** Presence penalty */
  presencePenalty?: number;
  /** Repetition penalty */
  repetitionPenalty?: number;
  /** Stop sequences configured */
  stopSequences: string[];
  /** All parameters for completeness */
  allParams: Record<string, unknown>;
}

/**
 * Stage 6: Raw LLM response (NEVER truncate!)
 */
export interface DiagnosticLlmResponse {
  /** Complete response before any processing */
  rawContent: string;
  /** Finish reason from the API */
  finishReason: string;
  /** Which stop sequence triggered (if any) */
  stopSequenceTriggered: string | null;
  /** Tokens in the prompt */
  promptTokens: number;
  /** Tokens in the completion */
  completionTokens: number;
  /** Model actually used (may differ from requested) */
  modelUsed: string;
  /** Debug info for reasoning extraction troubleshooting */
  reasoningDebug?: {
    /** Keys present in additional_kwargs from LangChain response */
    additionalKwargsKeys: string[];
    /** Whether reasoning field exists in additional_kwargs */
    hasReasoningInKwargs: boolean;
    /** Length of reasoning string (if present) */
    reasoningKwargsLength: number;
    /** Keys present in response_metadata */
    responseMetadataKeys: string[];
    /** Whether reasoning_details array exists in response_metadata */
    hasReasoningDetails: boolean;
    /** Whether <reasoning> tags were found in raw content. Always false post-PR-#895 (reasoning extraction moved from transport-layer tag injection to consumer-layer kwargs population) — kept for backward compatibility with old logs. */
    hasReasoningTagsInContent: boolean;
    /** First ~200 chars of raw content for quick visual inspection */
    rawContentPreview: string;
    /** Actual upstream OpenRouter provider that handled the request (e.g. "Parasail", "Chutes", "DekaLLM"). Distinct from LangChain's hardcoded `response_metadata.model_provider = "openai"`. Populated by extractAndPopulateOpenRouterReasoning post-PR-#895. */
    upstreamProvider?: string;
    /** Keys present on raw API response `choices[0].message`. Distinguishes "model returned structured reasoning" (includes `reasoning`/`reasoning_details`) from "model embedded planning into content directly" (just `role`/`content`). Populated post-PR-#895. */
    apiMessageKeys?: string[];
    /** Length of `message.reasoning` from the raw OpenRouter response, captured BEFORE the consumer-layer extractor runs. Compared with reasoningKwargsLength to detect leak class: zero = model emitted no structured reasoning; mismatch = pipeline lost data. Populated post-PR-#895. */
    apiReasoningLength?: number;
  };
}

/**
 * One step in the post-processing pipeline (deduplication, thinking extraction,
 * artifact stripping, etc.). Captured per-step so the /inspect Pipeline Health
 * view can render an explicit checklist instead of inferring step state from
 * scattered flags.
 *
 * Status semantics:
 * - `success` — step ran AND produced a result (e.g. extracted thinking content,
 *   stripped artifacts, detected duplicates)
 * - `skipped` — step ran but produced no result (e.g. no thinking tags found,
 *   no duplicate to remove, no artifacts present)
 * - `error` — step threw or otherwise failed; `reason` should explain
 */
export interface PipelineStep {
  /** Step identifier, e.g. "thinking_extraction", "artifact_strip", "duplicate_detection" */
  name: string;
  /** Outcome of the step */
  status: 'success' | 'skipped' | 'error';
  /** Optional human-readable detail (failure cause, what was extracted, etc.) */
  reason?: string;
  /** Optional per-step duration when measured */
  durationMs?: number;
}

/**
 * Stage 7: Post-processing applied to the response
 */
export interface DiagnosticPostProcessing {
  /** List of transforms applied (legacy — `pipelineSteps` provides richer detail) */
  transformsApplied: string[];
  /** Whether duplicate content was detected and removed */
  duplicateDetected: boolean;
  /** Whether thinking blocks were extracted */
  thinkingExtracted: boolean;
  /** Content of thinking blocks (if extracted) */
  thinkingContent: string | null;
  /** What artifacts were stripped */
  artifactsStripped: string[];
  /** Final content sent to Discord */
  finalContent: string;
  /**
   * Per-step pipeline outcomes (success / skipped / error). Used by the
   * /inspect Pipeline Health view as an explicit checklist. Optional for
   * backward compatibility with logs written before PR #899.
   */
  pipelineSteps?: PipelineStep[];
}

/**
 * Timing breakdown for performance analysis
 */
export interface DiagnosticTiming {
  /** Total end-to-end duration in milliseconds */
  totalDurationMs: number;
  /** Time spent on memory retrieval */
  memoryRetrievalMs?: number;
  /** Time spent on LLM invocation */
  llmInvocationMs?: number;
}
