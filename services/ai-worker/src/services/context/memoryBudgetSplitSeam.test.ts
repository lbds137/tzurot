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

  it('MEM-ARCH-012: counts a summarized note at its two-line body size, not at pageContent', () => {
    const doc: MemoryDocument = {
      pageContent:
        '{user}: hi there, how is it going today?\n{assistant}: ' +
        'a very long assistant reply that would inflate the verbatim size by a lot if counted ' +
        'if the summarized note were sized against pageContent instead of its own rendered body',
      metadata: {
        id: 'mem-1',
        userTurn: 'hi there, how is it going today?',
        subjectName: 'Alice',
        personalityName: 'Nova',
        archiveRender: {
          mode: 'split',
          linkedFacts: [],
          assistantSummary: 'A short neutral summary of the exchange.',
        },
      },
    };

    const manager = new MemoryBudgetManager();
    const result = manager.selectMemoriesWithinBudget([doc], 5000);

    expect(result.selectedMemories).toHaveLength(1);

    const splitRendered = formatSingleMemory(doc);
    const verbatimIfMisrendered = `<historical_note>${doc.pageContent}</historical_note>`;
    const wrapperOverhead = countTextTokens(getMemoryWrapperOverheadText('split'));

    expect(result.tokensUsed).toBe(countTextTokens(splitRendered) + wrapperOverhead);
    expect(countTextTokens(splitRendered)).toBeLessThan(countTextTokens(verbatimIfMisrendered));
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

  // @spec MEM-ARCH-031 — the wrapper is sized with the foreign sentence when a turn carries a foreign note
  it('MEM-ARCH-031: sizes the wrapper with the foreign sentence when a turn carries a foreign note', () => {
    const ownDoc: MemoryDocument = {
      pageContent: '{user}: hi\n{assistant}: hello',
      metadata: {
        id: 'mem-own',
        userTurn: 'hi',
        subjectName: 'Alice',
        archiveRender: { mode: 'split', linkedFacts: [] },
      },
    };
    const foreignDoc: MemoryDocument = {
      pageContent: '{user}: bye\n{assistant}: goodbye',
      metadata: {
        id: 'mem-foreign',
        userTurn: 'bye',
        subjectName: 'Alice',
        personalityName: 'Emily',
        archiveRender: { mode: 'split', linkedFacts: [], foreign: true },
      },
    };

    const manager = new MemoryBudgetManager();
    const result = manager.selectMemoriesWithinBudget([ownDoc, foreignDoc], 5000);

    expect(result.selectedMemories).toHaveLength(2);

    const renderedTotal =
      countTextTokens(formatSingleMemory(ownDoc)) + countTextTokens(formatSingleMemory(foreignDoc));
    const wrapperOverheadWithForeign = countTextTokens(
      getMemoryWrapperOverheadText('split', { foreign: true })
    );
    const wrapperOverheadWithoutForeign = countTextTokens(getMemoryWrapperOverheadText('split'));

    // The foreign sentence makes the accounted-for wrapper strictly bigger —
    // proving the budget sizes the LONGER form, not the plain split wrapper.
    expect(wrapperOverheadWithForeign).toBeGreaterThan(wrapperOverheadWithoutForeign);
    expect(result.tokensUsed).toBe(renderedTotal + wrapperOverheadWithForeign);
  });

  // @spec MEM-ARCH-031 — an unrenderable foreign candidate consumes no budget and never appears in selectedMemories
  it('MEM-ARCH-031: excludes an unrenderable foreign candidate from selection and sizes the wrapper without the foreign sentence', () => {
    const ownDoc: MemoryDocument = {
      pageContent: '{user}: hi\n{assistant}: hello',
      metadata: {
        id: 'mem-own',
        userTurn: 'hi',
        subjectName: 'Alice',
        archiveRender: { mode: 'split', linkedFacts: [] },
      },
    };
    const foreignLegacyDoc: MemoryDocument = {
      pageContent: 'SENTINEL_OTHER_CHARACTER_REPLY_7731',
      metadata: {
        id: 'mem-foreign-legacy',
        personalityName: 'Emily',
        archiveRender: { mode: 'split', foreign: true, linkedFacts: [] },
      },
    };

    const manager = new MemoryBudgetManager();
    const result = manager.selectMemoriesWithinBudget([ownDoc, foreignLegacyDoc], 5000);

    expect(result.selectedMemories).toHaveLength(1);
    expect(result.selectedMemories).not.toContain(foreignLegacyDoc);

    const wrapperOverhead = countTextTokens(getMemoryWrapperOverheadText('split'));
    expect(result.tokensUsed).toBe(countTextTokens(formatSingleMemory(ownDoc)) + wrapperOverhead);
  });

  // @spec MEM-ARCH-031 — a turn whose only candidate is unrenderable selects nothing and charges no wrapper
  it('MEM-ARCH-031: a turn whose only candidate is an unrenderable foreign note selects nothing and charges no wrapper', () => {
    const foreignLegacyDoc: MemoryDocument = {
      pageContent: 'SENTINEL_OTHER_CHARACTER_REPLY_ONLY',
      metadata: {
        id: 'mem-foreign-legacy-only',
        personalityName: 'Emily',
        archiveRender: { mode: 'split', foreign: true, linkedFacts: [] },
      },
    };

    const manager = new MemoryBudgetManager();
    const result = manager.selectMemoriesWithinBudget([foreignLegacyDoc], 5000);

    expect(result.selectedMemories).toEqual([]);
    expect(result.tokensUsed).toBe(0);
    expect(result.memoriesDropped).toBe(1);
  });
});
