import { describe, it, expect } from 'vitest';
import {
  getDefaultInputProcessing,
  getDefaultMemoryRetrieval,
  getDefaultTokenBudget,
  getDefaultAssembledPrompt,
  getDefaultLlmConfig,
  getDefaultLlmResponse,
  getDefaultPostProcessing,
} from './DiagnosticDefaults.js';

describe('DiagnosticDefaults', () => {
  it('should return default input processing', () => {
    expect(getDefaultInputProcessing()).toEqual({
      rawUserMessage: '[not recorded]',
      attachmentDescriptions: [],
      voiceTranscript: null,
      referencedMessageIds: [],
      referencedMessagesContent: [],
      searchQuery: null,
    });
  });

  it('should return default memory retrieval', () => {
    expect(getDefaultMemoryRetrieval()).toEqual({
      memoriesFound: [],
      focusModeEnabled: false,
    });
  });

  it('should return default token budget', () => {
    const budget = getDefaultTokenBudget();
    expect(budget.contextWindowSize).toBe(0);
    expect(budget.memoryTokensUsed).toBe(0);
  });

  it('should return default assembled prompt', () => {
    expect(getDefaultAssembledPrompt()).toEqual({
      messages: [],
      totalTokenEstimate: 0,
    });
  });

  it('should return default LLM config', () => {
    expect(getDefaultLlmConfig()).toEqual({
      model: '[not recorded]',
      provider: '[not recorded]',
      stopSequences: [],
      allParams: {},
    });
  });

  it('should return default LLM response', () => {
    expect(getDefaultLlmResponse()).toEqual({
      rawContent: '[not recorded]',
      finishReason: 'unknown',
      stopSequenceTriggered: null,
      promptTokens: 0,
      completionTokens: 0,
      modelUsed: '[not recorded]',
    });
  });

  it('should return default post processing', () => {
    expect(getDefaultPostProcessing()).toEqual({
      transformsApplied: [],
      duplicateDetected: false,
      thinkingExtracted: false,
      thinkingContent: null,
      artifactsStripped: [],
      finalContent: '[not recorded]',
    });
  });

  it('should return new objects each time (no shared state)', () => {
    const a = getDefaultInputProcessing();
    const b = getDefaultInputProcessing();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
