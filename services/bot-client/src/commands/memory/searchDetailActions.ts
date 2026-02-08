/**
 * Search detail action button handlers.
 *
 * Handles memory action buttons (edit, lock, delete, view-full, back)
 * within the search results collector.
 */

import type { ButtonInteraction } from 'discord.js';
import {
  parseMemoryActionId,
  handleEditButton,
  handleEditTruncatedButton,
  handleCancelEditButton,
  handleLockButton,
  handleDeleteButton,
  handleDeleteConfirm,
  handleViewFullButton,
} from './detail.js';

/**
 * Handle detail action buttons within the search collector.
 * Returns true if the button was handled, false if not recognized.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- pre-existing; flat switch over action types
export async function handleSearchDetailAction(
  buttonInteraction: ButtonInteraction,
  refreshSearch: () => Promise<void>
): Promise<boolean> {
  const parsed = parseMemoryActionId(buttonInteraction.customId);
  if (parsed === null) {
    return false;
  }

  const { action, memoryId } = parsed;

  switch (action) {
    case 'edit':
      if (memoryId !== undefined) {
        await handleEditButton(buttonInteraction, memoryId);
      }
      return true;
    case 'edit-truncated':
      if (memoryId !== undefined) {
        await handleEditTruncatedButton(buttonInteraction, memoryId);
      }
      return true;
    case 'cancel-edit':
      await handleCancelEditButton(buttonInteraction);
      return true;
    case 'lock':
      if (memoryId !== undefined) {
        await handleLockButton(buttonInteraction, memoryId);
      }
      return true;
    case 'delete':
      if (memoryId !== undefined) {
        await handleDeleteButton(buttonInteraction, memoryId);
      }
      return true;
    case 'confirm-delete':
      if (memoryId !== undefined) {
        const success = await handleDeleteConfirm(buttonInteraction, memoryId);
        if (success) {
          await refreshSearch();
        }
      }
      return true;
    case 'view-full':
      if (memoryId !== undefined) {
        await handleViewFullButton(buttonInteraction, memoryId);
      }
      return true;
    case 'back':
      await buttonInteraction.deferUpdate();
      await refreshSearch();
      return true;
    default:
      return false;
  }
}
