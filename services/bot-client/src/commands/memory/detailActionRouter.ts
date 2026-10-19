/**
 * Shared memory detail action router.
 *
 * Routes the nine memory detail actions (edit, edit-truncated, delete,
 * view-full, reasoning through the MEMORY_ID_ACTIONS table; cancel-edit, lock,
 * confirm-delete, back through the switch) to their respective handlers, and
 * is shared by the browse and search handlers so they don't duplicate the
 * dispatch.
 */

import type { ButtonInteraction } from 'discord.js';
import {
  parseMemoryActionId,
  handleLockButton,
  handleDeleteButton,
  handleDeleteConfirm,
  handleViewFullButton,
  handleReasoningButton,
} from './detail.js';
import {
  handleEditButton,
  handleEditTruncatedButton,
  handleCancelEditButton,
} from './detailModals.js';
import { ackUpdate } from '../../ux/render/reply.js';

/**
 * Decode the `extra` segment carried by a `lock` action's customId into the
 * desired final lock state. Returns null when the segment is missing or
 * doesn't match `'0' | '1'` (e.g., legacy customId from before the
 * idempotent-lock migration).
 */
function parseLockExtra(extra: string | undefined): boolean | null {
  if (extra === '1') {
    return true;
  }
  if (extra === '0') {
    return false;
  }
  return null;
}

/** Actions whose only input is the memory id; the router returns true once one is dispatched */
const MEMORY_ID_ACTIONS: Readonly<
  Record<string, (interaction: ButtonInteraction, memoryId: string) => Promise<unknown>>
> = {
  edit: handleEditButton,
  'edit-truncated': handleEditTruncatedButton,
  delete: handleDeleteButton,
  'view-full': handleViewFullButton,
  reasoning: handleReasoningButton,
};

/**
 * Handle memory detail action buttons.
 * Returns true if the button was handled, false if not recognized.
 *
 * @param buttonInteraction - The button interaction to handle
 * @param onRefresh - Callback to refresh the parent list/search view.
 *
 * **onRefresh contract (load-bearing for interactionHandlers.ts routing):**
 *
 * Exactly two actions invoke `onRefresh`:
 * - `'confirm-delete'` — only on successful deletion (not on failure/cancel)
 * - `'back'` — always, after deferUpdate
 *
 * All other actions (`edit`, `edit-truncated`, `cancel-edit`, `lock`,
 * `delete` [shows confirmation dialog], `view-full`, `reasoning`) do NOT call
 * `onRefresh`. `interactionHandlers.ts` relies on this invariant to
 * route those actions through `handleBrowseDetailAction` unconditionally
 * (see `SESSION_INDEPENDENT_ACTIONS`) — if you add an `onRefresh` call
 * to any of them, you MUST also remove that action from
 * `SESSION_INDEPENDENT_ACTIONS`, otherwise memories opened from a
 * search result will silently skip the list refresh.
 */
export async function handleMemoryDetailAction(
  buttonInteraction: ButtonInteraction,
  onRefresh: () => Promise<void>
): Promise<boolean> {
  const parsed = parseMemoryActionId(buttonInteraction.customId);
  if (parsed === null) {
    return false;
  }

  const { action, memoryId, extra } = parsed;

  const memoryIdHandler = Object.hasOwn(MEMORY_ID_ACTIONS, action)
    ? MEMORY_ID_ACTIONS[action]
    : undefined;
  if (memoryIdHandler !== undefined) {
    if (memoryId === undefined) {
      return false;
    }
    await memoryIdHandler(buttonInteraction, memoryId);
    return true;
  }

  switch (action) {
    case 'cancel-edit':
      await handleCancelEditButton(buttonInteraction);
      return true;
    case 'lock': {
      const desired = parseLockExtra(extra);
      if (memoryId === undefined || desired === null) {
        return false;
      }
      await handleLockButton(buttonInteraction, memoryId, desired);
      return true;
    }
    case 'confirm-delete': {
      if (memoryId === undefined) {
        return false;
      }
      const success = await handleDeleteConfirm(buttonInteraction, memoryId);
      if (success) {
        await onRefresh();
      }
      return true;
    }
    case 'back':
      // The caller (interactionHandlers.handleButton) already defers
      // interactions on the session-dependent path so the session lookup
      // stays inside the 3-second window. Guard against double-ack by
      // only deferring when the interaction is still untouched.
      if (!buttonInteraction.deferred && !buttonInteraction.replied) {
        // eslint-disable-next-line @tzurot/component-handler-ack-first -- Branch-leak FP: this ackUpdate IS ack-first for the `back` case (double-ack-guarded; the caller may have pre-deferred). The rule's source-order sawRealAsync leaked from the `confirm-delete` branch's onRefresh above, which returns before this case ever runs.
        await ackUpdate(buttonInteraction);
      }
      await onRefresh();
      return true;
    default:
      return false;
  }
}
