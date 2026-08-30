/**
 * Tests for modelInvocation
 *
 * Covers the seam the extraction created: `invokeModelAndClean` forwards the
 * assembled message array to `deps.llmInvoker.invokeWithRetry` and returns the
 * post-processor's cleaned content. Full behavioral coverage of this path
 * (reasoning gating, diagnostics, byte-parity of the message array) lives in
 * `ConversationalRAGService.test.ts` and is not duplicated here.
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { LLMInvoker } from './LLMInvoker.js';
import type { PromptBuilder } from './PromptBuilder.js';
import type { ResponsePostProcessor } from './ResponsePostProcessor.js';
import type { ConversationInputProcessor } from './ConversationInputProcessor.js';
import type { ConversationContext, ModelInvocationOptions } from './ConversationalRAGTypes.js';
import { invokeModelAndClean, type ModelInvocationDeps } from './modelInvocation.js';

/** Independent reference digest — not the implementation's own helper. */
function expectedHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}

const { mockLoggerInfo } = vi.hoisted(() => ({ mockLoggerInfo: vi.fn() }));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: mockLoggerInfo, debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('../redis.js', () => ({
  checkModelReasoningSupport: vi.fn().mockResolvedValue(true),
}));

const personality: LoadedPersonality = {
  id: 'personality-1',
  slug: 'test-bot',
  ownerId: 'owner-uuid',
  name: 'TestBot',
  displayName: 'Test Bot',
  systemPrompt: 'You are a test bot',
  characterInfo: 'Test character',
  personalityTraits: 'Helpful',
  model: 'gpt-4',
  provider: 'openrouter',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 8000,
  voiceEnabled: false,
};

const context: ConversationContext = {
  userId: 'user-1',
  channelId: 'channel-1',
  serverId: 'server-1',
  requestId: 'req-1',
};

function generatedResponseFields(): Record<string, unknown> {
  const call = mockLoggerInfo.mock.calls.find(([, message]) => message === 'Generated response');
  expect(call).toBeDefined();
  return call?.[0] as Record<string, unknown>;
}

