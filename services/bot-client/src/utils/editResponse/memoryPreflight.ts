/**
 * Preflight for Edit Response: the user-facing refusal for an edit whose
 * exchange memory cannot follow it. Checked before any Discord mutation, so a
 * refused edit leaves Discord, history and memory all untouched.
 */

import type { z } from 'zod';
import type { EditableMessageResponseSchema } from '@tzurot/common-types/schemas/api/history';
import {
  ASSISTANT_SEPARATOR_DISPLAY,
  replyFitsExchangeTemplate,
} from '@tzurot/common-types/utils/memoryReplyRewrite';

export type MemorySyncState = z.infer<typeof EditableMessageResponseSchema>['memorySync'];

export const MEMORY_LOCKED_MESSAGE = "This reply's memory is locked. Unlock it in /memory to edit.";
export const MEMORY_UNSAFE_MESSAGE =
  "This reply's memory can't be updated safely, so it can't be edited.";
export const REPLY_BREAKS_MEMORY_MESSAGE = `That edit can't be saved to the character's memory. Remove "${ASSISTANT_SEPARATOR_DISPLAY}" and try again.`;

/**
 * The refusal message, or null when the edit may proceed.
 *
 * @param newText the submitted reply; omit at modal open, when only the stored
 * state is known. A reply that would break the memory template is only a
 * problem when there is a memory (or pending memory) to rewrite.
 */
export function memoryPreflightMessage(
  memorySync: MemorySyncState,
  newText?: string
): string | null {
  if (memorySync.kind === 'blocked') {
    return memorySync.reason === 'locked' ? MEMORY_LOCKED_MESSAGE : MEMORY_UNSAFE_MESSAGE;
  }
  if (memorySync.kind === 'sync' && newText !== undefined && !replyFitsExchangeTemplate(newText)) {
    return REPLY_BREAKS_MEMORY_MESSAGE;
  }
  return null;
}
