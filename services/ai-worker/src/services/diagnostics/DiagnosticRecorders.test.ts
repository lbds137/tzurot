/**
 * Tests for DiagnosticRecorders
 *
 * Tests the pure helper functions that parse LLM response metadata
 * and build diagnostic data objects.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock @tzurot/common-types (needed by transitive imports)
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

import {
  parseResponseMetadata,
  recordLlmConfigDiagnostic,
  recordLlmResponseDiagnostic,
  inferNonXmlStop,
  type ParsedResponseMetadata,
} from './DiagnosticRecorders.js';

describe('DiagnosticRecorders', () => {
  describe('parseResponseMetadata', () => {
    it('should parse snake_case LangChain response fields', () => {
      const raw = {
        usage_metadata: {
          input_tokens: 100,
          output_tokens: 200,
          total_tokens: 300,
        },
        response_metadata: {
          finish_reason: 'stop',
        },
        additional_kwargs: {
          reasoning: 'Some reasoning text',
        },
      };

      const result = parseResponseMetadata(raw);

      expect(result.usageMetadata).toEqual({
        input_tokens: 100,
        output_tokens: 200,
        total_tokens: 300,
      });
      expect(result.responseMetadata?.finish_reason).toBe('stop');
      expect(result.additionalKwargs?.reasoning).toBe('Some reasoning text');
    });

    it('should handle missing fields gracefully', () => {
      const result = parseResponseMetadata({});

      expect(result.usageMetadata).toBeUndefined();
      expect(result.responseMetadata).toBeUndefined();
      expect(result.additionalKwargs).toBeUndefined();
    });

    it('should handle undefined fields in response object', () => {
      const result = parseResponseMetadata({ some_other_field: 'value' });

      expect(result.usageMetadata).toBeUndefined();
      expect(result.responseMetadata).toBeUndefined();
      expect(result.additionalKwargs).toBeUndefined();
    });
  });

  describe('recordLlmConfigDiagnostic', () => {
    it('should record config to collector with correct fields', () => {
      const mockCollector = {
        recordLlmConfig: vi.fn(),
      };
      const mockPersonality = {
        topP: 0.9,
        topK: 40,
        maxTokens: 4096,
        presencePenalty: 0,
        repetitionPenalty: 1.0,
        minP: 0.1,
        topA: undefined,
        seed: undefined,
        stop: ['END'],
        logitBias: undefined,
        responseFormat: undefined,
        showThinking: false,
        reasoning: { effort: 'high' },
        transforms: ['middle-out'],
        route: 'fallback',
        verbosity: undefined,
      };

      recordLlmConfigDiagnostic({
        collector: mockCollector as never,
        modelName: 'deepseek/deepseek-r1',
        personality: mockPersonality as never,
        effectiveTemperature: 0.7,
        effectiveFrequencyPenalty: 0.5,
        stopSequences: ['<STOP>'],
      });

      expect(mockCollector.recordLlmConfig).toHaveBeenCalledWith({
        model: 'deepseek/deepseek-r1',
        provider: 'deepseek',
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        maxTokens: 4096,
        frequencyPenalty: 0.5,
        presencePenalty: 0,
        repetitionPenalty: 1.0,
        minP: 0.1,
        topA: undefined,
        seed: undefined,
        stop: ['END'],
        logitBias: undefined,
        responseFormat: undefined,
        showThinking: false,
        reasoning: { effort: 'high' },
        transforms: ['middle-out'],
        route: 'fallback',
        verbosity: undefined,
        stopSequences: ['<STOP>'],
      });
    });

    it('should extract provider from model name', () => {
      const mockCollector = { recordLlmConfig: vi.fn() };
      const mockPersonality = {} as never;

      recordLlmConfigDiagnostic({
        collector: mockCollector as never,
        modelName: 'anthropic/claude-sonnet-4.5',
        personality: mockPersonality,
        effectiveTemperature: undefined,
        effectiveFrequencyPenalty: undefined,
        stopSequences: [],
      });

      const call = mockCollector.recordLlmConfig.mock.calls[0][0] as Record<string, unknown>;
      expect(call.provider).toBe('anthropic');
    });
  });

  describe('inferNonXmlStop', () => {
    it('should return true when content lacks </message> with natural stop', () => {
      expect(inferNonXmlStop('Let me respond as', 'stop', ['</message>'])).toBe(true);
    });

    it('should return false when content ends with </message>', () => {
      expect(inferNonXmlStop('Response here</message>', 'stop', ['</message>'])).toBe(false);
    });

    it('should return false when finish reason is not a natural stop', () => {
      expect(inferNonXmlStop('partial', 'length', ['</message>'])).toBe(false);
    });

    it('should return false when no stop sequences configured', () => {
      expect(inferNonXmlStop('partial', 'stop', undefined)).toBe(false);
      expect(inferNonXmlStop('partial', 'stop', [])).toBe(false);
    });

    it('should trim trailing whitespace before checking', () => {
      expect(inferNonXmlStop('Response here</message>  \n', 'stop', ['</message>'])).toBe(false);
    });
  });

  describe('recordLlmResponseDiagnostic', () => {
    it('should record response with usage data', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };
      const metadata: ParsedResponseMetadata = {
        usageMetadata: {
          input_tokens: 500,
          output_tokens: 200,
        },
        responseMetadata: {
          finish_reason: 'stop',
        },
      };

      recordLlmResponseDiagnostic(mockCollector as never, 'Hello world', 'test-model', metadata);

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(call.rawContent).toBe('Hello world');
      expect(call.modelUsed).toBe('test-model');
      expect(call.finishReason).toBe('stop');
      expect(call.promptTokens).toBe(500);
      expect(call.completionTokens).toBe(200);
    });

    it('should default to 0 tokens when usage is missing', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };
      const metadata: ParsedResponseMetadata = {};

      recordLlmResponseDiagnostic(mockCollector as never, 'content', 'model', metadata);

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(call.promptTokens).toBe(0);
      expect(call.completionTokens).toBe(0);
    });

    it('should resolve finish_reason from various field names', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };

      // Test stop_reason fallback
      recordLlmResponseDiagnostic(mockCollector as never, '', 'model', {
        responseMetadata: { stop_reason: 'length' },
      });

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(call.finishReason).toBe('length');
    });

    it('should detect reasoning tags in content for debug info', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };
      const content = '<reasoning>I think...</reasoning>\nHello world';

      recordLlmResponseDiagnostic(mockCollector as never, content, 'model', {});

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      const debug = call.reasoningDebug as Record<string, unknown>;
      expect(debug.hasReasoningTagsInContent).toBe(true);
    });

    it('should include raw content preview in debug info', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };
      const content = 'Short content';

      recordLlmResponseDiagnostic(mockCollector as never, content, 'model', {});

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      const debug = call.reasoningDebug as Record<string, unknown>;
      expect(debug.rawContentPreview).toBe('Short content');
    });

    it('should infer stop sequence when finish_reason is stop but content lacks </message>', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };
      const metadata: ParsedResponseMetadata = {
        responseMetadata: { finish_reason: 'stop' },
      };

      recordLlmResponseDiagnostic(mockCollector as never, 'Let me respond as', 'model', metadata, [
        '</message>',
        '<message',
      ]);

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(call.stopSequenceTriggered).toBe('inferred:non-xml-stop');
    });

    it('should not infer stop sequence when content ends with </message>', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };
      const metadata: ParsedResponseMetadata = {
        responseMetadata: { finish_reason: 'stop' },
      };

      recordLlmResponseDiagnostic(
        mockCollector as never,
        'Response here</message>',
        'model',
        metadata,
        ['</message>', '<message']
      );

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(call.stopSequenceTriggered).toBeNull();
    });
  });
});
