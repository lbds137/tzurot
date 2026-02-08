/**
 * DiagnosticDefaults - Default values for missing diagnostic pipeline stages.
 *
 * These factory functions provide sentinel values indicating that a pipeline
 * stage didn't record its data (usually because the request failed before
 * reaching that stage).
 */

import type {
  DiagnosticInputProcessing,
  DiagnosticMemoryRetrieval,
  DiagnosticTokenBudget,
  DiagnosticAssembledPrompt,
  DiagnosticLlmConfig,
  DiagnosticLlmResponse,
  DiagnosticPostProcessing,
} from '@tzurot/common-types';

/* eslint-disable sonarjs/no-duplicate-string -- '[not recorded]' sentinel values for missing stages */

export function getDefaultInputProcessing(): DiagnosticInputProcessing {
  return {
    rawUserMessage: '[not recorded]',
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
    model: '[not recorded]',
    provider: '[not recorded]',
    stopSequences: [],
    allParams: {},
  };
}

export function getDefaultLlmResponse(): DiagnosticLlmResponse {
  return {
    rawContent: '[not recorded]',
    finishReason: 'unknown',
    stopSequenceTriggered: null,
    promptTokens: 0,
    completionTokens: 0,
    modelUsed: '[not recorded]',
  };
}

export function getDefaultPostProcessing(): DiagnosticPostProcessing {
  return {
    transformsApplied: [],
    duplicateDetected: false,
    thinkingExtracted: false,
    thinkingContent: null,
    artifactsStripped: [],
    finalContent: '[not recorded]',
  };
}

/* eslint-enable sonarjs/no-duplicate-string */
