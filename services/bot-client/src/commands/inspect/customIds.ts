/**
 * Custom ID builders and parsers for inspect interactive components
 *
 * Custom ID scheme:
 *   Buttons:     inspect::btn::{requestId}::{viewType}
 *   Select menu: inspect::select::{requestId}
 */

import { DebugViewType } from './types.js';

const PREFIX = 'inspect';
const DELIMITER = '::';

/** Build a button custom ID for a specific view */
function button(requestId: string, viewType: DebugViewType): string {
  return [PREFIX, 'btn', requestId, viewType].join(DELIMITER);
}

/** Build a select menu custom ID */
function selectMenu(requestId: string): string {
  return [PREFIX, 'select', requestId].join(DELIMITER);
}

/** Parse a button custom ID. Returns null if not an inspect button. */
function parseButton(customId: string): { requestId: string; viewType: DebugViewType } | null {
  const parts = customId.split(DELIMITER);
  if (parts.length !== 4 || parts[0] !== PREFIX || parts[1] !== 'btn') {
    return null;
  }
  const viewType = parts[3] as DebugViewType;
  if (!Object.values(DebugViewType).includes(viewType)) {
    return null;
  }
  return { requestId: parts[2], viewType };
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
  selectMenu,
  parseButton,
  parseSelectMenu,
  isInspect,
} as const;
