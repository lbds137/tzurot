/**
 * Custom ID builders and parsers for inspect interactive components
 *
 * Custom ID scheme:
 *   Buttons (legacy):       inspect::btn::{requestId}::{viewType}
 *   Buttons (memory state): inspect::btn::{requestId}::memory-inspector::{filter}::{topN}::{sortWire}
 *   Select menu:            inspect::select::{requestId}
 */

import { DebugViewType } from './types.js';
import { INSPECT_PREFIX as PREFIX, INSPECT_DELIMITER as DELIMITER } from './constants.js';
import {
  MEMORY_FILTERS,
  TOP_N_VALUES,
  SORT_FROM_WIRE,
  memoryButton,
  type MemoryFilter,
  type TopN,
  type MemoryInspectorState,
} from './memoryInspectorState.js';

/** Build a button custom ID for a specific view (no state). */
function button(requestId: string, viewType: DebugViewType): string {
  return [PREFIX, 'btn', requestId, viewType].join(DELIMITER);
}

/** Build a select menu custom ID */
function selectMenu(requestId: string): string {
  return [PREFIX, 'select', requestId].join(DELIMITER);
}

/**
 * Parse a button custom ID. Returns null if not an inspect button.
 *
 * Accepts two shapes:
 *   - 4 segments (legacy / non-memory views): `inspect::btn::{req}::{viewType}`
 *   - 7 segments (memory-inspector with state): adds `::{filter}::{topN}::{sortWire}`
 *
 * Memory-inspector legacy buttons (4 segments) parse with `memoryState: undefined`;
 * dispatch supplies the default state.
 */
function parseButton(
  customId: string
): { requestId: string; viewType: DebugViewType; memoryState?: MemoryInspectorState } | null {
  const parts = customId.split(DELIMITER);
  if (parts.length !== 4 && parts.length !== 7) {
    return null;
  }
  if (parts[0] !== PREFIX || parts[1] !== 'btn') {
    return null;
  }
  const viewType = parts[3] as DebugViewType;
  if (!Object.values(DebugViewType).includes(viewType)) {
    return null;
  }

  if (parts.length === 4) {
    return { requestId: parts[2], viewType };
  }

  // 7-segment form is only valid for memory-inspector
  if (viewType !== DebugViewType.MemoryInspector) {
    return null;
  }

  const filterRaw = parts[4];
  const topNRaw = Number(parts[5]);
  const sortRaw = parts[6];

  if (!(MEMORY_FILTERS as readonly string[]).includes(filterRaw)) {
    return null;
  }
  if (!Number.isInteger(topNRaw) || !(TOP_N_VALUES as readonly number[]).includes(topNRaw)) {
    return null;
  }
  // SORT_FROM_WIRE is the inverse of SORT_WIRE, so any defined value is
  // by construction a valid SortMode — the undefined check is sufficient.
  const sort = SORT_FROM_WIRE[sortRaw];
  if (sort === undefined) {
    return null;
  }

  return {
    requestId: parts[2],
    viewType,
    memoryState: {
      filter: filterRaw as MemoryFilter,
      topN: topNRaw as TopN,
      sort,
    },
  };
}

/** Parse a select menu custom ID. Returns null if not an inspect select. */
function parseSelectMenu(customId: string): { requestId: string } | null {
  const parts = customId.split(DELIMITER);
  if (parts.length !== 3 || parts[0] !== PREFIX || parts[1] !== 'select') {
    return null;
  }
  return { requestId: parts[2] };
}

/** Check if a custom ID belongs to the inspect module */
function isInspect(customId: string): boolean {
  return customId.startsWith(PREFIX + DELIMITER);
}

export const InspectCustomIds = {
  PREFIX,
  button,
  memoryButton,
  selectMenu,
  parseButton,
  parseSelectMenu,
  isInspect,
} as const;
