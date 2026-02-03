/**
 * DiagnosticCollector - Flight Recorder for LLM Requests
 *
 * A stateful class that accumulates diagnostic data as the request flows through
 * the AI generation pipeline. Each pipeline stage calls a recording method to
 * capture its contribution to the final prompt/response.
 *
 * Usage:
 *   const collector = new DiagnosticCollector(requestId, personality);
 *   collector.recordInputProcessing(...);
 *   collector.recordMemoryRetrieval(...);
 *   // ... more stages ...
 *   const payload = collector.finalize();
 *
 * The resulting payload can be stored in llm_diagnostic_logs for later debugging.
 */

import type { BaseMessage } from '@langchain/core/messages';
import {
  createLogger,
  AttachmentType,
  type DiagnosticPayload,
  type DiagnosticMeta,
  type DiagnosticInputProcessing,
  type DiagnosticMemoryRetrieval,
  type DiagnosticMemoryEntry,
  type DiagnosticTokenBudget,
  type DiagnosticAssembledPrompt,
  type DiagnosticMessage,
  type DiagnosticLlmConfig,
  type DiagnosticLlmResponse,
  type DiagnosticPostProcessing,
  type DiagnosticTiming,
  type DiagnosticError,
  type ConvertedReasoningConfig,
} from '@tzurot/common-types';
import type { MemoryDocument } from './ConversationalRAGTypes.js';
import type { ProcessedAttachment } from './MultimodalProcessor.js';

const logger = createLogger('DiagnosticCollector');

/** Maximum characters for memory preview (first N + last N) */
const MEMORY_PREVIEW_LENGTH = 100;

/** Placeholder for fields that weren't recorded during pipeline execution */
const NOT_RECORDED = '[not recorded]';

/**
 * Options for creating a DiagnosticCollector
 */
export interface DiagnosticCollectorOptions {
  requestId: string;
  triggerMessageId?: string;
  personalityId: string;
  personalityName: string;
  userId: string;
  guildId: string | null;
  channelId: string;
}

/**
 * Input data for recording the input processing stage
 */
export interface InputProcessingData {
  rawUserMessage: string;
  processedAttachments: ProcessedAttachment[];
  referencedMessages?: {
    discordMessageId: string;
    content: string;
  }[];
  searchQuery: string;
}

/**
 * Memory data for recording the memory retrieval stage
 */
export interface MemoryRetrievalData {
  retrievedMemories: MemoryDocument[];
  selectedMemories: MemoryDocument[];
  focusModeEnabled: boolean;
}

/**
 * Token budget data for recording allocation
 */
export interface TokenBudgetData {
  contextWindowSize: number;
  systemPromptTokens: number;
  memoryTokensUsed: number;
  historyTokensUsed: number;
  memoriesDropped: number;
  historyMessagesDropped: number;
}

/**
 * LLM configuration data
 *
 * Uses ConvertedReasoningConfig from common-types for the reasoning field
 * to avoid duplicate type definitions.
 */
export interface LlmConfigData {
  model: string;
  provider: string;
  // Basic sampling
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  // Advanced sampling
  minP?: number;
  topA?: number;
  seed?: number;
  // Output control
  stop?: string[];
  logitBias?: Record<string, number>;
  responseFormat?: { type: 'text' | 'json_object' };
  showThinking?: boolean;
  // Reasoning (for thinking models) - uses shared type from common-types
  reasoning?: ConvertedReasoningConfig;
  // OpenRouter-specific
  transforms?: string[];
  route?: 'fallback';
  verbosity?: 'low' | 'medium' | 'high';
  // Stop sequences (generated at runtime)
  stopSequences: string[];
}

/**
 * Raw LLM response data
 */
export interface LlmResponseData {
  rawContent: string;
  finishReason: string;
  stopSequenceTriggered: string | null;
  promptTokens: number;
  completionTokens: number;
  modelUsed: string;
  /** Debug info for reasoning extraction troubleshooting */
  reasoningDebug?: {
    additionalKwargsKeys: string[];
    hasReasoningInKwargs: boolean;
    reasoningKwargsLength: number;
    responseMetadataKeys: string[];
    hasReasoningDetails: boolean;
  };
}

/**
 * Post-processing data
 */
export interface PostProcessingData {
  rawContent: string;
  deduplicatedContent: string;
  thinkingContent: string | null;
  strippedContent: string;
  finalContent: string;
}

/**
 * Accumulates diagnostic data throughout the LLM request pipeline.
 *
 * This class is designed to be passed through the pipeline stages, with each
 * stage calling the appropriate recording method. The finalize() method
 * assembles all recorded data into a DiagnosticPayload for storage.
 */
