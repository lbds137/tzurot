/**
 * Diagnostic recording helpers for ConversationalRAGService.
 *
 * These functions build diagnostic data objects from raw LLM response metadata,
 * extracting verbose inline construction from the main orchestration methods.
 */

import type { DiagnosticCollector } from '../DiagnosticCollector.js';
import type { LoadedPersonality } from '@tzurot/common-types';

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
    stop?: string;
    stop_sequence?: string;
    reasoning_details?: unknown[];
  };
  additionalKwargs?: {
    reasoning?: string;
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
export interface LlmConfigDiagnosticOptions {
  collector: DiagnosticCollector;
  modelName: string;
  personality: LoadedPersonality;
  effectiveTemperature: number | undefined;
  effectiveFrequencyPenalty: number | undefined;
  stopSequences: string[];
}

/** Record the LLM config to the diagnostic collector */
export function recordLlmConfigDiagnostic(opts: LlmConfigDiagnosticOptions): void {
  const {
    collector,
    modelName,
    personality,
    effectiveTemperature,
    effectiveFrequencyPenalty,
    stopSequences,
  } = opts;
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
    stop: personality.stop,
    logitBias: personality.logitBias,
    responseFormat: personality.responseFormat,
    showThinking: personality.showThinking,
    reasoning: personality.reasoning,
    transforms: personality.transforms,
    route: personality.route,
    verbosity: personality.verbosity,
    stopSequences,
  });
}

/** Extract the finish reason from response metadata (multiple possible field names) */
function resolveFinishReason(meta: ParsedResponseMetadata['responseMetadata']): string {
  return String(meta?.finish_reason ?? meta?.stop_reason ?? meta?.finishReason ?? 'unknown');
}

/** Extract stop sequence from response metadata */
function resolveStopSequence(meta: ParsedResponseMetadata['responseMetadata']): string | null {
  const rawStop = meta?.stop;
  const rawStopSeq = meta?.stop_sequence;
  return (
    (typeof rawStop === 'string' ? rawStop : null) ??
    (typeof rawStopSeq === 'string' ? rawStopSeq : null)
  );
}

/** Build reasoning debug info for diagnostics */
function buildReasoningDebug(
  rawContent: string,
  metadata: ParsedResponseMetadata
): Record<string, unknown> {
  const { additionalKwargs, responseMetadata } = metadata;
  return {
    additionalKwargsKeys: additionalKwargs !== undefined ? Object.keys(additionalKwargs) : [],
    hasReasoningInKwargs:
      additionalKwargs?.reasoning !== undefined && typeof additionalKwargs.reasoning === 'string',
    reasoningKwargsLength:
      typeof additionalKwargs?.reasoning === 'string' ? additionalKwargs.reasoning.length : 0,
    responseMetadataKeys: responseMetadata !== undefined ? Object.keys(responseMetadata) : [],
    hasReasoningDetails: Array.isArray(responseMetadata?.reasoning_details),
    hasReasoningTagsInContent: rawContent.includes('<reasoning>'),
    rawContentPreview: rawContent.substring(0, 200),
  };
}

/** Record the LLM response to the diagnostic collector */
export function recordLlmResponseDiagnostic(
  collector: DiagnosticCollector,
  rawContent: string,
  modelName: string,
  metadata: ParsedResponseMetadata
): void {
  collector.recordLlmResponse({
    rawContent,
    finishReason: resolveFinishReason(metadata.responseMetadata),
    stopSequenceTriggered: resolveStopSequence(metadata.responseMetadata),
    promptTokens: metadata.usageMetadata?.input_tokens ?? 0,
    completionTokens: metadata.usageMetadata?.output_tokens ?? 0,
    modelUsed: modelName,
    reasoningDebug: buildReasoningDebug(rawContent, metadata),
  });
}
