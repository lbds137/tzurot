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
}

/**
 * Request metadata for identification and filtering
 */
export interface DiagnosticMeta {
  /** Unique request identifier (used for lookup) */
  requestId: string;
  /** Personality UUID */
  personalityId: string;
  /** Personality display name */
  personalityName: string;
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
}

/**
 * Stage 7: Post-processing applied to the response
 */
export interface DiagnosticPostProcessing {
  /** List of transforms applied */
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
