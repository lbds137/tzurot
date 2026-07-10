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

import {
  MessageFlags,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
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
import { MEMORY_PURGE_PREFIX, handlePurgeButton, handlePurgeModal } from './purge.js';
import {
  factBrowseHelpers,
  isFactBrowsePagination,
  handleFactsPagination,
  refreshFactsList,
} from './factsBrowse.js';
import {
  parseFactActionId,
  handleFactSelect,
  handleCorrectButton,
  handleCorrectModalSubmit,
  handleFactLockButton,
  handleForgetButton,
  handleForgetConfirm,
} from './factsDetail.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';

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

  // Purge confirmation buttons (memory-purge::proceed::... or memory-purge::cancel)
  if (customId.startsWith(`${MEMORY_PURGE_PREFIX}::`)) {
    await handlePurgeButton(interaction);
    return;
  }

  // Fact browse pagination (memory-fact-browse::browse::...) — checked before
  // the fact detail parse because the prefixes share the 'memory-fact' stem.
  if (isFactBrowsePagination(customId)) {
    await handleFactsPagination(interaction);
    return;
  }

  // Fact detail buttons (memory-fact::...)
  const factAction = parseFactActionId(customId);
  if (factAction !== null) {
    await routeFactButton(interaction, factAction);
    return;
  }

  // Detail action buttons (memory-detail::...)
  const parsed = parseMemoryActionId(customId);
  if (parsed === null) {
    logger.debug({ customId }, 'Unknown button customId');
    await interaction.reply({
      content: renderSpec(CATALOG.error.validation('Unknown interaction.')),
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
      content: renderSpec(CATALOG.error.validation('Unknown action.')),
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Route a parsed fact-detail button to its handler.
 *
 * Ack discipline: 'correct' must NOT be deferred here — it opens a modal, and
 * showModal must be the interaction's first response. 'lock' and 'forget'
 * self-defer. 'back' and 'confirm-forget' are deferred here because they
 * refresh the list view (their handlers guard against double-acking).
 */
async function routeFactButton(
  interaction: ButtonInteraction,
  parsed: { action: string; factId?: string; extra?: string }
): Promise<void> {
  const { action, factId, extra } = parsed;

  if (action === 'correct' && factId !== undefined) {
    await handleCorrectButton(interaction, factId);
    return;
  }
  if (action === 'lock' && factId !== undefined) {
    await handleFactLockButton(interaction, factId, extra === '1');
    return;
  }
  if (action === 'forget' && factId !== undefined) {
    await handleForgetButton(interaction, factId);
    return;
  }
  if (action === 'back') {
    await interaction.deferUpdate();
    await refreshFactsList(interaction);
    return;
  }
  if (action === 'confirm-forget' && factId !== undefined) {
    await interaction.deferUpdate();
    const forgotten = await handleForgetConfirm(interaction, factId);
    if (forgotten) {
      await refreshFactsList(interaction);
    }
    return;
  }

  logger.warn({ customId: interaction.customId }, 'Unhandled fact action');
  await interaction.reply({
    content: renderSpec(CATALOG.error.validation('Unknown action.')),
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Handle modal submit interactions for memory editing.
 *
 * Every path must acknowledge the interaction (reply or defer) — unacknowledged
 * modal submits surface as "This interaction failed" in Discord, which is worse
 * than a clean error message.
 */
export async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  const { customId } = interaction;

  // Purge confirmation modal (memory-purge::confirm::<personalityId>)
  if (customId.startsWith(`${MEMORY_PURGE_PREFIX}::`)) {
    await handlePurgeModal(interaction);
    return;
  }

  // Fact correction modal (memory-fact::correct::<factId>)
  const factParsed = parseFactActionId(customId);
  if (factParsed?.action === 'correct' && factParsed.factId !== undefined) {
    await handleCorrectModalSubmit(interaction, factParsed.factId);
    return;
  }

  const parsed = parseMemoryActionId(customId);

  if (parsed?.action !== 'edit') {
    logger.warn({ customId }, 'Unknown modal');
    await interaction.reply({
      content: renderSpec(CATALOG.error.validation('Unknown modal submission.')),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (parsed.memoryId === undefined) {
    logger.warn({ customId: interaction.customId }, 'Edit modal missing memoryId');
    await interaction.reply({
      content: renderSpec(CATALOG.error.validation('Malformed edit modal (missing memory ID).')),
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

  // Fact browse select (memory-fact-browse::browse-select) or the detail
  // select id (memory-fact::select) — both open the fact detail view.
  if (
    factBrowseHelpers.isBrowseSelect(customId) ||
    parseFactActionId(customId)?.action === 'select'
  ) {
    await handleFactSelect(interaction);
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
    content: renderSpec(CATALOG.error.validation('Unknown interaction.')),
    flags: MessageFlags.Ephemeral,
  });
}
