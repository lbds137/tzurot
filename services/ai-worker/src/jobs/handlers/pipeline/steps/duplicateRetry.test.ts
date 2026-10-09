/**
 * Direct tests for the extracted retry state machine. GenerationStep's suite
 * exercises this through process(); these assert the loop's own contract —
 * attempt counting, retry triggers, and what crosses into the RAG seam.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ConversationalRAGService } from '../../../../services/ConversationalRAGService.js';
import type {
  RAGResponse,
  ConversationContext,
} from '../../../../services/ConversationalRAGTypes.js';
import type { MessageContent } from '@tzurot/common-types/types/ai';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { stampLlmDeadline } from './llmBudget.js';
import { generateWithDuplicateRetry } from './duplicateRetry.js';

vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function ragResponse(content: string): RAGResponse {
  return { content, tokensIn: 10, tokensOut: 10 } as unknown as RAGResponse;
}

function ragServiceReturning(...responses: RAGResponse[]): ConversationalRAGService {
  const generateResponse = vi.fn();
  for (const response of responses) {
    generateResponse.mockResolvedValueOnce(response);
  }
  return { generateResponse } as unknown as ConversationalRAGService;
}

function baseOpts(recentAssistantMessages: string[] = []) {
  return {
    personality: { id: 'p1', name: 'Testy', model: 'some/model' } as never,
    message: 'hello' as MessageContent,
    conversationContext: { messages: [] } as unknown as ConversationContext,
    recentAssistantMessages,
    apiKey: 'sk-key',
    sttDispatch: undefined,
    isGuestMode: false,
    jobId: 'job-1',
  };
}

describe('generateWithDuplicateRetry', () => {
  it('returns the first response untouched when it is fresh and non-empty', async () => {
    const ragService = ragServiceReturning(ragResponse('a fresh reply'));

    const result = await generateWithDuplicateRetry(ragService, undefined, baseOpts());

    expect(result.response.content).toBe('a fresh reply');
    expect(result.duplicateRetries).toBe(0);
    expect(result.emptyRetries).toBe(0);
    expect(vi.mocked(ragService.generateResponse)).toHaveBeenCalledTimes(1);
  });

  it('retries an EMPTY response and returns the recovered attempt', async () => {
    const ragService = ragServiceReturning(ragResponse(''), ragResponse('recovered'));

    const result = await generateWithDuplicateRetry(ragService, undefined, baseOpts());

    expect(result.response.content).toBe('recovered');
    expect(result.emptyRetries).toBe(1);
    expect(vi.mocked(ragService.generateResponse)).toHaveBeenCalledTimes(2);
  });

  it('retries an ECHO of the user message and returns the real reply', async () => {
    // The provider misplaced the reply into the reasoning channel and emitted
    // the input verbatim as content — non-empty, and unlike any prior
    // assistant message, so only the echo gate catches it.
    const userMessage =
      'Tell me about the garden you were describing yesterday, the one behind the old chapel.';
    const realReply =
      'The chapel garden has gone wild since the frost — the roses climb the wall now.';
    const ragService = ragServiceReturning(ragResponse(userMessage), ragResponse(realReply));

    const result = await generateWithDuplicateRetry(ragService, undefined, {
      ...baseOpts(),
      message: userMessage as MessageContent,
    });

    expect(result.response.content).toBe(realReply);
    expect(result.echoRetries).toBe(1);
    expect(result.emptyRetries).toBe(0);
    expect(vi.mocked(ragService.generateResponse)).toHaveBeenCalledTimes(2);
  });

  it('retries an exact cross-turn DUPLICATE and returns the fresh attempt', async () => {
    // Similarity checking requires >=30 cleaned chars — short strings skip it.
    const dup = 'these are exactly the same words the assistant already said before';
    const ragService = ragServiceReturning(
      ragResponse(dup),
      ragResponse('an entirely different and equally long reply about another topic')
    );

    const result = await generateWithDuplicateRetry(ragService, undefined, baseOpts([dup]));

    expect(result.response.content).toContain('entirely different');
    expect(result.duplicateRetries).toBe(1);
  });

  it('exhausts attempts on persistent duplicates and serves the best fallback', async () => {
    const dup = 'this response is stuck on repeat saying the very same thing every attempt';
    const ragService = ragServiceReturning(ragResponse(dup), ragResponse(dup), ragResponse(dup));

    const result = await generateWithDuplicateRetry(ragService, undefined, baseOpts([dup]));

    // All attempts spent; the loop returns rather than throwing.
    expect(vi.mocked(ragService.generateResponse)).toHaveBeenCalledTimes(3);
    expect(result.response.content).toBe(dup);
    expect(result.duplicateRetries).toBeGreaterThanOrEqual(2);
  });

  it('passes the model params + api key across the RAG seam on every attempt', async () => {
    const ragService = ragServiceReturning(ragResponse(''), ragResponse('ok'));
    const opts = baseOpts();

    await generateWithDuplicateRetry(ragService, undefined, opts);

    const calls = vi.mocked(ragService.generateResponse).mock.calls;
    for (const call of calls) {
      expect(call[0]).toMatchObject({ id: 'p1', model: 'some/model' });
      expect(call[3]).toMatchObject({ userApiKey: 'sk-key' });
    }
  });

  describe('job LLM budget gate', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('chain: first attempt burns most of the budget and duplicates — the second outer iteration never starts, best prior response returned', async () => {
      vi.useFakeTimers();
      const start = Date.now();
      vi.setSystemTime(start);
      const deadline = stampLlmDeadline();
      // Leaves 250s — under one full attempt, so the between-iterations gate
      // must fire.
      const spend = TIMEOUTS.LLM_JOB_BUDGET - TIMEOUTS.LLM_PER_ATTEMPT + 50_000;
      // The dup must clear the 30-char similarity floor so the loop wants a
      // retry after attempt 1.
      const dup = 'this response is stuck on repeat saying the very same thing every attempt';
      const generateResponse = vi.fn().mockImplementation(async () => {
        vi.advanceTimersByTime(spend);
        return ragResponse(dup);
      });
      const ragService = { generateResponse } as unknown as ConversationalRAGService;

      const result = await generateWithDuplicateRetry(ragService, undefined, {
        ...baseOpts([dup]),
        llmDeadline: deadline,
      });

      // Attempt 1 ran; the gate stopped the loop before attempt 2.
      expect(generateResponse).toHaveBeenCalledTimes(1);
      // The loop's existing "cannot run another attempt" contract: the best
      // prior (fallback) response with its retry counters — not a throw.
      expect(result.response.content).toBe(dup);
      expect(result.duplicateRetries).toBe(1);
      expect(Date.now() - start).toBeLessThanOrEqual(
        TIMEOUTS.LLM_JOB_BUDGET + TIMEOUTS.LLM_PER_ATTEMPT
      );
    });

    it('empty first attempt that spends the budget: the gate returns that empty response (return-not-throw, like the catch path)', async () => {
      vi.useFakeTimers();
      const start = Date.now();
      vi.setSystemTime(start);
      const deadline = stampLlmDeadline();
      // Leaves 250s — under one full attempt, so the between-iterations gate
      // must fire after the empty rejection.
      const spend = TIMEOUTS.LLM_JOB_BUDGET - TIMEOUTS.LLM_PER_ATTEMPT + 50_000;
      const generateResponse = vi.fn().mockImplementation(async () => {
        vi.advanceTimersByTime(spend);
        return ragResponse('');
      });
      const ragService = { generateResponse } as unknown as ConversationalRAGService;

      const result = await generateWithDuplicateRetry(ragService, undefined, {
        ...baseOpts(),
        llmDeadline: deadline,
      });

      // Attempt 1 ran and was rejected as empty (stored as the loop's
      // fallback); the gate stopped the loop before attempt 2 and returned
      // that empty fallback — returning-not-throwing on exhaustion is the
      // contract for the empty path too.
      expect(generateResponse).toHaveBeenCalledTimes(1);
      expect(result.response.content).toBe('');
      expect(result.emptyRetries).toBe(1);
    });

    it('an unstamped deadline keeps the ungated retry behavior (backward-compat)', async () => {
      const dup = 'this response is stuck on repeat saying the very same thing every attempt';
      const ragService = ragServiceReturning(
        ragResponse(dup),
        ragResponse('a fresh and totally different reply')
      );

      const result = await generateWithDuplicateRetry(ragService, undefined, baseOpts([dup]));

      expect(vi.mocked(ragService.generateResponse)).toHaveBeenCalledTimes(2);
      expect(result.response.content).toContain('totally different');
      expect(result.duplicateRetries).toBe(1);
    });
  });
});
