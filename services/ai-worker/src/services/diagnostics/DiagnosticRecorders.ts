/**
 * Diagnostic recording helpers for ConversationalRAGService.
 *
 * These functions build diagnostic data objects from raw LLM response metadata,
 * extracting verbose inline construction from the main orchestration methods.
 */

import type { DiagnosticCollector } from '../DiagnosticCollector.js';
import { resolveFinishReason } from '@tzurot/common-types/constants/finishReasons';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { hasThinkingBlocks } from '../../utils/thinkingExtraction.js';
import { contentToText } from '../../utils/baseMessageContent.js';
import type { LlmResponseData } from './DiagnosticTypes.js';
import type { BudgetAllocationResult, MemoryDocument } from '../ConversationalRAGTypes.js';

/** Parsed response metadata from LangChain's AIMessage */
export interface ParsedResponseMetadata {
  usageMetadata?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  responseMetadata?: {
    finish_reason?: string;
    stop_reason?: string;
    finishReason?: string;
    reasoning_details?: unknown[];
    /**
     * Diagnostic info populated by extractAndPopulateOpenRouterReasoning from the
     * raw OpenRouter response. Read by buildReasoningDebug to surface in `/inspect`.
     */
    openrouter?: {
      provider?: string;
      apiMessageKeys?: string[];
      apiReasoningLength?: number;
    };
  };
  additionalKwargs?: {
    /** OpenRouter (and most OpenAI-compatible providers) put reasoning here. */
    reasoning?: string;
    /**
     * z.ai uses `reasoning_content` instead of `reasoning` on its direct
     * API. LangChain's `ChatOpenAI` converter forwards unrecognized fields
     * verbatim into `additional_kwargs`, so z.ai-direct responses surface
     * their reasoning text under this key. Read by `buildReasoningDebug`
     * so the diagnostic counters reflect z.ai extraction accurately.
     */
    reasoning_content?: string;
  };
}

/**
 * Raw response shape from LangChain AIMessage (snake_case property names).
 * The AIMessage uses snake_case keys internally.
 */
interface RawLangChainResponse {
  usage_metadata?: ParsedResponseMetadata['usageMetadata'];
  response_metadata?: ParsedResponseMetadata['responseMetadata'];
  additional_kwargs?: ParsedResponseMetadata['additionalKwargs'];
}

/** Parse LangChain AIMessage into typed metadata */
export function parseResponseMetadata(response: unknown): ParsedResponseMetadata {
  const data = response as RawLangChainResponse;
  return {
    usageMetadata: data.usage_metadata,
    responseMetadata: data.response_metadata,
    additionalKwargs: data.additional_kwargs,
  };
}

/** Options for recording LLM config diagnostics */
interface LlmConfigDiagnosticOptions {
  collector: DiagnosticCollector;
  modelName: string;
  personality: LoadedPersonality;
  effectiveTemperature: number | undefined;
  effectiveFrequencyPenalty: number | undefined;
}

/** Record the LLM config to the diagnostic collector */
export function recordLlmConfigDiagnostic(opts: LlmConfigDiagnosticOptions): void {
  const { collector, modelName, personality, effectiveTemperature, effectiveFrequencyPenalty } =
    opts;
  collector.recordLlmConfig({
    model: modelName,
    provider: modelName.split('/')[0] || 'unknown',
    temperature: effectiveTemperature,
    topP: personality.topP,
    topK: personality.topK,
    maxTokens: personality.maxTokens,
    frequencyPenalty: effectiveFrequencyPenalty,
    presencePenalty: personality.presencePenalty,
    repetitionPenalty: personality.repetitionPenalty,
    minP: personality.minP,
    topA: personality.topA,
    seed: personality.seed,
    logitBias: personality.logitBias,
    responseFormat: personality.responseFormat,
    showThinking: personality.showThinking,
    reasoning: personality.reasoning,
    transforms: personality.transforms,
    route: personality.route,
    verbosity: personality.verbosity,
  });
}

