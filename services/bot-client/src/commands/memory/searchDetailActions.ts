/**
 * Search detail action button handlers.
 *
 * Delegates to the shared detail action router with a search-specific
 * refresh callback.
 */

import type { ButtonInteraction } from 'discord.js';
import { handleMemoryDetailAction } from './detailActionRouter.js';

/**
 * Handle detail action buttons within the search collector.
 * Returns true if the button was handled, false if not recognized.
 */
export async function handleSearchDetailAction(
  buttonInteraction: ButtonInteraction,
  refreshSearch: () => Promise<void>
): Promise<boolean> {
  return handleMemoryDetailAction(buttonInteraction, refreshSearch);
}
