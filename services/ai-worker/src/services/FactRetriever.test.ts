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
    tier: 'observed',
  }));
}

/** Mock FactStore exposing only the methods FactRetriever uses. */
function makeFactStore(
  overrides: Partial<
    Record<
      'embedStatement' | 'findSimilarActiveFacts' | 'findActiveFactsBySourceMemoryIds',
      ReturnType<typeof vi.fn>
    >
  > = {}
): {
  factStore: FactStore;
  embedStatement: ReturnType<typeof vi.fn>;
  findSimilarActiveFacts: ReturnType<typeof vi.fn>;
  findActiveFactsBySourceMemoryIds: ReturnType<typeof vi.fn>;
} {
  const embedStatement = overrides.embedStatement ?? vi.fn().mockResolvedValue(EMBEDDING);
  const findSimilarActiveFacts =
    overrides.findSimilarActiveFacts ?? vi.fn().mockResolvedValue(makeFacts('user likes tea'));
  const findActiveFactsBySourceMemoryIds =
    overrides.findActiveFactsBySourceMemoryIds ?? vi.fn().mockResolvedValue([]);
  return {
    factStore: {
      embedStatement,
      findSimilarActiveFacts,
      findActiveFactsBySourceMemoryIds,
    } as unknown as FactStore,
    embedStatement,
    findSimilarActiveFacts,
    findActiveFactsBySourceMemoryIds,
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

  // @spec MEM-ARCH-011 — a linked-facts fetch failure degrades to no facts
  describe('retrieveLinkedFacts', () => {
    it('delegates to the store for the given memory ids and personality', async () => {
      const linked = [
        { id: 'f-1', statement: 'Alice likes tea', salience: 0.8, sourceMemoryIds: ['m-1'] },
      ];
      const { factStore, findActiveFactsBySourceMemoryIds } = makeFactStore({
        findActiveFactsBySourceMemoryIds: vi.fn().mockResolvedValue(linked),
      });
      const retriever = new FactRetriever(factStore);

      const result = await retriever.retrieveLinkedFacts(['m-1'], 'pers-1');

      expect(findActiveFactsBySourceMemoryIds).toHaveBeenCalledWith(['m-1'], 'pers-1');
      expect(result).toEqual(linked);
    });

    it('skips the query and returns [] for an empty memory-id list', async () => {
      const { factStore, findActiveFactsBySourceMemoryIds } = makeFactStore();
      const retriever = new FactRetriever(factStore);

      expect(await retriever.retrieveLinkedFacts([], 'pers-1')).toEqual([]);
      expect(findActiveFactsBySourceMemoryIds).not.toHaveBeenCalled();
    });

    it('MEM-ARCH-011: fails soft — returns [] when the query throws (never falls back to verbatim)', async () => {
      const { factStore } = makeFactStore({
        findActiveFactsBySourceMemoryIds: vi.fn().mockRejectedValue(new Error('db down')),
      });
      const retriever = new FactRetriever(factStore);

      expect(await retriever.retrieveLinkedFacts(['m-1'], 'pers-1')).toEqual([]);
    });
  });
});