/** Build reasoning debug info for diagnostics */
function buildReasoningDebug(
  rawContent: string,
  metadata: ParsedResponseMetadata
): NonNullable<LlmResponseData['reasoningDebug']> {
  const { additionalKwargs, responseMetadata } = metadata;
  const openrouter = responseMetadata?.openrouter;
  // Recognize both OpenRouter's `reasoning` and z.ai-direct's
  // `reasoning_content` so the counter is accurate across providers.
  // Without this, z.ai-direct responses report `false`/`0` even when
  // reasoning was successfully extracted, which is misleading in the
  // /inspect dump.
  const reasoningText =
    typeof additionalKwargs?.reasoning === 'string'
      ? additionalKwargs.reasoning
      : typeof additionalKwargs?.reasoning_content === 'string'
        ? additionalKwargs.reasoning_content
        : null;
  return {
    additionalKwargsKeys: additionalKwargs !== undefined ? Object.keys(additionalKwargs) : [],
    hasReasoningInKwargs: reasoningText !== null,
    reasoningKwargsLength: reasoningText?.length ?? 0,
    responseMetadataKeys: responseMetadata !== undefined ? Object.keys(responseMetadata) : [],
    hasReasoningDetails: Array.isArray(responseMetadata?.reasoning_details),
    hasReasoningTagsInContent: hasThinkingBlocks(rawContent),
    rawContentPreview: rawContent.substring(0, 200),
    upstreamProvider: openrouter?.provider,
    apiMessageKeys: openrouter?.apiMessageKeys,
    apiReasoningLength: openrouter?.apiReasoningLength,
  };
}

/** Options for recordBudgetDiagnostics */
interface BudgetDiagnosticOptions {
  collector: DiagnosticCollector;
  retrievedMemories: MemoryDocument[];
  focusModeEnabled: boolean;
  budgetResult: BudgetAllocationResult;
  /** How many facts retrieval produced BEFORE the budget's fact slice applied */
  retrievedFactsCount: number;
  /** The effective (model-clamped) context window the budget ran against */
  contextWindowSize: number;
  countTokens: (text: string) => number;
}

/** Record memory retrieval and token budget allocation to the diagnostic collector */
export function recordBudgetDiagnostics(opts: BudgetDiagnosticOptions): void {
  const { collector, retrievedMemories, focusModeEnabled, budgetResult, contextWindowSize } = opts;
  collector.recordMemoryRetrieval({
    retrievedMemories,
    selectedMemories: budgetResult.relevantMemories,
    focusModeEnabled,
  });
  collector.recordTokenBudget({
    contextWindowSize,
    systemPromptTokens: opts.countTokens(contentToText(budgetResult.systemPrompt.content)),
    memoryTokensUsed: budgetResult.memoryTokensUsed,
    historyTokensUsed: budgetResult.historyTokensUsed,
    memoriesDropped: budgetResult.memoriesDroppedCount,
    factTokensUsed: budgetResult.factTokensUsed,
    factsIncluded: budgetResult.selectedFacts.length,
    factsDropped: Math.max(0, opts.retrievedFactsCount - budgetResult.selectedFacts.length),
    historyMessagesDropped: budgetResult.messagesDropped,
    crossChannelMessagesIncluded: budgetResult.crossChannelMessagesIncluded,
  });
}

/** Record the LLM response to the diagnostic collector */
export function recordLlmResponseDiagnostic(
  collector: DiagnosticCollector,
  rawContent: string,
  modelName: string,
  metadata: ParsedResponseMetadata
): void {
  const finishReason = resolveFinishReason(metadata.responseMetadata);

  collector.recordLlmResponse({
    rawContent,
    finishReason,
    promptTokens: metadata.usageMetadata?.input_tokens ?? 0,
    completionTokens: metadata.usageMetadata?.output_tokens ?? 0,
    modelUsed: modelName,
    reasoningDebug: buildReasoningDebug(rawContent, metadata),
  });
}
