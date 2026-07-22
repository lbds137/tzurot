/**
 * Memory Command - Interaction Handlers
 *
 * Declarative dispatch table over `createComponentRouter` covering:
 * - Memory browse/search pagination + selects (browse.ts / search.ts)
 * - Purge destructive confirmation (purge.ts, Tier-B flow)
 * - Fact browse/detail surfaces (factsBrowse.ts / factsDetail.ts)
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
import { createComponentRouter, type ComponentRoute } from '../../utils/componentRouter.js';
import { replyValidationError } from '../../utils/confirmation/confirmDestructive.js';
import { DestructiveCustomIds } from '../../utils/customIds.js';
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
import { MEMORY_PURGE_OPERATION, handlePurgeButton, handlePurgeModal } from './purge.js';
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
import { ackUpdate } from '../../ux/render/reply.js';

const logger = createLogger('memory-command');

/** Shared copy for unrecognized component customIds. */
const UNKNOWN_INTERACTION = 'Unknown interaction.';

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
 * Memory-detail button dispatch (memory-detail::...).
 *
 * Session-independent actions (edit, lock, view-full, etc.) only need the
 * memoryId from the custom ID. Session-dependent actions (back,
 * confirm-delete) need to know which list to refresh after the action
 * completes — that requires a session lookup, which is async, so we must
 * deferUpdate BEFORE it (ack-first rule). The downstream handlers tolerate
 * an already-deferred interaction, and the expired-session path uses
 * followUp instead of reply.
 *
 * Failure mode to watch: if any action in SESSION_INDEPENDENT_ACTIONS ever
 * starts calling onRefresh, memories opened from a search result will
 * silently skip the list refresh — refreshBrowseList bails when the
 * session kind is 'search'. The fix in that case is to move the newly
 * refreshing action out of SESSION_INDEPENDENT_ACTIONS so it falls through
 * to the kind-based dispatch below.
 */
async function handleDetailButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseMemoryActionId(interaction.customId);
  if (parsed === null) {
    await replyValidationError(interaction, UNKNOWN_INTERACTION);
    return;
  }

  if (SESSION_INDEPENDENT_ACTIONS.has(parsed.action)) {
    await handleBrowseDetailAction(interaction);
    return;
  }

  await ackUpdate(interaction);

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
    logger.warn({ customId: interaction.customId }, 'Unhandled detail action');
    // Interaction is already deferred at this point, so use followUp.
    await interaction.followUp({
      content: renderSpec(CATALOG.error.validation('Unknown action.')),
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Fact-detail button dispatch (memory-fact::...).
 *
 * Ack discipline: 'correct' must NOT be deferred here — it opens a modal, and
 * showModal must be the interaction's first response. 'lock' and 'forget'
 * self-defer. 'back' and 'confirm-forget' are deferred here because they
 * refresh the list view (their handlers guard against double-acking).
 */
async function handleFactButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseFactActionId(interaction.customId);
  if (parsed === null) {
    await replyValidationError(interaction, UNKNOWN_INTERACTION);
    return;
  }
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
    await ackUpdate(interaction);
    await refreshFactsList(interaction);
    return;
  }
  if (action === 'confirm-forget' && factId !== undefined) {
    await ackUpdate(interaction);
    const forgotten = await handleForgetConfirm(interaction, factId);
    if (forgotten) {
      await refreshFactsList(interaction);
    }
    return;
  }

  logger.warn({ customId: interaction.customId }, 'Unhandled fact action');
  await replyValidationError(interaction, 'Unknown action.');
}

/** Fact correction modal (memory-fact::correct::<factId>). */
async function handleFactCorrectModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parsed = parseFactActionId(interaction.customId);
  if (parsed?.factId === undefined) {
    await replyValidationError(interaction, 'Malformed correction modal (missing fact ID).');
    return;
  }
  await handleCorrectModalSubmit(interaction, parsed.factId);
}

/** Memory edit modal (memory-detail::edit::<memoryId>). */
async function handleMemoryEditModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parsed = parseMemoryActionId(interaction.customId);
  if (parsed?.memoryId === undefined) {
    logger.warn({ customId: interaction.customId }, 'Edit modal missing memoryId');
    await replyValidationError(interaction, 'Malformed edit modal (missing memory ID).');
    return;
  }
  await handleEditModalSubmit(interaction, parsed.memoryId);
}

/**
 * The dispatch table. Order matters in two places: fact-browse before the
 * fact-detail parse (the prefixes share the 'memory-fact' stem), and the
 * memory-detail parse last (its parser is the loosest).
 */
const routes: ComponentRoute[] = [
  // Browse/search pagination + selects
  { matches: isMemoryBrowsePagination, onButton: handleBrowsePagination },
  { matches: id => browseHelpers.isBrowseSelect(id), onSelect: handleBrowseSelect },
  { matches: isMemorySearchPagination, onButton: handleSearchPagination },
  { matches: id => searchHelpers.isBrowseSelect(id), onSelect: handleSearchSelect },
  // Purge destructive confirmation (memory::destructive::...::purge::...)
  {
    matches: id => DestructiveCustomIds.parse(id)?.operation === MEMORY_PURGE_OPERATION,
    onButton: handlePurgeButton,
    onModal: handlePurgeModal,
  },
  // Fact browse before fact detail (shared 'memory-fact' stem)
  { matches: isFactBrowsePagination, onButton: handleFactsPagination },
  {
    // Fact browse select or the detail select id — both open the fact detail view.
    matches: id =>
      factBrowseHelpers.isBrowseSelect(id) || parseFactActionId(id)?.action === 'select',
    onSelect: handleFactSelect,
  },
  {
    matches: id => parseFactActionId(id)?.action === 'correct',
    onModal: handleFactCorrectModal,
  },
  { matches: id => parseFactActionId(id) !== null, onButton: handleFactButton },
  // Memory detail (memory-detail::...). The select id is used by
  // buildMemorySelectMenu for both browse and search result lists — both
  // origins open the same detail view, and "back" resolves the original
  // list via the messageId-keyed session when clicked.
  {
    matches: id => parseMemoryActionId(id)?.action === 'select',
    onSelect: handleMemorySelect,
  },
  {
    matches: id => parseMemoryActionId(id)?.action === 'edit',
    onModal: handleMemoryEditModal,
  },
  { matches: id => parseMemoryActionId(id) !== null, onButton: handleDetailButton },
];

const router = createComponentRouter({
  routes,
  // Every unrouted path must still acknowledge the interaction —
  // unacknowledged submits surface as "This interaction failed" in Discord.
  // "Unknown interaction" (not "expired") so the user doesn't chase the
  // wrong cause and re-run the command needlessly.
  unrouted: async (interaction, kind) => {
    logger.debug({ customId: interaction.customId, kind }, 'Unrouted memory interaction');
    await replyValidationError(
      interaction,
      kind === 'modal' ? 'Unknown modal submission.' : UNKNOWN_INTERACTION
    );
  },
});

export const handleButton: (interaction: ButtonInteraction) => Promise<void> = router.handleButton;
export const handleSelectMenu: (interaction: StringSelectMenuInteraction) => Promise<void> =
  router.handleSelectMenu;
export const handleModal: (interaction: ModalSubmitInteraction) => Promise<void> =
  router.handleModal;
