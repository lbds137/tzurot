import { describe, it, expect, vi } from 'vitest';
import { FactRetriever, FACT_RETRIEVAL_LIMIT } from './FactRetriever.js';
import type { FactStore, SimilarFact } from './extraction/FactStore.js';

const EMBEDDING = [0.1, 0.2, 0.3];

function makeFacts(...statements: string[]): SimilarFact[] {
  return statements.map((statement, i) => ({
    id: `fact-${i}`,
    statement,
    entityTags: [],
    similarity: 0.9 - i * 0.01,
    isLocked: false,
  }));
}

/** Mock FactStore exposing only the two methods FactRetriever uses. */
function makeFactStore(
  overrides: Partial<
    Record<'embedStatement' | 'findSimilarActiveFacts', ReturnType<typeof vi.fn>>
  > = {}
): {
  factStore: FactStore;
  embedStatement: ReturnType<typeof vi.fn>;
  findSimilarActiveFacts: ReturnType<typeof vi.fn>;
} {
  const embedStatement = overrides.embedStatement ?? vi.fn().mockResolvedValue(EMBEDDING);
  const findSimilarActiveFacts =
    overrides.findSimilarActiveFacts ?? vi.fn().mockResolvedValue(makeFacts('user likes tea'));
  return {
    factStore: { embedStatement, findSimilarActiveFacts } as unknown as FactStore,
    embedStatement,
    findSimilarActiveFacts,
  };
}

describe('FactRetriever', () => {
  it('embeds the query and queries facts scoped to persona×personality', async () => {
    const { factStore, embedStatement, findSimilarActiveFacts } = makeFactStore();
    const retriever = new FactRetriever(factStore);

    const facts = await retriever.retrieveFacts('what does the user like?', 'pers-1', 'persona-1');

    expect(embedStatement).toHaveBeenCalledWith('what does the user like?');
    // Assert the args crossing the seam — scope + the embedding + default limit.
    expect(findSimilarActiveFacts).toHaveBeenCalledWith(
      EMBEDDING,
      'pers-1',
      'persona-1',
      FACT_RETRIEVAL_LIMIT
    );
    expect(facts.map(f => f.statement)).toEqual(['user likes tea']);
  });

  it('passes a null persona through (world/canon facts)', async () => {
    const { factStore, findSimilarActiveFacts } = makeFactStore();
    const retriever = new FactRetriever(factStore);

    await retriever.retrieveFacts('q', 'pers-1', null, 3);

    expect(findSimilarActiveFacts).toHaveBeenCalledWith(EMBEDDING, 'pers-1', null, 3);
  });

  it('fails soft — returns [] when embedding throws (generation must not break)', async () => {
    const { factStore, findSimilarActiveFacts } = makeFactStore({
      embedStatement: vi.fn().mockRejectedValue(new Error('embedding service not ready')),
    });
    const retriever = new FactRetriever(factStore);

    const facts = await retriever.retrieveFacts('q', 'pers-1', 'persona-1');

    expect(facts).toEqual([]);
    expect(findSimilarActiveFacts).not.toHaveBeenCalled();
  });

  it('fails soft — returns [] when the query throws', async () => {
    const { factStore } = makeFactStore({
      findSimilarActiveFacts: vi.fn().mockRejectedValue(new Error('db down')),
    });
    const retriever = new FactRetriever(factStore);

    expect(await retriever.retrieveFacts('q', 'pers-1', 'persona-1')).toEqual([]);
  });
});
