// Stateful filter / sort / Top-N controls for the /inspect Memory Inspector view.
// State is encoded into button customIds so it survives bot restarts and
// multi-replica deployments (per .claude/rules/04-discord.md).

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { DiagnosticMemoryEntry } from '@tzurot/common-types';
import { DebugViewType } from './types.js';
import { INSPECT_PREFIX as PREFIX, INSPECT_DELIMITER as DELIMITER } from './constants.js';

export const MEMORY_FILTERS = ['all', 'included', 'dropped'] as const;
export type MemoryFilter = (typeof MEMORY_FILTERS)[number];

export const TOP_N_VALUES = [0, 5, 10, 20] as const;
export type TopN = (typeof TOP_N_VALUES)[number];

/** Sort modes mapped to their short-form wire tokens (kept under Discord's 100-char customId limit). */
export const SORT_WIRE = {
  'score-desc': 'sd',
  'score-asc': 'sa',
  'included-first': 'if',
} as const;

export type SortMode = keyof typeof SORT_WIRE;
export const SORT_MODES: readonly SortMode[] = Object.keys(SORT_WIRE) as SortMode[];

/** Reverse map: short wire token → full SortMode. The `| undefined` in the cast
 *  is intentional — it forces parseButton to null-check on unknown tokens; the
 *  map itself only stores the three valid SortMode values. */
export const SORT_FROM_WIRE = Object.fromEntries(
  Object.entries(SORT_WIRE).map(([k, v]) => [v, k])
) as Record<string, SortMode | undefined>;

export interface MemoryInspectorState {
  filter: MemoryFilter;
  topN: TopN;
  sort: SortMode;
}

export const DEFAULT_MEMORY_STATE: MemoryInspectorState = {
  filter: 'all',
  topN: 0,
  sort: 'score-desc',
};

export function applyMemoryFilter(
  memories: readonly DiagnosticMemoryEntry[],
  filter: MemoryFilter
): DiagnosticMemoryEntry[] {
  if (filter === 'included') {
    return memories.filter(m => m.includedInPrompt);
  }
  if (filter === 'dropped') {
    return memories.filter(m => !m.includedInPrompt);
  }
  return [...memories];
}

export function applySort(
  memories: readonly DiagnosticMemoryEntry[],
  sort: SortMode
): DiagnosticMemoryEntry[] {
  if (sort === 'score-asc') {
    return [...memories].sort((a, b) => a.score - b.score);
  }
  if (sort === 'included-first') {
    const included = memories.filter(m => m.includedInPrompt).sort((a, b) => b.score - a.score);
    const dropped = memories.filter(m => !m.includedInPrompt).sort((a, b) => b.score - a.score);
    return [...included, ...dropped];
  }
  // score-desc: explicit fallthrough. If a new SortMode is added to SORT_WIRE
  // without a corresponding branch here, TypeScript prevents the silent regression
  // because `sort` is a `SortMode` union — an unhandled variant produces a type
  // error at the parse boundary.
  return [...memories].sort((a, b) => b.score - a.score);
}

export function applyTopN(
  memories: readonly DiagnosticMemoryEntry[],
  topN: TopN
): DiagnosticMemoryEntry[] {
  if (topN === 0) {
    return [...memories];
  }
  return memories.slice(0, topN);
}

export function nextTopN(current: TopN): TopN {
  const idx = TOP_N_VALUES.indexOf(current);
  return TOP_N_VALUES[(idx + 1) % TOP_N_VALUES.length];
}

export function nextSort(current: SortMode): SortMode {
  const idx = SORT_MODES.indexOf(current);
  return SORT_MODES[(idx + 1) % SORT_MODES.length];
}

/** Build a memory-inspector button custom ID with filter/topN/sort state encoded.
 *  Defined here (not in customIds.ts) to break the circular import:
 *  customIds.ts → memoryInspectorState.ts → customIds.ts. */
export function memoryButton(
  requestId: string,
  filter: MemoryFilter,
  topN: TopN,
  sort: SortMode
): string {
  return [
    PREFIX,
    'btn',
    requestId,
    DebugViewType.MemoryInspector,
    filter,
    String(topN),
    SORT_WIRE[sort],
  ].join(DELIMITER);
}

const SORT_BUTTON_LABEL: Record<SortMode, string> = {
  'score-desc': '↓ Score',
  'score-asc': '↑ Score',
  'included-first': 'Included ⊳',
};

export function buildMemoryFilterButtons(
  requestId: string,
  state: MemoryInspectorState
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const filterButton = (label: string, emoji: string, target: MemoryFilter): ButtonBuilder =>
    new ButtonBuilder()
      .setCustomId(memoryButton(requestId, target, state.topN, state.sort))
      .setLabel(label)
      .setEmoji(emoji)
      .setStyle(state.filter === target ? ButtonStyle.Primary : ButtonStyle.Secondary);

  const topNLabel = state.topN === 0 ? 'Top N' : `Top ${state.topN}`;
  const topNButton = new ButtonBuilder()
    .setCustomId(memoryButton(requestId, state.filter, nextTopN(state.topN), state.sort))
    .setLabel(topNLabel)
    .setEmoji('🔢')
    .setStyle(state.topN === 0 ? ButtonStyle.Secondary : ButtonStyle.Primary);

  const sortButton = new ButtonBuilder()
    .setCustomId(memoryButton(requestId, state.filter, state.topN, nextSort(state.sort)))
    .setLabel(SORT_BUTTON_LABEL[state.sort])
    .setEmoji('↕️')
    .setStyle(state.sort === 'score-desc' ? ButtonStyle.Secondary : ButtonStyle.Primary);

  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    filterButton('All', '📚', 'all'),
    filterButton('Included', '✅', 'included'),
    filterButton('Dropped', '🗑️', 'dropped'),
    topNButton,
    sortButton
  );
}
