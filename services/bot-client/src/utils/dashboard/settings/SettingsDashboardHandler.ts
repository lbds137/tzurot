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
  type ModalSubmitInteraction,
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
} from './types.js';
import {
  buildOverviewMessage,
  buildSettingMessage,
  getSettingById,
} from './SettingsDashboardBuilder.js';
import { buildSettingEditModal } from './SettingsModalFactory.js';
import { storeSession, getSession, deleteSession } from './SettingsSessionStorage.js';
import { parseNumericInputValue, parseDurationInputValue } from './settingsInputParser.js';
export { getUpdateHandler } from './SettingsSessionStorage.js';

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
  /** Handler for setting updates */
  updateHandler: SettingUpdateHandler;
}

/**
 * Create and display a new settings dashboard
 */
export async function createSettingsDashboard(
  interaction: ChatInputCommandInteraction,
  options: CreateDashboardOptions
): Promise<void> {
  const { config, data, entityId, entityName, userId, updateHandler } = options;

  // Build initial overview message
  const session: SettingsDashboardSession = {
    level: config.level,
    entityId,
    entityName,
    data,
    view: DashboardView.OVERVIEW,
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
  await storeSession(session, config.entityType, updateHandler);

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
  config: SettingsDashboardConfig,
  updateHandler: SettingUpdateHandler
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
  const setting = getSettingById(settingId);

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
  await storeSession(session, config.entityType, updateHandler);

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
  // the edit action, which opens a modal. `showModal` IS the ack and can't be
  // preceded by a defer, so the edit path keeps the read-then-showModal flow
  // (mitigated by showModalWithTimeoutCatch inside handleEditButton). For every
  // other action we defer first; error notices then use followUp (post-defer) vs
  // reply (the not-yet-acked edit path).
  const isModalAction = parsed.action === 'edit';
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
      await handleBackButton(interaction, config, session, updateHandler);
      break;
    case 'close':
      await handleCloseButton(interaction, config, session);
      break;
    case 'set':
      await handleSetButton(interaction, config, session, parsed.extra, updateHandler);
      break;
    case 'edit':
      await handleEditButton(interaction, config, session, parsed.extra);
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
  session: SettingsDashboardSession,
  updateHandler: SettingUpdateHandler
): Promise<void> {
  session.view = DashboardView.OVERVIEW;
  session.activeSetting = undefined;
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType, updateHandler);

  const message = buildOverviewMessage(config, session);

  // editReply: the router already deferUpdate'd before dispatching here.
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
  const setting = getSettingById(settingId);

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

  // Call the update handler
  const result = await updateHandler(interaction, session, settingId, newValue);

  if (!result.success) {
    await interaction.followUp({
      content: `Failed to update: ${result.error}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Update session with new data
  if (result.newData !== undefined) {
    session.data = result.newData;
  }
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType, updateHandler);

  // Rebuild the current view
  if (session.view === DashboardView.SETTING && session.activeSetting !== undefined) {
    const activeSetting = getSettingById(session.activeSetting);
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

  const setting = getSettingById(settingId);
  if (setting === undefined) {
    await replyEditGuard(interaction, session.entityId, 'Unknown setting.', settingId);
    return;
  }

  // Get current value for the modal
  const currentValue = session.data[settingId as keyof SettingsData] as SettingValue<unknown>;

  // Build and show modal. Wrap showModal so the 3-second budget can't
  // blow silently after the preceding getSession await — see
  // showModalWithTimeoutCatch JSDoc.
  const modal = buildSettingEditModal(
    config.entityType,
    session.entityId,
    setting,
    currentValue.effectiveValue
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
 * Handle modal submission for settings
 */
export async function handleSettingsModal(
  interaction: ModalSubmitInteraction,
  config: SettingsDashboardConfig,
  updateHandler: SettingUpdateHandler
): Promise<void> {
  const parsed = parseSettingsCustomId(interaction.customId);
  if (parsed === null) {
    logger.warn({ customId: interaction.customId }, 'Invalid modal customId');
    return;
  }

  const settingId = parsed.extra;
  if (settingId === undefined) {
    // Sync guard, no preceding async — reply is the ack-first response here.
    await interaction.reply({
      content: 'Invalid modal submission.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Ack first (3-second rule): deferUpdate before the Redis getSession and the
  // validation below. Every error path after this point uses followUp (the
  // interaction is already acked); the success path editReplies the dashboard.
  await interaction.deferUpdate();

  // Get session
  const session = await getSession(interaction.user.id, config.entityType, parsed.entityId);

  if (session === null) {
    await interaction.followUp({
      content: 'This dashboard has expired. Please run the command again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Get the input value
  const inputValue = interaction.fields.getTextInputValue('value');
  const setting = getSettingById(settingId);

  if (setting === undefined) {
    await interaction.followUp({
      content: 'Unknown setting.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Parse based on setting type
  let parsedValue: unknown;
  let error: string | undefined;

  if (setting.type === SettingType.NUMERIC) {
    const result = parseNumericInputValue(inputValue, setting.min ?? 0, setting.max ?? 100);
    if (result.error !== undefined) {
      error = result.error;
    } else {
      parsedValue = result.value;
    }
  } else if (setting.type === SettingType.DURATION) {
    const result = parseDurationInputValue(inputValue);
    if (result.error !== undefined) {
      error = result.error;
    } else {
      parsedValue = result.value;
    }
  }

  if (error !== undefined) {
    await interaction.followUp({
      content: error,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Call the update handler (interaction was already deferUpdate'd above)
  const result = await updateHandler(interaction, session, settingId, parsedValue);

  if (!result.success) {
    // Since we deferred, we can't easily show an error
    // The dashboard will remain in its previous state
    logger.warn({ settingId, error: result.error }, 'Update failed');
    return;
  }

  // Update session with new data
  if (result.newData !== undefined) {
    session.data = result.newData;
  }
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType, updateHandler);

  // Rebuild the setting view
  const message = buildSettingMessage(config, session, setting);

  await interaction.editReply({
    embeds: message.embeds,
    components: message.components,
  });
}
