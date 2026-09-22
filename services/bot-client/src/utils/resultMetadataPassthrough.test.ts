import { describe, it, expect } from 'vitest';
import { type LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import {
  buildErrorResultMetadataPassthrough,
  buildResultMetadataPassthrough,
} from './resultMetadataPassthrough.js';

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
        fallbackFromProvider: 'zai-coding',
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
    expect(passthrough.providerUsed).toBe('openrouter');
    expect(passthrough.fallbackProviderAttempted).toBe('zai-coding');
    expect(passthrough.fallbackFromProvider).toBe('zai-coding');
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

describe('buildErrorResultMetadataPassthrough', () => {
  it('forwards the nine error-delivery metadata fields and inherits the narrowing', () => {
    const result = {
      requestId: 'r1',
      success: false,
      content: null,
      metadata: {
        modelUsed: 'free/model',
        routedModel: 'anthropic/claude-x',
        providerUsed: 'openrouter',
        fallbackProviderAttempted: 'zai-coding',
        fallbackFromProvider: 'zai-coding',
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

    const passthrough = buildErrorResultMetadataPassthrough(result);

    expect(passthrough.modelUsed).toBe('free/model');
    expect(passthrough.providerUsed).toBe('openrouter');
    expect(passthrough.fallbackProviderAttempted).toBe('zai-coding');
    expect(passthrough.fallbackFromProvider).toBe('zai-coding');
    expect(passthrough.quotaFallback?.fromModel).toBe('expensive/primary');
    expect(passthrough.quotaFallback?.category).toBe('credit_exhaustion');
    expect(passthrough.isGuestMode).toBe(true);
    expect(passthrough.freshModeEnabled).toBe(false);
    expect(passthrough.incognitoModeActive).toBe(false);
    expect(passthrough.showModelFooter).toBe(true);

    // Pinned narrowing: the error subset inherits exactly what the error
    // delivery sites already forwarded before this builder existed. Widening
    // it to include routedModel or the TTS fields is a deliberate edit, not
    // an incidental one.
    expect(passthrough).not.toHaveProperty('routedModel');
    expect(passthrough).not.toHaveProperty('ttsAudioKey');
    expect(passthrough).not.toHaveProperty('ttsAudioContentType');
    expect(passthrough).not.toHaveProperty('ttsNotices');
  });

  it('is the success passthrough minus exactly the four omitted keys', () => {
    const result = {
      requestId: 'r1',
      success: false,
      content: null,
      metadata: {
        modelUsed: 'free/model',
        routedModel: 'anthropic/claude-x',
        providerUsed: 'openrouter',
        fallbackProviderAttempted: 'zai-coding',
        fallbackFromProvider: 'zai-coding',
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

    // The error subset is DERIVED from the success builder by omission, so a
    // field the success builder forwards and the omission list does not name
    // reaches the error delivery paths without any edit here.
    const expected: Record<string, unknown> = { ...buildResultMetadataPassthrough(result) };
    delete expected.routedModel;
    delete expected.ttsAudioKey;
    delete expected.ttsAudioContentType;
    delete expected.ttsNotices;

    expect(buildErrorResultMetadataPassthrough(result)).toEqual(expected);
  });
});
