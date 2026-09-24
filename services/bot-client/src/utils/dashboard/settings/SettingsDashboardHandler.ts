/**
 * Settings Dashboard Handler
 *
 * Coordinates all settings dashboard interactions:
 * - Select menus: Navigate to setting drill-down, or jump from the index to a page
 * - Buttons: Set values (tri-state), open modals, navigate (pages, index), or
 *   reset a page / the whole dashboard to Auto (settingsResetFlow)
 * - Modals: Parse and apply values
 *
 * This is the main entry point for command handlers.
 */

import {
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ChatInputCommandInteraction,
  MessageFlags,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { showModalWithTimeoutCatch } from '../showModalWithTimeoutCatch.js';
import { ackWithTimeoutCatch } from '../ackWithTimeoutCatch.js';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingsData,
  type SettingValue,
  type SettingUpdateHandler,
  type SettingsResetHandler,
  DashboardView,
  parseSettingsCustomId,
} from './types.js';
import { buildSettingMessage, getSettingById } from './SettingsDashboardBuilder.js';
import { buildSettingEditModal } from './SettingsModalFactory.js';
import { handleSetButton } from './settingsUpdate.js';
import {
  handleBackButton,
  handleCloseButton,
  handleIndexButton,
  handleJumpSelect,
  handlePageButton,
} from './settingsNavigationHandlers.js';
import { STALE_DASHBOARD_NOTICE, handleResetAction } from './settingsResetFlow.js';
import { buildLandingMessage, resolveLandingView } from './settingsIndexView.js';
import { storeSession, getSession } from './SettingsSessionStorage.js';
import { ackUpdate } from '../../../ux/render/reply.js';

const logger = createLogger('SettingsDashboardHandler');

/**
 * Options for creating a settings dashboard
 */
interface CreateDashboardOptions {
  /** Dashboard configuration */
  config: SettingsDashboardConfig;
  /** Initial settings data */
  data: SettingsData;
  /** Entity ID */
  entityId: string;
  /** Entity name for display */
  entityName: string;
  /** User ID who owns this dashboard */
  userId: string;
  /**
   * Per-invocation description note, kept on the session so every re-render
   * shows it (the routers re-render with the base config).
   */
  descriptionNote?: string;
}

/**
 * Create and display a new settings dashboard, on its landing view: the page
 * index for a dashboard of INDEX_LANDING_MIN_PAGES pages or more, otherwise
 * page 1 of the overview (settingsIndexView owns the threshold).
 */
export async function createSettingsDashboard(
  interaction: ChatInputCommandInteraction,
  options: CreateDashboardOptions
): Promise<void> {
  const { config, data, entityId, entityName, userId, descriptionNote } = options;

  // Build the initial (landing) message
  const session: SettingsDashboardSession = {
    level: config.level,
    entityId,
    entityName,
    data,
    view: resolveLandingView(config),
    page: 0,
    descriptionNote,
    userId,
    messageId: '', // Will be set after reply
    channelId: interaction.channelId,
    lastActivityAt: new Date(),
  };

  const message = buildLandingMessage(config, session);

  // Send the dashboard
  const reply = await interaction.editReply({
    embeds: message.embeds,
    components: message.components,
  });

  // Store session with message ID
  session.messageId = reply.id;
  await storeSession(session, config.entityType);

  logger.debug({ entityType: config.entityType, entityId, userId }, 'Created dashboard');
}

/**
 * Fetch the dashboard session and run the shared expired + ownership guards.
 * Returns the session, or null after notifying the user. `notify` abstracts the
 * send shape that differs between callers (a select menu always `followUp`s
 * post-defer; the button handler routes the un-acked edit path through a
 * 10062-safe wrapped reply). Callers ack (deferUpdate) before calling — except
 * the edit path, whose `notify` owns its own ack.
 */
async function resolveValidatedSession(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  entityType: string,
  entityId: string,
  notify: (content: string) => Promise<unknown>
): Promise<SettingsDashboardSession | null> {
  const session = await getSession(interaction.user.id, entityType, entityId);
  if (session === null) {
    await notify('This dashboard has expired. Please run the command again.');
    return null;
  }
  if (session.userId !== interaction.user.id) {
    await notify('This dashboard belongs to another user.');
    return null;
  }
  return session;
}

/**
 * Handle a select menu interaction for settings navigation: the overview's
 * setting select (drill into a setting) or the index's jump select (open a
 * page). Both share the ack-first path and the session guards.
 */
