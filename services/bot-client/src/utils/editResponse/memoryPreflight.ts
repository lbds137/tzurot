/**
 * Preflight for Edit Response: the user-facing refusal for an edit whose
 * exchange memory cannot follow it. The gateway decides (it plans against the
 * real stored texts); this maps its answer to a message. Checked before any
 * Discord mutation, so a refused edit leaves Discord, history and memory all
 * untouched.
 */

import type { z } from 'zod';
import type { EditableMessageResponseSchema } from '@tzurot/common-types/schemas/api/history';

export type MemorySyncState = z.infer<typeof EditableMessageResponseSchema>['memorySync'];

export const MEMORY_LOCKED_MESSAGE = "This reply's memory is locked. Unlock it in /memory to edit.";
export const MEMORY_UNSAFE_MESSAGE =
  "This reply's memory can't be updated safely, so it can't be edited.";
export const REPLY_BREAKS_MEMORY_MESSAGE =
  'That edit can\'t be saved to the character\'s memory. If it contains "{assistant}:", remove that and try again.';

/** The refusal message, or null when the edit may proceed. */
export function memoryPreflightMessage(memorySync: MemorySyncState): string | null {
  if (memorySync.kind !== 'blocked') {
    return null;
  }
  switch (memorySync.reason) {
    case 'locked':
      return MEMORY_LOCKED_MESSAGE;
    case 'reply-off-template':
      return REPLY_BREAKS_MEMORY_MESSAGE;
    default:
      return MEMORY_UNSAFE_MESSAGE;
  }
}
