import { describe, it, expect } from 'vitest';
import { dropFactsCoveredByArchive } from './dropFactsCoveredByArchive.js';
import type { FactForPrompt, MemoryDocument } from '../ConversationalRAGTypes.js';

function renderedMemory(
  id: string,
  linkedFacts: { id: string; statement: string; salience: number }[]
): MemoryDocument {
  return { pageContent: '', metadata: { id, archiveRender: { mode: 'split', linkedFacts } } };
}

describe('dropFactsCoveredByArchive', () => {
  // @spec MEM-ARCH-008 — D10 dedup applies in split mode only
  it("MEM-ARCH-008: drops a fact whose id appears in a surviving note's linkedFacts", () => {
    const facts = [{ id: 'f-1', statement: 'Alice likes tea' }];
    const result = dropFactsCoveredByArchive(facts, [
      renderedMemory('mem-1', [{ id: 'f-1', statement: 'Alice likes tea', salience: 0.5 }]),
    ]);
    expect(result).toEqual([]);
  });

  it('keeps a fact whose owning note was budget-dropped even though a sibling source memory survives', () => {
    // The reviewer's scenario: fact f-1 was extracted from both mem-1 and
    // mem-2, but stampArchiveRenderMode attributes it to mem-1 only (the
    // first memory in relevance order). Budget selection then drops mem-1
    // and keeps mem-2 — mem-2's note carries no linked facts, so the old
    // sourceMemoryIds-intersection rule dropped f-1 from <facts> even though
    // it was never actually rendered anywhere.
    const facts = [
      { id: 'f-1', statement: 'Alice likes tea', sourceMemoryIds: ['mem-1', 'mem-2'] },
    ] as unknown as FactForPrompt[];
    const memories: MemoryDocument[] = [renderedMemory('mem-2', [])];
    const result = dropFactsCoveredByArchive(facts, memories);
    expect(result).toEqual(facts);
  });

  it('keeps a fact with no id', () => {
    const facts = [{ statement: 'Alice likes tea' }];
    const result = dropFactsCoveredByArchive(facts, [
      renderedMemory('mem-1', [{ id: 'f-1', statement: 'Alice likes tea', salience: 0.5 }]),
    ]);
    expect(result).toEqual(facts);
  });

  it("keeps a fact whose id is in no rendered note's linkedFacts", () => {
    const facts = [{ id: 'f-2', statement: 'Alice likes tea' }];
    const result = dropFactsCoveredByArchive(facts, [
      renderedMemory('mem-1', [{ id: 'f-1', statement: 'other fact', salience: 0.5 }]),
    ]);
    expect(result).toEqual(facts);
  });

  it('drops only the matching fact out of several', () => {
    const facts = [
      { id: 'f-1', statement: 'covered' },
      { id: 'f-2', statement: 'uncovered' },
    ];
    const result = dropFactsCoveredByArchive(facts, [
      renderedMemory('mem-1', [{ id: 'f-1', statement: 'covered', salience: 0.5 }]),
    ]);
    expect(result.map(f => f.statement)).toEqual(['uncovered']);
  });

  it('handles memories with no archiveRender (verbatim docs contribute no ids)', () => {
    const facts = [{ id: 'f-1', statement: 'x' }];
    const result = dropFactsCoveredByArchive(facts, [
      { pageContent: '', metadata: { id: 'mem-1' } },
    ]);
    expect(result).toEqual(facts);
  });
});
