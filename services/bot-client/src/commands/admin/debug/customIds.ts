/**
 * Custom ID builders and parsers for debug interactive components
 *
 * Custom ID scheme:
 *   Buttons:     admin-debug::btn::{requestId}::{viewType}
 *   Select menu: admin-debug::select::{requestId}
 */

import { DebugViewType } from './types.js';

const PREFIX = 'admin-debug';
const DELIMITER = '::';

/** Build a button custom ID for a specific view */
function button(requestId: string, viewType: DebugViewType): string {
  return [PREFIX, 'btn', requestId, viewType].join(DELIMITER);
}

/** Build a select menu custom ID */
function selectMenu(requestId: string): string {
  return [PREFIX, 'select', requestId].join(DELIMITER);
}

/** Parse a button custom ID. Returns null if not a debug button. */
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

/** Parse a select menu custom ID. Returns null if not a debug select. */
function parseSelectMenu(customId: string): { requestId: string } | null {
  const parts = customId.split(DELIMITER);
  if (parts.length !== 3 || parts[0] !== PREFIX || parts[1] !== 'select') {
    return null;
  }
  return { requestId: parts[2] };
}

/** Check if a custom ID belongs to the debug module */
function isDebug(customId: string): boolean {
  return customId.startsWith(PREFIX + DELIMITER);
}

export const DebugCustomIds = {
  PREFIX,
  button,
  selectMenu,
  parseButton,
  parseSelectMenu,
  isDebug,
} as const;
