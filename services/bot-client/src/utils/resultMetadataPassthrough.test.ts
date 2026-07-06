import { describe, it, expect } from 'vitest';
import { type LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import { buildResultMetadataPassthrough } from './resultMetadataPassthrough.js';

describe('buildResultMetadataPassthrough', () => {
  it('forwards every delivery-relevant metadata field', () => {
    const result = {
      requestId: 'r1',
      success: true,
      content: 'hello',
      metadata: {
        modelUsed: 'free/model',
        providerUsed: 'openrouter',
        fallbackProviderAttempted: 'zai-coding',
        quotaFallback: {
          fromModel: 'expensive/primary',
          toModel: 'free/model',
          category: 'credit_exhaustion',
          mode: 'reactive',
        },
        isGuestMode: true,
        focusModeEnabled: false,
        incognitoModeActive: false,
        thinkingContent: 'thoughts',
        showThinking: true,
        showModelFooter: true,
        ttsAudioKey: 'tts-audio:job-1',
        ttsAudioContentType: 'audio/wav',
        ttsNotices: ['notice'],
      },
    } as unknown as LLMGenerationResult;

    const passthrough = buildResultMetadataPassthrough(result);

    expect(passthrough.modelUsed).toBe('free/model');
    expect(passthrough.quotaFallback?.fromModel).toBe('expensive/primary');
    expect(passthrough.quotaFallback?.category).toBe('credit_exhaustion');
    expect(passthrough.ttsNotices).toEqual(['notice']);
    expect(passthrough.showThinking).toBe(true);
  });

  it('degrades to all-undefined when metadata is absent', () => {
    const result = {
      requestId: 'r1',
      success: true,
      content: 'hello',
    } as unknown as LLMGenerationResult;

    const passthrough = buildResultMetadataPassthrough(result);

    expect(passthrough.modelUsed).toBeUndefined();
    expect(passthrough.quotaFallback).toBeUndefined();
  });
});
