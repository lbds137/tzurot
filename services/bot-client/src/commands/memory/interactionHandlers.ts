/**
 * Memory Command - Interaction Handlers
 *
 * Router-pattern handlers for button, modal, and select menu interactions.
 * Routes to:
 * - Memory browse pagination (browse.ts)
 * - Memory search pagination (search.ts)
 * - Memory detail actions (detail.ts via detailActionRouter.ts)
 *
 * All state lives in dashboard sessions (keyed by messageId) or in the
 * custom IDs themselves — no inline collectors, fully restart-safe.
 */

import { MessageFlags } from 'discord.js';
import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { parseMemoryActionId, handleMemorySelect } from './detail.js';
import { handleEditModalSubmit } from './detailModals.js';
import { findMemoryListSessionByMessage } from './browseSession.js';
import {
  browseHelpers,
  handleBrowsePagination,
  handleBrowseSelect,
  handleBrowseDetailAction,
  isMemoryBrowsePagination,
} from './browse.js';
import {
  searchHelpers,
  handleSearchPagination,
  handleSearchSelect,
  handleSearchDetailAction,
  isMemorySearchPagination,
} from './search.js';

const logger = createLogger('memory-command');

/**
 * Detail actions that operate on a single memory without needing to know
 * which list (browse vs search) the detail view was opened from. These can
 * work even if the list session has expired, because the memory ID is encoded
 * in the button's custom ID and the action doesn't refresh the list view.
 */
const SESSION_INDEPENDENT_ACTIONS = new Set([
  'edit',
  'edit-truncated',
  'cancel-edit',
  'lock',
  'view-full',
  // 'delete' only shows the confirmation dialog; no list refresh needed.
  // 'confirm-delete' and 'back' DO call onRefresh — those are session-dependent.
  'delete',
]);

/**
 * Handle button interactions for memory commands.
 * Routes pagination to browse/search handlers, detail actions to the
 * detail action router (which calls back to refresh the list view).
 */
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const { customId } = interaction;

  // Browse pagination button (memory-browse::browse::...)
  if (isMemoryBrowsePagination(customId)) {
    await handleBrowsePagination(interaction);
    return;
  }

  // Search pagination button (memory-search::browse::...)
  if (isMemorySearchPagination(customId)) {
    await handleSearchPagination(interaction);
    return;
  }

  // Detail action buttons (memory-detail::...)
  const parsed = parseMemoryActionId(customId);
  if (parsed === null) {
    logger.debug({ customId }, 'Unknown button customId');
    await interaction.reply({
      content: '❌ Unknown interaction.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Session-independent actions (edit, lock, view-full, etc.) only need the
  // memoryId from the custom ID — they don't care which list the detail view
  // was opened from. Route them directly via handleBrowseDetailAction which
  // delegates to handleMemoryDetailAction for the action dispatch.
  // Note: the onRefresh callback is only invoked for 'back' and 'confirm-delete',
  // which ARE session-dependent — those fall through to the kind-based routing below.
  //
  // Failure mode to watch: if any action in SESSION_INDEPENDENT_ACTIONS ever
  // starts calling onRefresh, memories opened from a search result will
  // silently skip the list refresh — refreshBrowseList bails when the
  // session kind is 'search'. The fix in that case is to move the newly
  // refreshing action out of SESSION_INDEPENDENT_ACTIONS so it falls through
  // to the kind-based dispatch below.
  if (SESSION_INDEPENDENT_ACTIONS.has(parsed.action)) {
    await handleBrowseDetailAction(interaction);
    return;
  }

  // Session-dependent actions (back, confirm-delete) need to know which list
  // to refresh after the action completes. Look up the session to find out.
  //
  // Ack-first rule compliance (.claude/rules/04-discord.md): the session
  // lookup is async, so we must deferUpdate BEFORE it to stay inside the
  // 3-second interaction window. The downstream 'back' and confirm-delete
  // handlers in detailActionRouter / detail.ts tolerate an already-deferred
  // interaction (they guard with !interaction.deferred), so this early
  // defer doesn't double-ack. After the defer, the expired-session path
  // must use followUp instead of reply.
  await interaction.deferUpdate();

  const session = await findMemoryListSessionByMessage(interaction.message.id);
  if (session === null) {
    await interaction.followUp({
      content: '⏰ This interaction has expired. Please run the command again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const handled =
    session.data.kind === 'browse'
      ? await handleBrowseDetailAction(interaction)
      : await handleSearchDetailAction(interaction);

  if (!handled) {
    logger.warn({ customId }, 'Unhandled detail action');
    // Interaction is already deferred at this point, so use followUp.
    await interaction.followUp({
      content: '❌ Unknown action.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handle modal submit interactions for memory editing.
 *
 * Every path must acknowledge the interaction (reply or defer) — unacknowledged
 * modal submits surface as "This interaction failed" in Discord, which is worse
 * than a clean error message.
 */
export async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parsed = parseMemoryActionId(interaction.customId);

  if (parsed?.action !== 'edit') {
    logger.warn({ customId: interaction.customId }, 'Unknown modal');
    await interaction.reply({
      content: '❌ Unknown modal submission.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (parsed.memoryId === undefined) {
    logger.warn({ customId: interaction.customId }, 'Edit modal missing memoryId');
    await interaction.reply({
      content: '❌ Malformed edit modal (missing memory ID).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await handleEditModalSubmit(interaction, parsed.memoryId);
}

/**
 * Handle select menu interactions for memory commands.
 * Routes to browse or search select handlers based on the custom ID prefix.
 */
export async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const { customId } = interaction;

  // Browse select (memory-browse::browse-select::...)
  if (browseHelpers.isBrowseSelect(customId)) {
    await handleBrowseSelect(interaction);
    return;
  }

  // Search select (memory-search::browse-select::...)
  if (searchHelpers.isBrowseSelect(customId)) {
    await handleSearchSelect(interaction);
    return;
  }

  // memory-detail::select — used by buildMemorySelectMenu for both browse
  // and search result lists. Route directly to handleMemorySelect without
  // a session lookup: both origins open the same detail view, and the
  // detail view's "back" button looks up the original list via the
  // messageId-keyed session when it's clicked (see refreshBrowseList /
  // refreshSearchList in detailActionRouter). No up-front session kind
  // disambiguation is needed here.
  const parsed = parseMemoryActionId(customId);
  if (parsed?.action === 'select') {
    await handleMemorySelect(interaction);
    return;
  }

  logger.debug({ customId }, 'Unknown select menu customId');
  // The session may still be valid; the customId itself isn't recognized.
  // Show "Unknown interaction" rather than "expired" so the user doesn't
  // chase the wrong cause (e.g., re-running the command needlessly).
  await interaction.reply({
    content: '❌ Unknown interaction.',
    flags: MessageFlags.Ephemeral,
  });
}
