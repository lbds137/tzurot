/**
 * Shared memory detail action router.
 *
 * Routes memory action button presses (edit, lock, delete, view-full, back)
 * to their respective handlers. Used by both browse and search collectors
 * to avoid duplicating the same 8-case switch statement.
 */

import type { ButtonInteraction } from 'discord.js';
import {
  parseMemoryActionId,
  handleLockButton,
  handleDeleteButton,
  handleDeleteConfirm,
  handleViewFullButton,
} from './detail.js';
import {
  handleEditButton,
  handleEditTruncatedButton,
  handleCancelEditButton,
} from './detailModals.js';

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
 * `delete` [shows confirmation dialog], `view-full`) do NOT call
 * `onRefresh`. `interactionHandlers.ts` relies on this invariant to
 * route those actions through `handleBrowseDetailAction` unconditionally
 * (see `SESSION_INDEPENDENT_ACTIONS`) — if you add an `onRefresh` call
 * to any of them, you MUST also remove that action from
 * `SESSION_INDEPENDENT_ACTIONS`, otherwise memories opened from a
 * search result will silently skip the list refresh.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Switch over 8 memory action types with per-action validation and API calls
export async function handleMemoryDetailAction(
  buttonInteraction: ButtonInteraction,
  onRefresh: () => Promise<void>
): Promise<boolean> {
  const parsed = parseMemoryActionId(buttonInteraction.customId);
  if (parsed === null) {
    return false;
  }

  const { action, memoryId } = parsed;

  switch (action) {
    case 'edit':
      if (memoryId === undefined) {
        return false;
      }
      await handleEditButton(buttonInteraction, memoryId);
      return true;
    case 'edit-truncated':
      if (memoryId === undefined) {
        return false;
      }
      await handleEditTruncatedButton(buttonInteraction, memoryId);
      return true;
    case 'cancel-edit':
      await handleCancelEditButton(buttonInteraction);
      return true;
    case 'lock':
      if (memoryId === undefined) {
        return false;
      }
      await handleLockButton(buttonInteraction, memoryId);
      return true;
    case 'delete':
      if (memoryId === undefined) {
        return false;
      }
      await handleDeleteButton(buttonInteraction, memoryId);
      return true;
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
    case 'view-full':
      if (memoryId === undefined) {
        return false;
      }
      await handleViewFullButton(buttonInteraction, memoryId);
      return true;
    case 'back':
      await buttonInteraction.deferUpdate();
      await onRefresh();
      return true;
    default:
      return false;
  }
}
