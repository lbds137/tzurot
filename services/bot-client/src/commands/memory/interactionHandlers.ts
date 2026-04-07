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
import { parseMemoryActionId } from './detail.js';
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
    logger.debug({ customId }, '[Memory] Unknown button customId');
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
  if (SESSION_INDEPENDENT_ACTIONS.has(parsed.action)) {
    await handleBrowseDetailAction(interaction);
    return;
  }

  // Session-dependent actions (back, confirm-delete) need to know which list
  // to refresh after the action completes. Look up the session to find out.
  const session = await findMemoryListSessionByMessage(interaction.message.id);
  if (session === null) {
    await interaction.reply({
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
    logger.warn({ customId }, '[Memory] Unhandled detail action');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Unknown action.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

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
 * Handle modal submit interactions for memory editing.
 *
 * Every path must acknowledge the interaction (reply or defer) — unacknowledged
 * modal submits surface as "This interaction failed" in Discord, which is worse
 * than a clean error message.
 */
export async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parsed = parseMemoryActionId(interaction.customId);

  if (parsed?.action !== 'edit') {
    logger.warn({ customId: interaction.customId }, '[Memory] Unknown modal');
    await interaction.reply({
      content: '❌ Unknown modal submission.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (parsed.memoryId === undefined) {
    logger.warn({ customId: interaction.customId }, '[Memory] Edit modal missing memoryId');
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
  // and search result lists. Route based on the session kind so the detail
  // view's "back" button returns to the correct list.
  const parsed = parseMemoryActionId(customId);
  if (parsed?.action === 'select') {
    const session = await findMemoryListSessionByMessage(interaction.message.id);
    if (session?.data.kind === 'search') {
      await handleSearchSelect(interaction);
    } else {
      // Default to browse for any non-search session. This also handles the
      // "no session" case (expired): the select itself still works since it
      // fetches the memory by ID, but the detail view's "back" button will
      // return to browse page 1 instead of the original list — degraded but
      // not broken.
      await handleBrowseSelect(interaction);
    }
    return;
  }

  logger.debug({ customId }, '[Memory] Unknown select menu customId');
  await interaction.reply({
    content: '⏰ This interaction has expired. Please run the command again.',
    flags: MessageFlags.Ephemeral,
  });
}
