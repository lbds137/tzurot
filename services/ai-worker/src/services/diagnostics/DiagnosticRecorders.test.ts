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
  recordPreInvocationDiagnostics,
  recordBudgetDiagnostics,
  recordInputProcessingDiagnostics,
  recordPostProcessingDiagnostics,
  type ParsedResponseMetadata,
} from './DiagnosticRecorders.js';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { DiagnosticCollector } from '../DiagnosticCollector.js';
import type {
  BudgetAllocationResult,
  ConversationContext,
  MemoryDocument,
  ProcessedInputs,
} from '../ConversationalRAGTypes.js';
import type { MessageContent } from '@tzurot/common-types/types/ai';

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
        thinking: 'high',
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
        thinking: 'high',
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
        systemPromptSections: [],
        currentMessage: new HumanMessage('turn'),
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
        // The FINAL human message ('turn' fixture) — the volatile-prefix
        // container the /inspect budget view keys its new semantics on.
        currentMessageTokens: 'turn'.length,
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
        systemPromptSections: [],
        currentMessage: new HumanMessage('turn'),
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

  describe('recordPreInvocationDiagnostics', () => {
    it('records prompt (with sections), config, and start mark in one call', () => {
      const mockCollector = {
        recordAssembledPrompt: vi.fn(),
        recordLlmConfig: vi.fn(),
        markLlmInvocationStart: vi.fn(),
      };
      const sections = [{ id: 'system_identity', tier: 'S1' as const, chars: 10, offset: 0 }];
      const messages = [new SystemMessage('0123456789'), new HumanMessage('01234')];

      recordPreInvocationDiagnostics({
        collector: mockCollector as never,
        messages,
        systemPromptSections: sections,
        countTokens: text => text.length,
        modelName: 'z-ai/glm-4.7',
        personality: { topP: 0.9 } as never,
        effectiveTemperature: 0.8,
        effectiveFrequencyPenalty: undefined,
      });

      // Token estimate sums every message through the provided counter.
      expect(mockCollector.recordAssembledPrompt).toHaveBeenCalledWith(messages, 15, sections);
      expect(mockCollector.recordLlmConfig).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'z-ai/glm-4.7', temperature: 0.8, topP: 0.9 })
      );
      expect(mockCollector.markLlmInvocationStart).toHaveBeenCalledTimes(1);
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

      recordLlmResponseDiagnostic({
        collector: mockCollector as never,
        rawContent: 'Hello world',
        modelName: 'test-model',
        metadata,
        routedModel: undefined,
      });

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

      recordLlmResponseDiagnostic({
        collector: mockCollector as never,
        rawContent: 'content',
        modelName: 'model',
        metadata,
        routedModel: undefined,
      });

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(call.promptTokens).toBe(0);
      expect(call.completionTokens).toBe(0);
    });

    it('should thread cache telemetry through from both sources (sentinel values)', () => {
      // The cached-token count comes from LangChain's normalized usage path;
      // the discount only exists on the OpenRouter raw capture. Sentinels
      // assert each field reaches the collector from its OWN source — a
      // dropped forward here silently kills the epic's measurement.
      const mockCollector = { recordLlmResponse: vi.fn() };
      const metadata: ParsedResponseMetadata = {
        usageMetadata: {
          input_tokens: 6426,
          output_tokens: 1,
          input_token_details: { cache_read: 6272 },
        },
        responseMetadata: {
          finish_reason: 'stop',
          openrouter: { apiMessageKeys: [], apiReasoningLength: 0, cacheDiscount: -0.0123 },
        },
      };

      recordLlmResponseDiagnostic({
        collector: mockCollector as never,
        rawContent: 'response',
        modelName: 'model',
        metadata,
        routedModel: undefined,
      });

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(call.cachedPromptTokens).toBe(6272);
      expect(call.cacheDiscount).toBe(-0.0123);
    });

    it('should leave cache telemetry undefined when the provider reported none', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };
      const metadata: ParsedResponseMetadata = {
        usageMetadata: { input_tokens: 500, output_tokens: 200 },
      };

      recordLlmResponseDiagnostic({
        collector: mockCollector as never,
        rawContent: 'response',
        modelName: 'model',
        metadata,
        routedModel: undefined,
      });

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(call.cachedPromptTokens).toBeUndefined();
      expect(call.cacheDiscount).toBeUndefined();
    });

    it('should record the routedModel it was given, alongside the requested model', () => {
      // modelUsed is what we ASKED for; routedModel is threaded in from the
      // caller (readRoutedModel over the raw response), NOT recomputed from
      // metadata.responseMetadata.openrouter.model — that field is a
      // DIFFERENT, more narrowly-populated source, which is exactly why this
      // recorder must not read it independently (it would diverge from the
      // value the invocation result carries). metadata.openrouter.model is
      // deliberately left unset here to prove the value comes from the
      // options field, not from metadata.
      const mockCollector = { recordLlmResponse: vi.fn() };
      const metadata: ParsedResponseMetadata = {
        responseMetadata: {
          finish_reason: 'stop',
          openrouter: {
            apiMessageKeys: [],
            apiReasoningLength: 0,
          },
        },
      };

      recordLlmResponseDiagnostic({
        collector: mockCollector as never,
        rawContent: 'response',
        modelName: 'openrouter/auto',
        metadata,
        routedModel: 'google/gemini-2.5-flash',
      });

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(call.modelUsed).toBe('openrouter/auto');
      expect(call.routedModel).toBe('google/gemini-2.5-flash');
    });

    it('should leave the routed model undefined when none was passed in, even if metadata carries one', () => {
      // Pins the fix: the recorder must NOT fall back to reading
      // metadata.responseMetadata.openrouter.model when the caller passes no
      // routedModel — that field is a narrower, independently-populated
      // source and reading it here is exactly the divergence this recorder
      // must not reintroduce.
      const mockCollector = { recordLlmResponse: vi.fn() };
      const metadata: ParsedResponseMetadata = {
        responseMetadata: {
          finish_reason: 'stop',
          openrouter: {
            apiMessageKeys: [],
            apiReasoningLength: 0,
            model: 'anthropic/claude-sonnet-4',
          },
        },
      };

      recordLlmResponseDiagnostic({
        collector: mockCollector as never,
        rawContent: 'response',
        modelName: 'model',
        metadata,
        routedModel: undefined,
      });

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(call.routedModel).toBeUndefined();
    });

    it('should resolve finish_reason from various field names', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };

      // Test stop_reason fallback
      recordLlmResponseDiagnostic({
        collector: mockCollector as never,
        rawContent: '',
        modelName: 'model',
        metadata: { responseMetadata: { stop_reason: 'length' } },
        routedModel: undefined,
      });

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(call.finishReason).toBe('length');
    });

    it('should detect reasoning tags in content for debug info', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };
      const content = '<reasoning>I think...</reasoning>\nHello world';

      recordLlmResponseDiagnostic({
        collector: mockCollector as never,
        rawContent: content,
        modelName: 'model',
        metadata: {},
        routedModel: undefined,
      });

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      const debug = call.reasoningDebug as Record<string, unknown>;
      expect(debug.hasReasoningTagsInContent).toBe(true);
    });

    it('should detect <thought> tags via hasThinkingBlocks (DRY fix)', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };
      const content = '<thought>Analyzing request.</thought>\nHere is the answer.';

      recordLlmResponseDiagnostic({
        collector: mockCollector as never,
        rawContent: content,
        modelName: 'model',
        metadata: {},
        routedModel: undefined,
      });

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      const debug = call.reasoningDebug as Record<string, unknown>;
      expect(debug.hasReasoningTagsInContent).toBe(true);
    });

    it('should detect namespace-prefixed thinking tags', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };
      const NS = 'antml';
      const content = `<${NS}:thought>Internal processing.</${NS}:thought>\nResponse.`;

      recordLlmResponseDiagnostic({
        collector: mockCollector as never,
        rawContent: content,
        modelName: 'model',
        metadata: {},
        routedModel: undefined,
      });

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      const debug = call.reasoningDebug as Record<string, unknown>;
      expect(debug.hasReasoningTagsInContent).toBe(true);
    });

    it('should include raw content preview in debug info', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };
      const content = 'Short content';

      recordLlmResponseDiagnostic({
        collector: mockCollector as never,
        rawContent: content,
        modelName: 'model',
        metadata: {},
        routedModel: undefined,
      });

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

      recordLlmResponseDiagnostic({
        collector: mockCollector as never,
        rawContent: 'response',
        modelName: 'z-ai/glm-4.7',
        metadata,
        routedModel: undefined,
      });

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      const debug = call.reasoningDebug as Record<string, unknown>;
      expect(debug.upstreamProvider).toBe('Parasail');
      expect(debug.apiMessageKeys).toEqual(['role', 'content', 'reasoning', 'reasoning_details']);
      expect(debug.apiReasoningLength).toBe(1994);
    });

    it('should leave openrouter.* fields undefined when responseMetadata.openrouter is absent', () => {
      const mockCollector = { recordLlmResponse: vi.fn() };

      recordLlmResponseDiagnostic({
        collector: mockCollector as never,
        rawContent: 'response',
        modelName: 'model',
        metadata: {},
        routedModel: undefined,
      });

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

      recordLlmResponseDiagnostic({
        collector: mockCollector as never,
        rawContent: 'response',
        modelName: 'model',
        metadata,
        routedModel: undefined,
      });

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

      recordLlmResponseDiagnostic({
        collector: mockCollector as never,
        rawContent: 'response',
        modelName: 'z-ai/glm-4.7',
        metadata,
        routedModel: undefined,
      });

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

      recordLlmResponseDiagnostic({
        collector: mockCollector as never,
        rawContent: 'response',
        modelName: 'model',
        metadata,
        routedModel: undefined,
      });

      const call = mockCollector.recordLlmResponse.mock.calls[0][0] as Record<string, unknown>;
      const debug = call.reasoningDebug as Record<string, unknown>;
      expect(debug.hasReasoningInKwargs).toBe(true);
      expect(debug.reasoningKwargsLength).toBe(7);
    });
  });
  describe('recordInputProcessingDiagnostics', () => {
    it('records the raw message, attachments, projected references, and search query', () => {
      const mockCollector = { recordInputProcessing: vi.fn() } as unknown as DiagnosticCollector;
      const inputs = {
        processedAttachments: [{ type: 'image', url: 'https://cdn.example/a.png' }],
        searchQuery: 'the query',
      } as unknown as ProcessedInputs;
      // The extra field pins the PROJECTION: only id + content may cross the
      // collector seam, whatever else a reference row carries.
      const context = {
        referencedMessages: [
          { discordMessageId: '123', content: 'quoted text', authorUsername: 'must-not-cross' },
        ],
      } as unknown as ConversationContext;

      recordInputProcessingDiagnostics({
        collector: mockCollector,
        message: 'hello there',
        inputs,
        context,
      });

      expect(mockCollector.recordInputProcessing).toHaveBeenCalledWith({
        rawUserMessage: 'hello there',
        processedAttachments: inputs.processedAttachments,
        referencedMessages: [{ discordMessageId: '123', content: 'quoted text' }],
        searchQuery: 'the query',
      });
    });

    it('unwraps a structured message and passes absent references through as undefined', () => {
      const mockCollector = { recordInputProcessing: vi.fn() } as unknown as DiagnosticCollector;

      recordInputProcessingDiagnostics({
        collector: mockCollector,
        message: { content: 'structured body' } as unknown as MessageContent,
        inputs: { processedAttachments: [], searchQuery: '' } as unknown as ProcessedInputs,
        context: {} as ConversationContext,
      });

      expect(mockCollector.recordInputProcessing).toHaveBeenCalledWith({
        rawUserMessage: 'structured body',
        processedAttachments: [],
        referencedMessages: undefined,
        searchQuery: '',
      });
    });
  });

  describe('recordPostProcessingDiagnostics', () => {
    it('maps raw and cleaned content onto the collector field pairs', () => {
      const mockCollector = { recordPostProcessing: vi.fn() } as unknown as DiagnosticCollector;

      recordPostProcessingDiagnostics({
        collector: mockCollector,
        rawContent: 'raw with artifacts',
        thinkingContent: 'extracted thinking',
        cleanedContent: 'clean',
      });

      // Pins the extraction's field mapping: dedup happened upstream in the
      // response post-processor, so deduplicatedContent mirrors rawContent,
      // and stripped/final both carry the cleaned text.
      expect(mockCollector.recordPostProcessing).toHaveBeenCalledWith({
        rawContent: 'raw with artifacts',
        deduplicatedContent: 'raw with artifacts',
        thinkingContent: 'extracted thinking',
        strippedContent: 'clean',
        finalContent: 'clean',
      });
    });

    it('passes a null thinkingContent through unchanged', () => {
      const mockCollector = { recordPostProcessing: vi.fn() } as unknown as DiagnosticCollector;

      recordPostProcessingDiagnostics({
        collector: mockCollector,
        rawContent: 'raw',
        thinkingContent: null,
        cleanedContent: 'raw',
      });

      const call = (mockCollector.recordPostProcessing as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Record<string, unknown>;
      expect(call.thinkingContent).toBeNull();
    });
  });
});
