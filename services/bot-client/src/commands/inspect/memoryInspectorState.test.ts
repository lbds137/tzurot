import { describe, it, expect } from 'vitest';
import { ButtonStyle, type APIButtonComponentWithCustomId } from 'discord.js';
import type { DiagnosticMemoryEntry } from '@tzurot/common-types';
import {
  applyMemoryFilter,
  applySort,
  applyTopN,
  nextTopN,
  nextSort,
  buildMemoryFilterButtons,
  DEFAULT_MEMORY_STATE,
  type MemoryInspectorState,
} from './memoryInspectorState.js';

function mem(id: string, score: number, includedInPrompt: boolean): DiagnosticMemoryEntry {
  return { id, score, preview: `preview-${id}`, includedInPrompt };
}

const SAMPLE: DiagnosticMemoryEntry[] = [
  mem('a', 0.9, true),
  mem('b', 0.7, false),
  mem('c', 0.5, true),
  mem('d', 0.3, false),
  mem('e', 0.1, true),
];

describe('applyMemoryFilter', () => {
  it('all returns every memory', () => {
    expect(applyMemoryFilter(SAMPLE, 'all')).toHaveLength(5);
  });
  it('included returns only included rows', () => {
    const result = applyMemoryFilter(SAMPLE, 'included');
    expect(result.map(m => m.id)).toEqual(['a', 'c', 'e']);
  });
  it('dropped returns only dropped rows', () => {
    const result = applyMemoryFilter(SAMPLE, 'dropped');
    expect(result.map(m => m.id)).toEqual(['b', 'd']);
  });
});

describe('applySort', () => {
  it('score-desc sorts highest first', () => {
    const result = applySort(SAMPLE, 'score-desc');
    expect(result.map(m => m.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('score-asc sorts lowest first', () => {
    const result = applySort(SAMPLE, 'score-asc');
    expect(result.map(m => m.id)).toEqual(['e', 'd', 'c', 'b', 'a']);
  });
  it('included-first groups included rows above dropped, score-desc within each', () => {
    const result = applySort(SAMPLE, 'included-first');
    expect(result.map(m => m.id)).toEqual(['a', 'c', 'e', 'b', 'd']);
  });
});

describe('applyTopN', () => {
  it('topN=0 returns all', () => {
    expect(applyTopN(SAMPLE, 0)).toHaveLength(5);
  });
  it('topN=5 returns up to 5 rows (all when total <= 5)', () => {
    expect(applyTopN(SAMPLE, 5).map(m => m.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(applyTopN(SAMPLE.slice(0, 3), 5)).toHaveLength(3); // > total returns all
  });
  it('topN=20 returns all when total < 20', () => {
    expect(applyTopN(SAMPLE, 20)).toHaveLength(5);
  });
});

describe('nextTopN', () => {
  it('cycles 0 → 5 → 10 → 20 → 0', () => {
    expect(nextTopN(0)).toBe(5);
    expect(nextTopN(5)).toBe(10);
    expect(nextTopN(10)).toBe(20);
    expect(nextTopN(20)).toBe(0);
  });
});

describe('nextSort', () => {
  it('cycles score-desc → score-asc → included-first → score-desc', () => {
    expect(nextSort('score-desc')).toBe('score-asc');
    expect(nextSort('score-asc')).toBe('included-first');
    expect(nextSort('included-first')).toBe('score-desc');
  });
});

describe('buildMemoryFilterButtons', () => {
  const state: MemoryInspectorState = DEFAULT_MEMORY_STATE;

  it('returns one ActionRow with 5 buttons', () => {
    const row = buildMemoryFilterButtons('req-1', state);
    expect(row.components).toHaveLength(5);
  });

  it('marks the active filter button as Primary, others as Secondary', () => {
    const row = buildMemoryFilterButtons('req-1', { ...state, filter: 'included' });
    const buttons = row.components.map(b => b.toJSON() as APIButtonComponentWithCustomId);
    expect(buttons[0].style).toBe(ButtonStyle.Secondary); // All
    expect(buttons[1].style).toBe(ButtonStyle.Primary); // Included
    expect(buttons[2].style).toBe(ButtonStyle.Secondary); // Dropped
  });

  it('Top-N button is Secondary when topN=0, Primary otherwise', () => {
    const noLimit = buildMemoryFilterButtons('req-1', { ...state, topN: 0 });
    const withLimit = buildMemoryFilterButtons('req-1', { ...state, topN: 10 });
    expect((noLimit.components[3].toJSON() as APIButtonComponentWithCustomId).style).toBe(
      ButtonStyle.Secondary
    );
    expect((withLimit.components[3].toJSON() as APIButtonComponentWithCustomId).style).toBe(
      ButtonStyle.Primary
    );
  });

  it('Top-N button label reflects current value', () => {
    const noLimit = buildMemoryFilterButtons('req-1', { ...state, topN: 0 });
    const withLimit = buildMemoryFilterButtons('req-1', { ...state, topN: 5 });
    expect((noLimit.components[3].toJSON() as APIButtonComponentWithCustomId).label).toBe('Top N');
    expect((withLimit.components[3].toJSON() as APIButtonComponentWithCustomId).label).toBe(
      'Top 5'
    );
  });

  it('Sort button is Secondary on default sort, Primary on non-default', () => {
    const sortDesc = buildMemoryFilterButtons('req-1', { ...state, sort: 'score-desc' });
    const sortAsc = buildMemoryFilterButtons('req-1', { ...state, sort: 'score-asc' });
    const includedFirst = buildMemoryFilterButtons('req-1', { ...state, sort: 'included-first' });
    expect((sortDesc.components[4].toJSON() as APIButtonComponentWithCustomId).style).toBe(
      ButtonStyle.Secondary
    );
    expect((sortAsc.components[4].toJSON() as APIButtonComponentWithCustomId).style).toBe(
      ButtonStyle.Primary
    );
    expect((includedFirst.components[4].toJSON() as APIButtonComponentWithCustomId).style).toBe(
      ButtonStyle.Primary
    );
  });

  it('Sort button label reflects current sort mode', () => {
    const sortDesc = buildMemoryFilterButtons('req-1', { ...state, sort: 'score-desc' });
    const sortAsc = buildMemoryFilterButtons('req-1', { ...state, sort: 'score-asc' });
    const includedFirst = buildMemoryFilterButtons('req-1', { ...state, sort: 'included-first' });
    expect((sortDesc.components[4].toJSON() as APIButtonComponentWithCustomId).label).toBe(
      '↓ Score'
    );
    expect((sortAsc.components[4].toJSON() as APIButtonComponentWithCustomId).label).toBe(
      '↑ Score'
    );
    expect((includedFirst.components[4].toJSON() as APIButtonComponentWithCustomId).label).toBe(
      'Included ⊳'
    );
  });
});
