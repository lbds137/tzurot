/**
 * DiagnosticDefaults - Default values for missing diagnostic pipeline stages.
 *
 * These factory functions provide sentinel values indicating that a pipeline
 * stage didn't record its data (usually because the request failed before
 * reaching that stage).
 */

import {
  FINISH_REASONS,
  type DiagnosticInputProcessing,
  type DiagnosticMemoryRetrieval,
  type DiagnosticTokenBudget,
  type DiagnosticAssembledPrompt,
  type DiagnosticLlmConfig,
  type DiagnosticLlmResponse,
  type DiagnosticPostProcessing,
} from '@tzurot/common-types';

/** Sentinel value for pipeline stages that didn't record their data. */
const NOT_RECORDED = '[not recorded]' as const;

export function getDefaultInputProcessing(): DiagnosticInputProcessing {
  return {
    rawUserMessage: NOT_RECORDED,
    attachmentDescriptions: [],
    voiceTranscript: null,
    referencedMessageIds: [],
    referencedMessagesContent: [],
    searchQuery: null,
  };
}

export function getDefaultMemoryRetrieval(): DiagnosticMemoryRetrieval {
  return {
    memoriesFound: [],
    focusModeEnabled: false,
  };
}

export function getDefaultTokenBudget(): DiagnosticTokenBudget {
  return {
    contextWindowSize: 0,
    systemPromptTokens: 0,
    memoryTokensUsed: 0,
    historyTokensUsed: 0,
    memoriesDropped: 0,
    historyMessagesDropped: 0,
  };
}

export function getDefaultAssembledPrompt(): DiagnosticAssembledPrompt {
  return {
    messages: [],
    totalTokenEstimate: 0,
  };
}

export function getDefaultLlmConfig(): DiagnosticLlmConfig {
  return {
    model: NOT_RECORDED,
    provider: NOT_RECORDED,
    stopSequences: [],
    allParams: {},
  };
}

export function getDefaultLlmResponse(): DiagnosticLlmResponse {
  return {
    rawContent: NOT_RECORDED,
    finishReason: FINISH_REASONS.UNKNOWN,
    stopSequenceTriggered: null,
    promptTokens: 0,
    completionTokens: 0,
    modelUsed: NOT_RECORDED,
  };
}

export function getDefaultPostProcessing(): DiagnosticPostProcessing {
  return {
    transformsApplied: [],
    duplicateDetected: false,
    thinkingExtracted: false,
    thinkingContent: null,
    artifactsStripped: [],
    finalContent: NOT_RECORDED,
  };
}
