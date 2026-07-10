import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getConfig } from '@tzurot/common-types/config/config';
import { retrieveFactsForPrompt } from './factRetrievalHelper.js';
import type { FactRetriever } from './FactRetriever.js';
import type { SimilarFact } from './extraction/FactStore.js';

vi.mock('@tzurot/common-types/config/config', () => ({ getConfig: vi.fn() }));

function setFlag(value: 'true' | 'false' | undefined): void {
  vi.mocked(getConfig).mockReturnValue({ FACTS_IN_PROMPT_ENABLED: value } as never);
}

function mockRetriever(): FactRetriever {
  const facts: SimilarFact[] = [
    {
      id: '1',
      statement: 'user likes tea',
      entityTags: [],
      similarity: 0.9,
      isLocked: false,
      tier: 'observed',
    },
  ];
  return { retrieveFacts: vi.fn().mockResolvedValue(facts) } as unknown as FactRetriever;
}

describe('retrieveFactsForPrompt (flag/scope gate)', () => {
  beforeEach(() => setFlag('true'));

  it('returns [] and never queries when the flag is off (prod default)', async () => {
    setFlag(undefined);
    const retriever = mockRetriever();
    expect(await retrieveFactsForPrompt(retriever, 'pers', 'persona', 'q', false)).toEqual([]);
    expect(retriever.retrieveFacts).not.toHaveBeenCalled();
  });

  it('returns [] when no retriever is wired (no memory manager)', async () => {
    expect(await retrieveFactsForPrompt(undefined, 'pers', 'persona', 'q', false)).toEqual([]);
  });

  it('returns [] and never queries when personaId is undefined (LTM skipped this turn)', async () => {
    const retriever = mockRetriever();
    expect(await retrieveFactsForPrompt(retriever, 'pers', undefined, 'q', false)).toEqual([]);
    expect(retriever.retrieveFacts).not.toHaveBeenCalled();
  });

  it('queries scoped to persona×personality when flag on + retriever + personaId present', async () => {
    const retriever = mockRetriever();
    const facts = await retrieveFactsForPrompt(
      retriever,
      'pers',
      'persona',
      'what do i like?',
      false
    );
    expect(retriever.retrieveFacts).toHaveBeenCalledWith('what do i like?', 'pers', 'persona');
    expect(facts.map(f => f.statement)).toEqual(['user likes tea']);
  });

  it('shareLtmAcrossPersonalities drops the personality filter — parity with episode retrieval', async () => {
    const retriever = mockRetriever();
    await retrieveFactsForPrompt(retriever, 'pers', 'persona', 'q', true);
    // null personality = all of the persona's characters, matching
    // MemoryRetriever's widening under the same flag.
    expect(retriever.retrieveFacts).toHaveBeenCalledWith('q', null, 'persona');
  });
});
