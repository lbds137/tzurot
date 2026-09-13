import { describe, it, expect, vi } from 'vitest';
import { FactRetriever, FACT_RETRIEVAL_LIMIT, RESERVED_FACT_SLOTS } from './FactRetriever.js';
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
      | 'embedStatement'
      | 'findSimilarActiveFacts'
      | 'findReservedActiveFacts'
      | 'findActiveFactsBySourceMemoryIds',
      ReturnType<typeof vi.fn>
    >
  > = {}
): {
  factStore: FactStore;
  embedStatement: ReturnType<typeof vi.fn>;
  findSimilarActiveFacts: ReturnType<typeof vi.fn>;
  findReservedActiveFacts: ReturnType<typeof vi.fn>;
  findActiveFactsBySourceMemoryIds: ReturnType<typeof vi.fn>;
} {
  const embedStatement = overrides.embedStatement ?? vi.fn().mockResolvedValue(EMBEDDING);
  const findSimilarActiveFacts =
    overrides.findSimilarActiveFacts ?? vi.fn().mockResolvedValue(makeFacts('user likes tea'));
  const findReservedActiveFacts =
    overrides.findReservedActiveFacts ?? vi.fn().mockResolvedValue([]);
  const findActiveFactsBySourceMemoryIds =
    overrides.findActiveFactsBySourceMemoryIds ?? vi.fn().mockResolvedValue([]);
  return {
    factStore: {
      embedStatement,
      findSimilarActiveFacts,
      findReservedActiveFacts,
      findActiveFactsBySourceMemoryIds,
    } as unknown as FactStore,
    embedStatement,
    findSimilarActiveFacts,
    findReservedActiveFacts,
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

  describe('reserved-fact merge', () => {
    /** A ten-fact similarity list at similarity 0.90..0.81, none overlapping the reserved fact. */
    function similarityFacts(): SimilarFact[] {
      return Array.from({ length: 10 }, (_, i) => ({
        id: `sim-${i}`,
        statement: `similarity fact ${i}`,
        entityTags: [],
        similarity: 0.9 - i * 0.01, // 0.90, 0.89, ..., 0.81
        isLocked: false,
        tier: 'observed',
      }));
    }

    it('a low-similarity reserved fact still renders, first, without displacing the count', async () => {
      const reservedFact: SimilarFact = {
        id: 'reserved-1',
        statement: 'the user is locked-in identity fact',
        entityTags: [],
        similarity: 0.05, // clearly below the similarity list's cut (0.81 lowest)
        isLocked: true,
        tier: 'observed',
      };
      const { factStore } = makeFactStore({
        findSimilarActiveFacts: vi.fn().mockResolvedValue(similarityFacts()),
        findReservedActiveFacts: vi.fn().mockResolvedValue([reservedFact]),
      });
      const retriever = new FactRetriever(factStore);

      const facts = await retriever.retrieveFacts('q', 'pers-1', 'persona-1');

      expect(facts).toHaveLength(10);
      expect(facts[0].id).toBe('reserved-1');
      expect(facts[0].reserved).toBe(true);
      expect(facts.map(f => f.id)).not.toContain('sim-9'); // bumped out by the reserved slot
    });

    it('calls findReservedActiveFacts with the scope args and a slot count capped at RESERVED_FACT_SLOTS', async () => {
      const { factStore, findReservedActiveFacts } = makeFactStore();
      const retriever = new FactRetriever(factStore);

      await retriever.retrieveFacts('q', 'pers-1', 'persona-1');

      expect(findReservedActiveFacts).toHaveBeenCalledWith(
        'pers-1',
        'persona-1',
        RESERVED_FACT_SLOTS
      );
    });

    it('empty reserved list ⇒ merged result is unchanged from the similarity-only list', async () => {
      const simFacts = similarityFacts();
      const { factStore } = makeFactStore({
        findSimilarActiveFacts: vi.fn().mockResolvedValue(simFacts),
        findReservedActiveFacts: vi.fn().mockResolvedValue([]),
      });
      const retriever = new FactRetriever(factStore);

      const facts = await retriever.retrieveFacts('q', 'pers-1', 'persona-1');

      expect(facts).toEqual(simFacts);
      expect(facts).toBe(simFacts); // same array reference, not a shallow copy
    });

    it('dedupes a fact id present in both lists, keeping the reserved position, and never exceeds the limit', async () => {
      const overlapping: SimilarFact = {
        id: 'sim-0',
        statement: 'similarity fact 0',
        entityTags: [],
        similarity: 0.9,
        isLocked: true,
        tier: 'observed',
      };
      const { factStore } = makeFactStore({
        findSimilarActiveFacts: vi.fn().mockResolvedValue(similarityFacts()),
        findReservedActiveFacts: vi.fn().mockResolvedValue([overlapping]),
      });
      const retriever = new FactRetriever(factStore);

      const facts = await retriever.retrieveFacts('q', 'pers-1', 'persona-1', 10);

      const occurrences = facts.filter(f => f.id === 'sim-0');
      expect(occurrences).toHaveLength(1);
      expect(facts[0].id).toBe('sim-0'); // reserved position, not its similarity-list position
      expect(facts.length).toBeLessThanOrEqual(10);
    });

    it('a rejecting reserved query yields the similarity list intact (independent degrade)', async () => {
      const simFacts = similarityFacts();
      const { factStore } = makeFactStore({
        findSimilarActiveFacts: vi.fn().mockResolvedValue(simFacts),
        findReservedActiveFacts: vi.fn().mockRejectedValue(new Error('db down')),
      });
      const retriever = new FactRetriever(factStore);

      const facts = await retriever.retrieveFacts('q', 'pers-1', 'persona-1');

      expect(facts).toEqual(simFacts);
      expect(facts.some(f => f.reserved === true)).toBe(false);
    });

    it('a rejecting similarity query still yields the reserved facts (independent degrade)', async () => {
      const reservedFact: SimilarFact = {
        id: 'reserved-3',
        statement: 'a reserved fact',
        entityTags: [],
        similarity: 0,
        isLocked: true,
        tier: 'observed',
      };
      const { factStore } = makeFactStore({
        findSimilarActiveFacts: vi.fn().mockRejectedValue(new Error('db down')),
        findReservedActiveFacts: vi.fn().mockResolvedValue([reservedFact]),
      });
      const retriever = new FactRetriever(factStore);

      const facts = await retriever.retrieveFacts('q', 'pers-1', 'persona-1');

      expect(facts).toHaveLength(1);
      expect(facts[0].id).toBe('reserved-3');
      expect(facts[0].reserved).toBe(true);
    });

    it('an embedding failure still yields the reserved facts (independent degrade)', async () => {
      const reservedFact: SimilarFact = {
        id: 'reserved-4',
        statement: 'a reserved fact',
        entityTags: [],
        similarity: 0,
        isLocked: true,
        tier: 'observed',
      };
      const { factStore, findSimilarActiveFacts } = makeFactStore({
        embedStatement: vi.fn().mockRejectedValue(new Error('embedding service not ready')),
        findReservedActiveFacts: vi.fn().mockResolvedValue([reservedFact]),
      });
      const retriever = new FactRetriever(factStore);

      const facts = await retriever.retrieveFacts('q', 'pers-1', 'persona-1');

      expect(facts).toHaveLength(1);
      expect(facts[0].id).toBe('reserved-4');
      expect(facts[0].reserved).toBe(true);
      expect(findSimilarActiveFacts).not.toHaveBeenCalled();
    });

    it('returns [] when both the embedding and the reserved query fail', async () => {
      const { factStore, findSimilarActiveFacts } = makeFactStore({
        embedStatement: vi.fn().mockRejectedValue(new Error('embedding service not ready')),
        findReservedActiveFacts: vi.fn().mockRejectedValue(new Error('db down')),
      });
      const retriever = new FactRetriever(factStore);

      expect(await retriever.retrieveFacts('q', 'pers-1', 'persona-1')).toEqual([]);
      expect(findSimilarActiveFacts).not.toHaveBeenCalled();
    });

    it('returns [] when both the similarity and the reserved query fail', async () => {
      const { factStore } = makeFactStore({
        findSimilarActiveFacts: vi.fn().mockRejectedValue(new Error('db down')),
        findReservedActiveFacts: vi.fn().mockRejectedValue(new Error('db down')),
      });
      const retriever = new FactRetriever(factStore);

      expect(await retriever.retrieveFacts('q', 'pers-1', 'persona-1')).toEqual([]);
    });

    it('caps the reserved-slot count at the given limit when it is below RESERVED_FACT_SLOTS', async () => {
      const { factStore, findReservedActiveFacts } = makeFactStore();
      const retriever = new FactRetriever(factStore);

      await retriever.retrieveFacts('q', 'pers-1', 'persona-1', 2);

      expect(findReservedActiveFacts).toHaveBeenCalledWith('pers-1', 'persona-1', 2);
    });

    it('sets reserved:true only on reserved rows, not on similarity-only rows', async () => {
      const reservedFact: SimilarFact = {
        id: 'reserved-2',
        statement: 'a reserved fact',
        entityTags: [],
        similarity: 0,
        isLocked: true,
        tier: 'observed',
      };
      const { factStore } = makeFactStore({
        findSimilarActiveFacts: vi.fn().mockResolvedValue(makeFacts('user likes tea')),
        findReservedActiveFacts: vi.fn().mockResolvedValue([reservedFact]),
      });
      const retriever = new FactRetriever(factStore);

      const facts = await retriever.retrieveFacts('q', 'pers-1', 'persona-1');

      const reserved = facts.find(f => f.id === 'reserved-2');
      const similarityOnly = facts.find(f => f.id === 'fact-0');
      expect(reserved?.reserved).toBe(true);
      expect(similarityOnly?.reserved).toBeUndefined();
    });
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
