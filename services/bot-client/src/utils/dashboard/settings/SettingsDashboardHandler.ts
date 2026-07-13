/* eslint-disable sonarjs/no-duplicate-string -- Dashboard action prefixes and setting key strings repeated across handler branches */
/**
 * Settings Dashboard Handler
 *
 * Coordinates all settings dashboard interactions:
 * - Select menu: Navigate to setting drill-down
 * - Buttons: Set values (tri-state) or open modals
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
  DashboardView,
  parseSettingsCustomId,
  SettingType,
  clampPage,
  isPlainSetting,
} from './types.js';
import {
  buildOverviewMessage,
  buildSettingMessage,
  getSettingById,
} from './SettingsDashboardBuilder.js';
import { buildSettingEditModal } from './SettingsModalFactory.js';
import { storeSession, getSession, deleteSession } from './SettingsSessionStorage.js';

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
}

/**
 * Create and display a new settings dashboard
 */
export async function createSettingsDashboard(
  interaction: ChatInputCommandInteraction,
  options: CreateDashboardOptions
): Promise<void> {
  const { config, data, entityId, entityName, userId } = options;

  // Build initial overview message
  const session: SettingsDashboardSession = {
    level: config.level,
    entityId,
    entityName,
    data,
    view: DashboardView.OVERVIEW,
    page: 0,
    userId,
    messageId: '', // Will be set after reply
    channelId: interaction.channelId,
    lastActivityAt: new Date(),
  };

  const message = buildOverviewMessage(config, session);

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
 * Handle a select menu interaction for settings navigation
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
  await interaction.deferUpdate();

  const session = await resolveValidatedSession(
    interaction,
    config.entityType,
    parsed.entityId,
    content => interaction.followUp({ content, flags: MessageFlags.Ephemeral })
  );
  if (session === null) {
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

  // Build and update message
  const message = buildSettingMessage(config, session, setting);

  await interaction.editReply({
    embeds: message.embeds,
    components: message.components,
  });

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
  updateHandler: SettingUpdateHandler
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
    await interaction.deferUpdate();
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
      // The Close button no longer renders on paged dashboards (D18), but the
      // action stays routable — stale messages predating the change still
      // carry it, and flat dashboards keep the button.
      await handleCloseButton(interaction, config, session);
      break;
    case 'page':
      await handlePageButton(interaction, config, session, parsed.extra);
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
    default:
      // The router already deferUpdate'd (non-edit actions defer above), so a
      // bare return leaves the interaction silently unresolved. An unrecognized
      // action is realistically a stale customId on an old dashboard message that
      // outlived a deploy renaming/removing the action — give the user feedback.
      logger.warn({ action: parsed.action }, 'Unknown button action');
      await notify('This dashboard is out of date. Please run the command again.');
  }
}

/**
 * Handle back button - return to overview
 */
async function handleBackButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): Promise<void> {
  session.view = DashboardView.OVERVIEW;
  session.activeSetting = undefined;
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  const message = buildOverviewMessage(config, session);

  // editReply: the router already deferUpdate'd before dispatching here.
  await interaction.editReply({
    embeds: message.embeds,
    components: message.components,
  });
}

/**
 * Handle page navigation (paged configs) — mutate the session page and
 * re-render the overview. Clamped on BOTH the stored value and the result, so
 * a stale button (session already at an edge, or a shrunk page list after a
 * deploy) can never render an out-of-range page. The `noop` indicator button
 * is disabled and never reaches here; treat it as a re-render if it somehow does.
 */
async function handlePageButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  direction: string | undefined
): Promise<void> {
  const current = clampPage(config, session.page);
  const delta = direction === 'next' ? 1 : direction === 'prev' ? -1 : 0;
  session.page = clampPage(config, current + delta);
  session.view = DashboardView.OVERVIEW;
  session.activeSetting = undefined;
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  const message = buildOverviewMessage(config, session);

  // editReply: the router already deferUpdate'd (page is a non-modal action).
  await interaction.editReply({
    embeds: message.embeds,
    components: message.components,
  });
}

/**
 * Handle close button - remove dashboard
 */
async function handleCloseButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): Promise<void> {
  // Delete session
  await deleteSession(session.userId, config.entityType, session.entityId);

  // editReply: the router already deferUpdate'd before dispatching here.
  await interaction.editReply({
    content: 'Settings dashboard closed.',
    embeds: [],
    components: [],
  });
}

/**
 * Handle set button - directly set a value (for tri-state)
 */
async function handleSetButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  extra: string | undefined,
  updateHandler: SettingUpdateHandler
): Promise<void> {
  if (extra === undefined) {
    // Reached via the already-deferred `set` action; a bare return would leave the
    // interaction unresolved. No current builder produces a `set` customId without
    // the setting:value extra, but a stale message or future builder change could.
    logger.warn('Set button missing extra data');
    await interaction.followUp({
      content: 'Invalid button data. Please run the command again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Parse setting:value format (single split — values may contain colons)
  const colonIdx = extra.indexOf(':');
  const settingId = extra.slice(0, colonIdx);
  const rawValue = extra.slice(colonIdx + 1);
  const setting = getSettingById(config, settingId);

  if (setting === undefined) {
    // followUp/editReply throughout — the router deferUpdate'd before dispatch.
    await interaction.followUp({
      content: 'Unknown setting.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Parse the value
  let newValue: unknown;
  switch (rawValue) {
    case 'auto':
      newValue = null; // Auto means inherit
      break;
    case 'true':
      newValue = true;
      break;
    case 'false':
      newValue = false;
      break;
    default:
      newValue = rawValue;
  }

  // Non-cascading settings have no inherit tier — a null here can only come
  // from a forged/stale `:auto` customId (no plain-mode builder renders an
  // Auto button). Reject with a friendly message rather than letting the
  // update handler surface a raw validation error.
  if (
    newValue === null &&
    (isPlainSetting(config, setting) || setting.type === SettingType.BOOLEAN)
  ) {
    await interaction.followUp({
      content: 'This setting has no Auto — set an explicit value.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Call the update handler
  const result = await updateHandler(interaction, session, settingId, newValue);

  if (!result.success) {
    await interaction.followUp({
      content: `Failed to update: ${result.error}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Update session with new data (a successful update clears any pending
  // rejected-input state — the retry affordance is per-failure, not sticky)
  if (result.newData !== undefined) {
    session.data = result.newData;
  }
  session.lastRejectedInput = undefined;
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  // Rebuild the current view
  if (session.view === DashboardView.SETTING && session.activeSetting !== undefined) {
    const activeSetting = getSettingById(config, session.activeSetting);
    if (activeSetting !== undefined) {
      const message = buildSettingMessage(config, session, activeSetting);
      await interaction.editReply({
        embeds: message.embeds,
        components: message.components,
      });
      return;
    }
  }

  // Default: return to overview
  const message = buildOverviewMessage(config, session);
  await interaction.editReply({
    embeds: message.embeds,
    components: message.components,
  });
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
