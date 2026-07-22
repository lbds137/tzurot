/**
 * Tests for DiagnosticRecorders
 *
 * Tests the pure helper functions that parse LLM response metadata
 * and build diagnostic data objects.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock @tzurot/common-types (needed by transitive imports)
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
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
  recordBudgetDiagnostics,
  type ParsedResponseMetadata,
} from './DiagnosticRecorders.js';
import { SystemMessage } from '@langchain/core/messages';
import type { DiagnosticCollector } from '../DiagnosticCollector.js';
import type { BudgetAllocationResult, MemoryDocument } from '../ConversationalRAGTypes.js';

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
        logitBias: undefined,
        responseFormat: undefined,
        showThinking: false,
        reasoning: { effort: 'high' },
        transforms: ['middle-out'],
        route: 'fallback',
        verbosity: undefined,
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
      });

      const call = mockCollector.recordLlmConfig.mock.calls[0][0] as Record<string, unknown>;
      expect(call.provider).toBe('anthropic');
    });
  });

  describe('recordBudgetDiagnostics', () => {
    it('should record memory retrieval and token budget from the allocation result', () => {
      const mockCollector = {
        recordMemoryRetrieval: vi.fn(),
        recordTokenBudget: vi.fn(),
      } as unknown as DiagnosticCollector;
      const memories: MemoryDocument[] = [{ pageContent: 'a memory', metadata: {} }];
      const budgetResult: BudgetAllocationResult = {
        relevantMemories: memories,
        selectedFacts: [],
        serializedHistory: '',
        systemPrompt: new SystemMessage('system prompt text'),
        memoryTokensUsed: 50,
        factTokensUsed: 0,
        historyTokensUsed: 200,
        memoriesDroppedCount: 1,
        messagesDropped: 2,
        contentForStorage: '',
        crossChannelMessagesIncluded: 3,
      };

      recordBudgetDiagnostics({
        collector: mockCollector,
        retrievedMemories: memories,
        freshModeEnabled: true,
        budgetResult,
        retrievedFactsCount: 0,
        contextWindowSize: 24576,
        countTokens: text => text.length,
      });

      expect(mockCollector.recordMemoryRetrieval).toHaveBeenCalledWith({
        retrievedMemories: memories,
        selectedMemories: memories,
        freshModeEnabled: true,
      });
      expect(mockCollector.recordTokenBudget).toHaveBeenCalledWith({
        contextWindowSize: 24576,
        systemPromptTokens: 'system prompt text'.length,
        memoryTokensUsed: 50,
        historyTokensUsed: 200,
        memoriesDropped: 1,
        historyMessagesDropped: 2,
        factTokensUsed: 0,
        factsIncluded: 0,
        factsDropped: 0,
        crossChannelMessagesIncluded: 3,
      });
    });

    it('forwards fact accounting across the collector seam', () => {
      // The exact seam that dropped fact tokens before: budgetResult carried
      // factTokensUsed but the recorder never passed it to the collector, so
      // /inspect's token budget silently absorbed facts into "System".
      const mockCollector = {
        recordMemoryRetrieval: vi.fn(),
        recordTokenBudget: vi.fn(),
      } as unknown as DiagnosticCollector;
      const budgetResult: BudgetAllocationResult = {
        relevantMemories: [],
        selectedFacts: [{ statement: 'fact a' }, { statement: 'fact b' }],
        serializedHistory: '',
        systemPrompt: new SystemMessage('sys'),
        memoryTokensUsed: 10,
        factTokensUsed: 42,
        historyTokensUsed: 20,
        memoriesDroppedCount: 0,
        messagesDropped: 0,
        contentForStorage: '',
      };

      recordBudgetDiagnostics({
        collector: mockCollector,
        retrievedMemories: [],
        freshModeEnabled: false,
        budgetResult,
        retrievedFactsCount: 5,
        contextWindowSize: 24576,
        countTokens: () => 0,
      });

      expect(mockCollector.recordTokenBudget).toHaveBeenCalledWith(
        expect.objectContaining({
          factTokensUsed: 42,
          factsIncluded: 2,
          factsDropped: 3,
        })
      );
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

    it('should detect <thought> tags via hasThinkingBlocks (DRY fix)', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };
      const content = '<thought>Analyzing request.</thought>\nHere is the answer.';

      recordLlmResponseDiagnostic(mockCollector as never, content, 'model', {});

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      const debug = call.reasoningDebug as Record<string, unknown>;
      expect(debug.hasReasoningTagsInContent).toBe(true);
    });

    it('should detect namespace-prefixed thinking tags', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };
      const NS = 'antml';
      const content = `<${NS}:thought>Internal processing.</${NS}:thought>\nResponse.`;

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

    it('should surface upstream OpenRouter provider from responseMetadata.openrouter (NOT LangChain hardcoded "openai")', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };
      const metadata: ParsedResponseMetadata = {
        responseMetadata: {
          openrouter: {
            provider: 'Parasail',
            apiMessageKeys: ['role', 'content', 'reasoning', 'reasoning_details'],
            apiReasoningLength: 1994,
          },
        },
      };

      recordLlmResponseDiagnostic(mockCollector as never, 'response', 'z-ai/glm-4.7', metadata);

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      const debug = call.reasoningDebug as Record<string, unknown>;
      expect(debug.upstreamProvider).toBe('Parasail');
      expect(debug.apiMessageKeys).toEqual(['role', 'content', 'reasoning', 'reasoning_details']);
      expect(debug.apiReasoningLength).toBe(1994);
    });

    it('should leave openrouter.* fields undefined when responseMetadata.openrouter is absent', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };

      recordLlmResponseDiagnostic(mockCollector as never, 'response', 'model', {});

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      const debug = call.reasoningDebug as Record<string, unknown>;
      expect(debug.upstreamProvider).toBeUndefined();
      expect(debug.apiMessageKeys).toBeUndefined();
      expect(debug.apiReasoningLength).toBeUndefined();
    });

    it('should count reasoning length from additionalKwargs.reasoning (OpenRouter shape)', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };
      const metadata: ParsedResponseMetadata = {
        additionalKwargs: { reasoning: 'I am thinking about this carefully.' },
      };

      recordLlmResponseDiagnostic(mockCollector as never, 'response', 'model', metadata);

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      const debug = call.reasoningDebug as Record<string, unknown>;
      expect(debug.hasReasoningInKwargs).toBe(true);
      expect(debug.reasoningKwargsLength).toBe(35);
    });

    it('should fall back to additionalKwargs.reasoning_content when `reasoning` is absent (z.ai shape)', () => {
      // z.ai-direct responses (e.g., glm-4.7 via the coding-plan endpoint)
      // surface their reasoning under `reasoning_content` rather than
      // `reasoning`. Without the fallback, the counter would misleadingly
      // report `false`/`0` for successful z.ai extractions.
      const mockCollector = { recordLlmResponse: vi.fn() };
      const metadata: ParsedResponseMetadata = {
        additionalKwargs: { reasoning_content: 'z.ai reasoning text here' },
      };

      recordLlmResponseDiagnostic(mockCollector as never, 'response', 'z-ai/glm-4.7', metadata);

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      const debug = call.reasoningDebug as Record<string, unknown>;
      expect(debug.hasReasoningInKwargs).toBe(true);
      expect(debug.reasoningKwargsLength).toBe(24);
    });

    it('should prefer `reasoning` over `reasoning_content` when both are present', () => {
      // Defensive — no provider should send both, but if one ever does,
      // `reasoning` (the broader-ecosystem convention) wins so the counter
      // stays consistent with apiReasoningLength.
      const mockCollector = { recordLlmResponse: vi.fn() };
      const metadata: ParsedResponseMetadata = {
        additionalKwargs: {
          reasoning: 'primary',
          reasoning_content: 'secondary',
        },
      };

      recordLlmResponseDiagnostic(mockCollector as never, 'response', 'model', metadata);

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      const debug = call.reasoningDebug as Record<string, unknown>;
      expect(debug.hasReasoningInKwargs).toBe(true);
      expect(debug.reasoningKwargsLength).toBe(7);
    });
  });
});
