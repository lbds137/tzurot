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
        routedModel: 'anthropic/claude-x',
        providerUsed: 'openrouter',
        fallbackProviderAttempted: 'zai-coding',
        quotaFallback: {
          fromModel: 'expensive/primary',
          toModel: 'free/model',
          category: 'credit_exhaustion',
          mode: 'reactive',
        },
        isGuestMode: true,
        freshModeEnabled: false,
        incognitoModeActive: false,
        thinkingContent: 'thoughts',
        showModelFooter: true,
        ttsAudioKey: 'tts-audio:job-1',
        ttsAudioContentType: 'audio/wav',
        ttsNotices: ['notice'],
      },
    } as unknown as LLMGenerationResult;

    const passthrough = buildResultMetadataPassthrough(result);

    expect(passthrough.modelUsed).toBe('free/model');
    expect(passthrough.routedModel).toBe('anthropic/claude-x');
    expect(passthrough.quotaFallback?.fromModel).toBe('expensive/primary');
    expect(passthrough.quotaFallback?.category).toBe('credit_exhaustion');
    expect(passthrough.ttsNotices).toEqual(['notice']);
    // thinkingContent is deliberately not delivery metadata — persistence
    // reads it from result.metadata directly, so the builder must not forward it.
    expect(passthrough).not.toHaveProperty('thinkingContent');
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