export async function handleSettingsSelectMenu(
  interaction: StringSelectMenuInteraction,
  config: SettingsDashboardConfig
): Promise<void> {
  const parsed = parseSettingsCustomId(interaction.customId);
  if (parsed === null) {
    logger.warn({ customId: interaction.customId }, 'Invalid customId');
    return;
  }

  // Ack first (3-second rule): deferUpdate before the Redis session read + store.
  // A select menu never opens a modal, so it can always defer; the responses
  // below become followUp (errors) / editReply (the drill-down).
  await ackUpdate(interaction);

  const session = await resolveValidatedSession(
    interaction,
    config.entityType,
    parsed.entityId,
    content => interaction.followUp({ content, flags: MessageFlags.Ephemeral })
  );
  if (session === null) {
    return;
  }

  if (parsed.action === 'jump') {
    await handleJumpSelect(interaction, config, session);
    return;
  }

  // Get selected setting
  const settingId = interaction.values[0];
  const setting = getSettingById(config, settingId);

  if (setting === undefined) {
    await interaction.followUp({
      content: 'Unknown setting selected.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Update session to drill-down view
  session.view = DashboardView.SETTING;
  session.activeSetting = settingId;
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  // Build and update message (the builder returns exactly the editReply payload)
  await interaction.editReply(buildSettingMessage(config, session, setting));

  logger.debug(
    { entityType: config.entityType, entityId: parsed.entityId, settingId },
    'Navigated to setting'
  );
}

/**
 * Handle a button interaction for settings
 */
export async function handleSettingsButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  updateHandler: SettingUpdateHandler,
  resetHandler?: SettingsResetHandler
): Promise<void> {
  const parsed = parseSettingsCustomId(interaction.customId);
  if (parsed === null) {
    logger.warn({ customId: interaction.customId }, 'Invalid button customId');
    return;
  }

  // Ack first (3-second rule): deferUpdate before the Redis session read — EXCEPT
  // the modal-opening actions (edit, and retry which re-opens the modal with the
  // rejected input). `showModal` IS the ack and can't be preceded by a defer, so
  // those paths keep the read-then-showModal flow (mitigated by
  // showModalWithTimeoutCatch). For every other action we defer first; error
  // notices then use followUp (post-defer) vs reply (the not-yet-acked modal paths).
  const isModalAction = parsed.action === 'edit' || parsed.action === 'retry';
  if (!isModalAction) {
    await ackUpdate(interaction);
  }
  // The edit action can't defer (showModal is its ack), so its guard replies are
  // un-acked — route them through replyEditGuard so a budget-blown 10062 degrades
  // to a followUp instead of a silent failure. Every other action deferred above,
  // so followUp (post-defer) is correct and safe.
  const notify = (content: string): Promise<unknown> =>
    isModalAction
      ? replyEditGuard(interaction, parsed.entityId, content, parsed.extra ?? parsed.action)
      : interaction.followUp({ content, flags: MessageFlags.Ephemeral });

  const session = await resolveValidatedSession(
    interaction,
    config.entityType,
    parsed.entityId,
    notify
  );
  if (session === null) {
    return;
  }

  // Handle different actions
  switch (parsed.action) {
    case 'back':
      await handleBackButton(interaction, config, session);
      break;
    case 'close':
      // No settings dashboard renders a Close row anymore — ephemeral
      // dashboards rely on native dismiss plus the session TTL for teardown.
      // The action stays routable because stale messages predating the
      // removal still carry the button.
      await handleCloseButton(interaction, config, session);
      break;
    case 'page':
      await handlePageButton(interaction, config, session, parsed.extra);
      break;
    case 'index':
      await handleIndexButton(interaction, config, session);
      break;
    case 'set':
      await handleSetButton(interaction, config, session, parsed.extra, updateHandler);
      break;
    case 'edit':
      await handleEditButton(interaction, config, session, parsed.extra);
      break;
    case 'retry':
      await handleRetryButton(interaction, config, session, parsed.extra);
      break;
    // Reset page / Reset all: two clicks behind a Tier-A confirm. The scope
    // rides in the extra; settingsResetFlow resolves it, and answers a scope
    // that no longer resolves (or a dashboard with no batch clear wired) with
    // the stale-dashboard notice.
    case 'reset':
    case 'reset-confirm':
    case 'reset-cancel':
      await handleResetAction(interaction, config, session, {
        action: parsed.action,
        extra: parsed.extra,
        resetHandler,
        notify,
      });
      break;
    default:
      // The router already deferUpdate'd (non-edit actions defer above), so a
      // bare return leaves the interaction silently unresolved. An unrecognized
      // action is realistically a stale customId on an old dashboard message that
      // outlived a deploy renaming/removing the action — give the user feedback.
      logger.warn({ action: parsed.action }, 'Unknown button action');
      await notify(STALE_DASHBOARD_NOTICE);
  }
}

/**
 * Reply on the un-deferred edit path, wrapped so a budget-blown 10062 degrades
 * to a followUp instead of a silent "Interaction Failed". The edit action skips
 * deferUpdate (showModal is its ack), so getSession has already eaten into the
 * 3-second budget by the time these guard replies fire — same risk the sibling
 * showModalWithTimeoutCatch defends against on the success path.
 */
function replyEditGuard(
  interaction: ButtonInteraction,
  entityId: string,
  content: string,
  sectionId: string
): Promise<void> {
  return ackWithTimeoutCatch(
    interaction,
    () => interaction.reply({ content, flags: MessageFlags.Ephemeral }),
    {
      source: 'handleSettingsButton/edit',
      userId: interaction.user.id,
      entityId,
      sectionId,
    },
    content
  );
}

/**
 * Handle edit button - show modal for value input
 */
async function handleEditButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  settingId: string | undefined
): Promise<void> {
  if (settingId === undefined) {
    // Un-deferred edit path: a bare return leaves the interaction unacknowledged
    // → "This interaction failed". Same dead-end class as handleSetButton's
    // missing-extra guard, but reply (not followUp) since this path never acked.
    logger.warn('Edit button missing setting ID');
    await replyEditGuard(
      interaction,
      session.entityId,
      'Invalid button data. Please run the command again.',
      'edit'
    );
    return;
  }

  const setting = getSettingById(config, settingId);
  if (setting === undefined) {
    await replyEditGuard(interaction, session.entityId, 'Unknown setting.', settingId);
    return;
  }

  // Get current value for the modal (undefined for stale pre-deploy sessions —
  // the modal prefill degrades to empty)
  const currentValue = session.data[settingId] as SettingValue<unknown> | undefined;

  // Build and show modal. Wrap showModal so the 3-second budget can't
  // blow silently after the preceding getSession await — see
  // showModalWithTimeoutCatch JSDoc.
  const modal = buildSettingEditModal(
    config.entityType,
    session.entityId,
    setting,
    currentValue?.effectiveValue
  );
  await showModalWithTimeoutCatch(
    interaction,
    modal,
    {
      source: 'handleSettingsButton/edit',
      userId: interaction.user.id,
      entityId: session.entityId,
      sectionId: settingId,
    },
    '⏰ Took too long to open the editor. Please click the setting button again.'
  );
}

/**
 * Handle the Try-again button from a rejected modal submission (D15: never
 * lose typed input to a validation error). Re-opens the modal PREFILLED with
 * the rejected value from the session. Un-deferred path — showModal is the
 * ack, same flow as handleEditButton.
 */
async function handleRetryButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  settingId: string | undefined
): Promise<void> {
  if (settingId === undefined) {
    await replyEditGuard(
      interaction,
      session.entityId,
      'Invalid button data. Please run the command again.',
      'retry'
    );
    return;
  }

  const setting = getSettingById(config, settingId);
  if (setting === undefined) {
    await replyEditGuard(interaction, session.entityId, 'Unknown setting.', settingId);
    return;
  }

  // The rejected input to prefill; a mismatched/expired one degrades to the
  // current effective value (the plain edit-modal behavior).
  const rejected =
    session.lastRejectedInput?.settingId === settingId
      ? session.lastRejectedInput.value
      : undefined;
  const currentValue = session.data[settingId] as SettingValue<unknown> | undefined;

  const modal = buildSettingEditModal(
    config.entityType,
    session.entityId,
    setting,
    rejected ?? currentValue?.effectiveValue
  );
  await showModalWithTimeoutCatch(
    interaction,
    modal,
    {
      source: 'handleSettingsButton/retry',
      userId: interaction.user.id,
      entityId: session.entityId,
      sectionId: settingId,
    },
    '⏰ Took too long to open the editor. Please click Try again once more.'
  );
}