export class DiagnosticCollector {
  private readonly startTime: number;
  private readonly meta: DiagnosticMeta;

  // Accumulated data from each stage
  private inputProcessing: DiagnosticInputProcessing | null = null;
  private memoryRetrieval: DiagnosticMemoryRetrieval | null = null;
  private tokenBudget: DiagnosticTokenBudget | null = null;
  private assembledPrompt: DiagnosticAssembledPrompt | null = null;
  private llmConfig: DiagnosticLlmConfig | null = null;
  private llmResponse: DiagnosticLlmResponse | null = null;
  private postProcessing: DiagnosticPostProcessing | null = null;
  private errorData: DiagnosticError | null = null;

  // Timing markers
  private memoryRetrievalStartMs: number | null = null;
  private memoryRetrievalEndMs: number | null = null;
  private llmInvocationStartMs: number | null = null;
  private llmInvocationEndMs: number | null = null;

  constructor(options: DiagnosticCollectorOptions) {
    this.startTime = Date.now();
    this.meta = {
      requestId: options.requestId,
      triggerMessageId: options.triggerMessageId,
      personalityId: options.personalityId,
      personalityName: options.personalityName,
      userId: options.userId,
      guildId: options.guildId,
      channelId: options.channelId,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Record Stage 1: Input processing results
   */
  recordInputProcessing(data: InputProcessingData): void {
    const audioAttachment = data.processedAttachments.find(
      att => att.type === AttachmentType.Audio
    );
    this.inputProcessing = {
      rawUserMessage: data.rawUserMessage,
      attachmentDescriptions: data.processedAttachments.map(
        att => att.description ?? `[${att.type}]`
      ),
      voiceTranscript: audioAttachment?.description ?? null,
      referencedMessageIds: data.referencedMessages?.map(m => m.discordMessageId) ?? [],
      referencedMessagesContent: data.referencedMessages?.map(m => m.content) ?? [],
      searchQuery: data.searchQuery,
    };
  }

  /**
   * Mark the start of memory retrieval for timing
   */
  markMemoryRetrievalStart(): void {
    this.memoryRetrievalStartMs = Date.now();
  }

  /**
   * Record Stage 2: Memory retrieval results
   */
  recordMemoryRetrieval(data: MemoryRetrievalData): void {
    this.memoryRetrievalEndMs = Date.now();

    // Build a set of selected memory IDs for quick lookup
    const selectedIds = new Set(data.selectedMemories.map(m => m.metadata?.id).filter(Boolean));

    this.memoryRetrieval = {
      memoriesFound: data.retrievedMemories.map(mem => this.buildMemoryEntry(mem, selectedIds)),
      focusModeEnabled: data.focusModeEnabled,
    };
  }

  /**
   * Build a diagnostic memory entry with preview
   */
  private buildMemoryEntry(
    memory: MemoryDocument,
    selectedIds: Set<string | undefined>
  ): DiagnosticMemoryEntry {
    const content = memory.pageContent;
    const preview = this.buildPreview(content);

    return {
      id: memory.metadata?.id ?? 'unknown',
      score: memory.metadata?.score ?? 0,
      preview,
      includedInPrompt: selectedIds.has(memory.metadata?.id),
    };
  }

  /**
   * Build a preview string: first N + " ... " + last N characters
   */
  private buildPreview(content: string): string {
    if (content.length <= MEMORY_PREVIEW_LENGTH * 2) {
      return content;
    }
    const first = content.substring(0, MEMORY_PREVIEW_LENGTH);
    const last = content.substring(content.length - MEMORY_PREVIEW_LENGTH);
    return `${first} ... ${last}`;
  }

  /**
   * Record Stage 3: Token budget allocation
   */
  recordTokenBudget(data: TokenBudgetData): void {
    this.tokenBudget = {
      contextWindowSize: data.contextWindowSize,
      systemPromptTokens: data.systemPromptTokens,
      memoryTokensUsed: data.memoryTokensUsed,
      historyTokensUsed: data.historyTokensUsed,
      memoriesDropped: data.memoriesDropped,
      historyMessagesDropped: data.historyMessagesDropped,
    };
  }

  /**
   * Record Stage 4: Assembled prompt (the exact messages sent to the LLM)
   */
  recordAssembledPrompt(messages: BaseMessage[], tokenEstimate: number): void {
    this.assembledPrompt = {
      messages: messages.map(msg => this.convertMessage(msg)),
      totalTokenEstimate: tokenEstimate,
    };
  }

  /**
   * Convert a LangChain message to our diagnostic format
   */
  private convertMessage(msg: BaseMessage): DiagnosticMessage {
    // Extract role from message type
    const msgType = msg._getType();
    let role: 'system' | 'user' | 'assistant';

    switch (msgType) {
      case 'system':
        role = 'system';
        break;
      case 'human':
        role = 'user';
        break;
      case 'ai':
        role = 'assistant';
        break;
      default:
        role = 'user'; // Default fallback
    }

    // Extract content - handle both string and array formats
    let content: string;
    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .map(part => {
          if (typeof part === 'string') {
            return part;
          }
          if (typeof part === 'object' && 'text' in part) {
            return part.text;
          }
          return '[non-text content]';
        })
        .join('');
    } else {
      content = String(msg.content);
    }

    return { role, content };
  }

  /**
   * Record Stage 5: LLM configuration
   */
  recordLlmConfig(data: LlmConfigData): void {
    this.llmConfig = {
      model: data.model,
      provider: data.provider,
      temperature: data.temperature,
      topP: data.topP,
      topK: data.topK,
      maxTokens: data.maxTokens,
      frequencyPenalty: data.frequencyPenalty,
      presencePenalty: data.presencePenalty,
      repetitionPenalty: data.repetitionPenalty,
      stopSequences: data.stopSequences,
      allParams: {
        // Core
        model: data.model,
        provider: data.provider,
        // Basic sampling
        temperature: data.temperature,
        topP: data.topP,
        topK: data.topK,
        maxTokens: data.maxTokens,
        frequencyPenalty: data.frequencyPenalty,
        presencePenalty: data.presencePenalty,
        repetitionPenalty: data.repetitionPenalty,
        // Advanced sampling
        minP: data.minP,
        topA: data.topA,
        seed: data.seed,
        // Output control
        stop: data.stop,
        logitBias: data.logitBias,
        responseFormat: data.responseFormat,
        showThinking: data.showThinking,
        // Reasoning
        reasoning: data.reasoning,
        // OpenRouter-specific
        transforms: data.transforms,
        route: data.route,
        verbosity: data.verbosity,
      },
    };
  }

  /**
   * Mark the start of LLM invocation for timing
   */
  markLlmInvocationStart(): void {
    this.llmInvocationStartMs = Date.now();
  }

  /**
   * Record Stage 6: Raw LLM response
   */
  recordLlmResponse(data: LlmResponseData): void {
    this.llmInvocationEndMs = Date.now();

    this.llmResponse = {
      rawContent: data.rawContent,
      finishReason: data.finishReason,
      stopSequenceTriggered: data.stopSequenceTriggered,
      promptTokens: data.promptTokens,
      completionTokens: data.completionTokens,
      modelUsed: data.modelUsed,
      reasoningDebug: data.reasoningDebug,
    };
  }

  /**
   * Record an error that occurred during processing.
   * Call this before finalize() when the request fails.
   */
  recordError(data: {
    message: string;
    category: string;
    referenceId?: string;
    rawError?: Record<string, unknown>;
    failedAtStage: string;
  }): void {
    // Truncate large error objects to prevent storage issues
    let sanitizedRawError = data.rawError;
    if (sanitizedRawError !== undefined) {
      const MAX_ERROR_SIZE = 50000; // ~50KB
      const errorJson = JSON.stringify(sanitizedRawError);
      if (errorJson.length > MAX_ERROR_SIZE) {
        sanitizedRawError = {
          _truncated: true,
          _originalSize: errorJson.length,
          preview: errorJson.substring(0, MAX_ERROR_SIZE),
        };
      }
    }

    this.errorData = {
      message: data.message,
      category: data.category,
      referenceId: data.referenceId,
      rawError: sanitizedRawError,
      failedAtStage: data.failedAtStage,
    };
  }

  /**
   * Record Stage 7: Post-processing transforms
   */
  recordPostProcessing(data: PostProcessingData): void {
    const transforms: string[] = [];
    const artifactsStripped: string[] = [];

    // Track what transforms were applied
    if (data.rawContent !== data.deduplicatedContent) {
      transforms.push('duplicate_removal');
    }
    if (data.thinkingContent !== null && data.thinkingContent !== '') {
      transforms.push('thinking_extraction');
    }
    if (data.deduplicatedContent !== data.strippedContent) {
      transforms.push('artifact_strip');
      // Could enumerate specific artifacts here if we tracked them
      artifactsStripped.push('response_artifacts');
    }
    if (data.strippedContent !== data.finalContent) {
      transforms.push('placeholder_replacement');
    }

    this.postProcessing = {
      transformsApplied: transforms,
      duplicateDetected: data.rawContent !== data.deduplicatedContent,
      thinkingExtracted: data.thinkingContent !== null,
      thinkingContent: data.thinkingContent,
      artifactsStripped,
      finalContent: data.finalContent,
    };
  }

  /**
   * Finalize and return the complete diagnostic payload.
   * Call this at the end of the pipeline to get the data for storage.
   */
  finalize(): DiagnosticPayload {
    const endTime = Date.now();
    const totalDurationMs = endTime - this.startTime;

    // Calculate sub-timings
    const timing: DiagnosticTiming = {
      totalDurationMs,
    };

    if (this.memoryRetrievalStartMs !== null && this.memoryRetrievalEndMs !== null) {
      timing.memoryRetrievalMs = this.memoryRetrievalEndMs - this.memoryRetrievalStartMs;
    }

    if (this.llmInvocationStartMs !== null && this.llmInvocationEndMs !== null) {
      timing.llmInvocationMs = this.llmInvocationEndMs - this.llmInvocationStartMs;
    }

    // Build the complete payload with defaults for missing stages
    const payload: DiagnosticPayload = {
      meta: this.meta,
      inputProcessing: this.inputProcessing ?? this.getDefaultInputProcessing(),
      memoryRetrieval: this.memoryRetrieval ?? this.getDefaultMemoryRetrieval(),
      tokenBudget: this.tokenBudget ?? this.getDefaultTokenBudget(),
      assembledPrompt: this.assembledPrompt ?? this.getDefaultAssembledPrompt(),
      llmConfig: this.llmConfig ?? this.getDefaultLlmConfig(),
      llmResponse: this.llmResponse ?? this.getDefaultLlmResponse(),
      postProcessing: this.postProcessing ?? this.getDefaultPostProcessing(),
      timing,
    };

    // Include error data if present (for failed requests)
    if (this.errorData !== null) {
      payload.error = this.errorData;
    }

    // Log completion for debugging
    logger.debug(
      {
        requestId: this.meta.requestId,
        totalDurationMs,
        hasError: this.errorData !== null,
        stages: {
          inputProcessing: this.inputProcessing !== null,
          memoryRetrieval: this.memoryRetrieval !== null,
          tokenBudget: this.tokenBudget !== null,
          assembledPrompt: this.assembledPrompt !== null,
          llmConfig: this.llmConfig !== null,
          llmResponse: this.llmResponse !== null,
          postProcessing: this.postProcessing !== null,
        },
      },
      '[DiagnosticCollector] Finalized diagnostic payload'
    );

    return payload;
  }

  // Default values for missing stages (indicates something went wrong in the pipeline)

  private getDefaultInputProcessing(): DiagnosticInputProcessing {
    return {
      rawUserMessage: NOT_RECORDED,
      attachmentDescriptions: [],
      voiceTranscript: null,
      referencedMessageIds: [],
      referencedMessagesContent: [],
      searchQuery: null,
    };
  }

  private getDefaultMemoryRetrieval(): DiagnosticMemoryRetrieval {
    return {
      memoriesFound: [],
      focusModeEnabled: false,
    };
  }

  private getDefaultTokenBudget(): DiagnosticTokenBudget {
    return {
      contextWindowSize: 0,
      systemPromptTokens: 0,
      memoryTokensUsed: 0,
      historyTokensUsed: 0,
      memoriesDropped: 0,
      historyMessagesDropped: 0,
    };
  }

  private getDefaultAssembledPrompt(): DiagnosticAssembledPrompt {
    return {
      messages: [],
      totalTokenEstimate: 0,
    };
  }

  private getDefaultLlmConfig(): DiagnosticLlmConfig {
    return {
      model: NOT_RECORDED,
      provider: NOT_RECORDED,
      stopSequences: [],
      allParams: {},
    };
  }

  private getDefaultLlmResponse(): DiagnosticLlmResponse {
    return {
      rawContent: NOT_RECORDED,
      finishReason: 'unknown',
      stopSequenceTriggered: null,
      promptTokens: 0,
      completionTokens: 0,
      modelUsed: NOT_RECORDED,
    };
  }

  private getDefaultPostProcessing(): DiagnosticPostProcessing {
    return {
      transformsApplied: [],
      duplicateDetected: false,
      thinkingExtracted: false,
      thinkingContent: null,
      artifactsStripped: [],
      finalContent: NOT_RECORDED,
    };
  }
}
