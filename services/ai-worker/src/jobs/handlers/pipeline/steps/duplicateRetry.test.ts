/**
 * Direct tests for the extracted retry state machine. GenerationStep's suite
 * exercises this through process(); these assert the loop's own contract —
 * attempt counting, retry triggers, and what crosses into the RAG seam.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ConversationalRAGService } from '../../../../services/ConversationalRAGService.js';
import type {
  RAGResponse,
  ConversationContext,
} from '../../../../services/ConversationalRAGTypes.js';
import type { MessageContent } from '@tzurot/common-types/types/ai';
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
});