describe('invokeModelAndClean', () => {
  let mockGetModel: ReturnType<typeof vi.fn>;
  let mockInvokeWithRetry: ReturnType<typeof vi.fn>;
  let mockCountTokens: ReturnType<typeof vi.fn>;
  let mockProcessResponse: ReturnType<typeof vi.fn>;
  let mockResolveUserName: ReturnType<typeof vi.fn>;
  let deps: ModelInvocationDeps;
  let baseOpts: ModelInvocationOptions;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetModel = vi.fn().mockReturnValue({
      model: { fakeModel: true },
      modelName: 'gpt-4',
      expectsRawResponse: true,
    });
    mockInvokeWithRetry = vi.fn().mockResolvedValue(new AIMessage('raw model output'));
    mockCountTokens = vi.fn().mockReturnValue(10);
    mockProcessResponse = vi.fn().mockReturnValue({
      cleanedContent: 'cleaned output',
      thinkingContent: null,
      wasDeduplicated: false,
      onlyThinkingProduced: false,
    });
    mockResolveUserName = vi.fn().mockReturnValue('Some User');

    deps = {
      promptBuilder: { countTokens: mockCountTokens } as unknown as PromptBuilder,
      llmInvoker: {
        getModel: mockGetModel,
        invokeWithRetry: mockInvokeWithRetry,
      } as unknown as LLMInvoker,
      responsePostProcessor: {
        processResponse: mockProcessResponse,
      } as unknown as ResponsePostProcessor,
      inputProcessor: {
        resolveUserName: mockResolveUserName,
      } as unknown as ConversationInputProcessor,
    };

    baseOpts = {
      personality,
      systemPrompt: new SystemMessage('system prompt text'),
      currentMessage: new HumanMessage('the current turn'),
      historyMessages: [new HumanMessage('older turn')],
      userMessage: 'the current turn',
      realMessagesEnabled: false,
      context,
    };
  });

  it('forwards the assembled message array to llmInvoker.invokeWithRetry', async () => {
    await invokeModelAndClean(deps, baseOpts);

    expect(mockInvokeWithRetry).toHaveBeenCalledTimes(1);
    const call = mockInvokeWithRetry.mock.calls[0]?.[0] as { messages: unknown[] };
    expect(call.messages).toEqual([
      baseOpts.systemPrompt,
      ...(baseOpts.historyMessages ?? []),
      baseOpts.currentMessage,
    ]);
  });

  it('forwards expectsRawResponse from getModel to invokeWithRetry', async () => {
    mockGetModel.mockReturnValue({
      model: { fakeModel: true },
      modelName: 'z-ai/glm-5',
      expectsRawResponse: false,
    });

    await invokeModelAndClean(deps, baseOpts);

    const call = mockInvokeWithRetry.mock.calls[0]?.[0] as { expectsRawResponse: boolean };
    expect(call.expectsRawResponse).toBe(false);
  });

  it('returns the post-processor cleaned content and model metadata', async () => {
    const result = await invokeModelAndClean(deps, baseOpts);

    expect(mockProcessResponse).toHaveBeenCalledTimes(1);
    expect(result.cleanedContent).toBe('cleaned output');
    expect(result.modelName).toBe('gpt-4');
    expect(result.onlyThinkingProduced).toBe(false);
  });

  it('returns routedModel when the invoke response carries response_metadata.model_name', async () => {
    mockInvokeWithRetry.mockResolvedValue(
      new AIMessage({
        content: 'raw model output',
        response_metadata: { model_name: 'anthropic/claude-x' },
      })
    );

    const result = await invokeModelAndClean(deps, baseOpts);

    expect(result.routedModel).toBe('anthropic/claude-x');
  });

  it('returns undefined routedModel when response_metadata carries no model_name', async () => {
    mockInvokeWithRetry.mockResolvedValue(
      new AIMessage({ content: 'raw model output', response_metadata: {} })
    );

    const result = await invokeModelAndClean(deps, baseOpts);

    expect(result.routedModel).toBeUndefined();
  });

  it('records the same routedModel on the diagnostic collector that it returns on the result', async () => {
    // Anti-divergence pin: the diagnostic surface (`/inspect`) and the
    // invocation result (the Discord footer) must extract routedModel from
    // the SAME source. `openrouter.model` is deliberately absent here — that
    // is the exact condition under which a recorder reading it independently
    // would diverge from the value the result carries.
    mockInvokeWithRetry.mockResolvedValue(
      new AIMessage({
        content: 'raw model output',
        response_metadata: { model_name: 'anthropic/claude-x' },
      })
    );
    const mockDiagnosticCollector = {
      recordAssembledPrompt: vi.fn(),
      recordLlmConfig: vi.fn(),
      markLlmInvocationStart: vi.fn(),
      recordLlmResponse: vi.fn(),
      recordPostProcessing: vi.fn(),
    };

    const result = await invokeModelAndClean(deps, {
      ...baseOpts,
      diagnosticCollector: mockDiagnosticCollector as never,
    });

    expect(result.routedModel).toBe('anthropic/claude-x');
    expect(mockDiagnosticCollector.recordLlmResponse).toHaveBeenCalledWith(
      expect.objectContaining({ routedModel: 'anthropic/claude-x' })
    );
  });

  it('threads realMessagesEnabled and telemetry into the post-processor context', async () => {
    await invokeModelAndClean(deps, { ...baseOpts, realMessagesEnabled: true });

    const ctx = mockProcessResponse.mock.calls[0]?.[3] as {
      realMessagesEnabled: boolean;
      telemetry?: { channelId?: string; requestId?: string };
    };
    expect(ctx.realMessagesEnabled).toBe(true);
    expect(ctx.telemetry).toEqual({ channelId: 'channel-1', requestId: 'req-1' });
  });

  it('omits crossChannelMessage from the assembled array when absent', async () => {
    await invokeModelAndClean(deps, { ...baseOpts, crossChannelMessage: undefined });

    const call = mockInvokeWithRetry.mock.calls[0]?.[0] as { messages: unknown[] };
    expect(call.messages).toHaveLength(3);
  });

  it('includes crossChannelMessage between the system prompt and history when present', async () => {
    const crossChannelMessage = new HumanMessage('<prior_conversations>');
    await invokeModelAndClean(deps, { ...baseOpts, crossChannelMessage });

    const call = mockInvokeWithRetry.mock.calls[0]?.[0] as { messages: unknown[] };
    expect(call.messages).toEqual([
      baseOpts.systemPrompt,
      crossChannelMessage,
      ...(baseOpts.historyMessages ?? []),
      baseOpts.currentMessage,
    ]);
  });

  it('forwards the shipped history count into the stable-prefix derivation', async () => {
    const crossChannelMessage = new HumanMessage('<prior_conversations>');
    await invokeModelAndClean(deps, {
      ...baseOpts,
      crossChannelMessage,
      historyMessages: [new HumanMessage('older turn')],
      // Flag-on ships an EMPTY serialized history (ContentBudgetManager), not
      // an absent one — this is the real flag-on shape.
      serializedHistory: '',
    });

    // Intervening array is ['<prior_conversations>', 'older turn'] with count
    // 1, so the stable prefix is just the cross-channel message — this can
    // only pass if shippedHistoryCount was forwarded to buildCacheObservability.
    expect(generatedResponseFields().promptHashHistoryStable).toBe(
      expectedHash('<prior_conversations>')
    );
  });

  it('emits no stable hash on a cross-channel-only turn', async () => {
    const crossChannelMessage = new HumanMessage('<prior_conversations>');
    await invokeModelAndClean(deps, {
      ...baseOpts,
      crossChannelMessage,
      historyMessages: [],
      // Flag-on ships an EMPTY serialized history (ContentBudgetManager), not
      // an absent one — this is the real flag-on shape.
      serializedHistory: '',
    });

    expect(generatedResponseFields()).not.toHaveProperty('promptHashHistoryStable');
  });

  it('does not leak the raw shippedHistoryCount onto the log object', async () => {
    await invokeModelAndClean(deps, baseOpts);

    expect(generatedResponseFields()).not.toHaveProperty('shippedHistoryCount');
  });
});
