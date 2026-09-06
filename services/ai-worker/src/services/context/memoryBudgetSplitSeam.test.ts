/**
 * Wiring/seam test (A4): `MemoryBudgetManager.test.ts` mocks `formatSingleMemory`
 * and `getMemoryWrapperOverheadText`, so it cannot see whether the budget
 * actually sizes a split-mode note at its SPLIT rendering size rather than its
 * `pageContent` size. This file runs the REAL formatter chain.
 */

import { describe, it, expect } from 'vitest';
import { MemoryBudgetManager } from './MemoryBudgetManager.js';
import { formatSingleMemory, getMemoryWrapperOverheadText } from '../prompt/MemoryFormatter.js';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import type { MemoryDocument } from '../ConversationalRAGTypes.js';

// @spec MEM-ARCH-012 — the budget sizes split notes at their rendered size
describe('MemoryBudgetManager × real MemoryFormatter — split-mode sizing (A4 wiring seam)', () => {
  it('MEM-ARCH-012: counts a split-mode note at its SPLIT body size, not its verbatim pageContent size', () => {
    const doc: MemoryDocument = {
      pageContent:
        '{user}: hi there, how is it going today?\n{assistant}: ' +
        'a very long assistant reply that would inflate the verbatim size by a lot if counted',
      metadata: {
        id: 'mem-1',
        userTurn: 'hi there, how is it going today?',
        subjectName: 'Alice',
        archiveRender: { mode: 'split', linkedFacts: [] },
      },
    };

    const manager = new MemoryBudgetManager();
    // A generous budget so the memory is definitely selected — the point is
    // the COUNTED size, not whether it survives selection.
    const result = manager.selectMemoriesWithinBudget([doc], 5000);

    expect(result.selectedMemories).toHaveLength(1);

    const splitRendered = formatSingleMemory(doc);
    const verbatimIfMisrendered = `<historical_note>${doc.pageContent}</historical_note>`;
    const splitTokens = countTextTokens(splitRendered);
    const verbatimTokens = countTextTokens(verbatimIfMisrendered);
    const wrapperOverhead = countTextTokens(getMemoryWrapperOverheadText('split'));

    // The assistant's long reply only inflates the verbatim count — proving
    // the two shapes diverge, so an EXACT match against splitTokens (not
    // verbatimTokens, and not merely >=) is a meaningful assertion pinned to
    // the actual rendered shape, not a coincidence of a generous budget.
    expect(splitTokens).toBeLessThan(verbatimTokens);
    expect(result.tokensUsed).toBe(splitTokens + wrapperOverhead);
  });

  it('MEM-ARCH-012: threading `names` through sizing resolves linked-fact placeholders the same way rendering does', () => {
    // A linked fact whose statement carries BOTH placeholders, resolved against
    // names substantially longer than the literal placeholder text — so the
    // resolved render is strictly bigger than the unresolved one, proving the
    // `names` argument is load-bearing for sizing, not merely accepted.
    const doc: MemoryDocument = {
      pageContent: 'irrelevant verbatim fallback text',
      metadata: {
        id: 'mem-2',
        userTurn: 'what did we decide about the trip?',
        subjectName: 'Alice',
        archiveRender: {
          mode: 'split',
          linkedFacts: [
            {
              id: 'f-1',
              statement: '{user} told {assistant} about the upcoming trip plans',
              salience: 0.9,
            },
          ],
        },
      },
    };
    const names = {
      subjectName: 'Alexandria Featherington-Worthington',
      personalityName: 'Persimmon Everblossom the Sagacious',
      discordUsername: 'alexandria_featherington#0001',
    };

    const manager = new MemoryBudgetManager();
    const withNames = manager.selectMemoriesWithinBudget([doc], 5000, undefined, names);
    const withoutNames = manager.selectMemoriesWithinBudget([doc], 5000);

    const wrapperOverhead = countTextTokens(getMemoryWrapperOverheadText('split'));
    expect(withNames.tokensUsed).toBe(
      countTextTokens(formatSingleMemory(doc, undefined, names)) + wrapperOverhead
    );
    // Threading `names` changes the sized total — sizing without it would
    // silently under-count what the render pass actually resolves.
    expect(withNames.tokensUsed).not.toBe(withoutNames.tokensUsed);
  });
});
