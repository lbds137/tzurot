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
import { createLogger } from '@tzurot/common-types';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingsData,
  type SettingValue,
  type SettingUpdateHandler,
  DashboardView,
  parseSettingsCustomId,
  isSettingsInteraction,
  SettingType,
} from './types.js';
import {
  buildOverviewMessage,
  buildSettingMessage,
  getSettingById,
} from './SettingsDashboardBuilder.js';
import { buildSettingEditModal, parseDurationInput } from './SettingsModalFactory.js';
import { getSessionManager } from '../SessionManager.js';

const logger = createLogger('SettingsDashboardHandler');

/**
 * Options for creating a settings dashboard
 */
export interface CreateDashboardOptions {
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
  storeSession(session, config.entityType, updateHandler);

  logger.debug(
    { entityType: config.entityType, entityId, userId },
    '[SettingsDashboard] Created dashboard'
  );
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
    logger.warn({ customId: interaction.customId }, '[SettingsDashboard] Invalid customId');
    return;
  }

  // Get session
  const session = getSession(interaction.user.id, config.entityType, parsed.entityId);

  if (session === null) {
    await interaction.reply({
      content: 'This dashboard has expired. Please run the command again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Verify ownership
  if (session.userId !== interaction.user.id) {
    await interaction.reply({
      content: 'This dashboard belongs to another user.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Get selected setting
  const settingId = interaction.values[0];
  const setting = getSettingById(settingId);

  if (setting === undefined) {
    await interaction.reply({
      content: 'Unknown setting selected.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Update session to drill-down view
  session.view = DashboardView.SETTING;
  session.activeSetting = settingId;
  session.lastActivityAt = new Date();
  storeSession(session, config.entityType, updateHandler);

  // Build and update message
  const message = buildSettingMessage(config, session, setting);

  await interaction.update({
    embeds: message.embeds,
    components: message.components,
  });

  logger.debug(
    { entityType: config.entityType, entityId: parsed.entityId, settingId },
    '[SettingsDashboard] Navigated to setting'
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
    logger.warn({ customId: interaction.customId }, '[SettingsDashboard] Invalid button customId');
    return;
  }

  // Get session
  const session = getSession(interaction.user.id, config.entityType, parsed.entityId);

  if (session === null) {
    await interaction.reply({
      content: 'This dashboard has expired. Please run the command again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Verify ownership
  if (session.userId !== interaction.user.id) {
    await interaction.reply({
      content: 'This dashboard belongs to another user.',
      flags: MessageFlags.Ephemeral,
    });
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
      logger.warn({ action: parsed.action }, '[SettingsDashboard] Unknown button action');
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
  storeSession(session, config.entityType, updateHandler);

  const message = buildOverviewMessage(config, session);

  await interaction.update({
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
  deleteSession(session.userId, config.entityType, session.entityId);

  // Delete the message
  await interaction.update({
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
    logger.warn({}, '[SettingsDashboard] Set button missing extra data');
    return;
  }

  // Parse setting:value format
  const [settingId, rawValue] = extra.split(':');
  const setting = getSettingById(settingId);

  if (setting === undefined) {
    await interaction.reply({
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
    await interaction.reply({
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
  storeSession(session, config.entityType, updateHandler);

  // Rebuild the current view
  if (session.view === DashboardView.SETTING && session.activeSetting !== undefined) {
    const activeSetting = getSettingById(session.activeSetting);
    if (activeSetting !== undefined) {
      const message = buildSettingMessage(config, session, activeSetting);
      await interaction.update({
        embeds: message.embeds,
        components: message.components,
      });
      return;
    }
  }

  // Default: return to overview
  const message = buildOverviewMessage(config, session);
  await interaction.update({
    embeds: message.embeds,
    components: message.components,
  });
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
    logger.warn({}, '[SettingsDashboard] Edit button missing setting ID');
    return;
  }

  const setting = getSettingById(settingId);
  if (setting === undefined) {
    await interaction.reply({
      content: 'Unknown setting.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Get current value for the modal
  const currentValue = session.data[settingId as keyof SettingsData] as SettingValue<unknown>;

  // Build and show modal
  const modal = buildSettingEditModal(
    config.entityType,
    session.entityId,
    setting,
    currentValue.effectiveValue
  );

  await interaction.showModal(modal);
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
    logger.warn({ customId: interaction.customId }, '[SettingsDashboard] Invalid modal customId');
    return;
  }

  const settingId = parsed.extra;
  if (settingId === undefined) {
    await interaction.reply({
      content: 'Invalid modal submission.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Get session
  const session = getSession(interaction.user.id, config.entityType, parsed.entityId);

  if (session === null) {
    await interaction.reply({
      content: 'This dashboard has expired. Please run the command again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Get the input value
  const inputValue = interaction.fields.getTextInputValue('value');
  const setting = getSettingById(settingId);

  if (setting === undefined) {
    await interaction.reply({
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
    await interaction.reply({
      content: error,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Defer the update to acknowledge we're processing
  await interaction.deferUpdate();

  // Call the update handler
  const result = await updateHandler(interaction, session, settingId, parsedValue);

  if (!result.success) {
    // Since we deferred, we can't easily show an error
    // The dashboard will remain in its previous state
    logger.warn({ settingId, error: result.error }, '[SettingsDashboard] Update failed');
    return;
  }

  // Update session with new data
  if (result.newData !== undefined) {
    session.data = result.newData;
  }
  session.lastActivityAt = new Date();
  storeSession(session, config.entityType, updateHandler);

  // Rebuild the setting view
  const message = buildSettingMessage(config, session, setting);

  await interaction.editReply({
    embeds: message.embeds,
    components: message.components,
  });
}

/**
 * Parse numeric input value
 */
function parseNumericInputValue(
  input: string,
  min: number,
  max: number
): { value?: number | null; error?: string } {
  const trimmed = input.trim().toLowerCase();

  // Empty or "auto" means inherit
  if (trimmed === '' || trimmed === 'auto') {
    return { value: null };
  }

  // Parse as number
  const num = parseInt(trimmed, 10);
  if (Number.isNaN(num)) {
    return { error: `Invalid number: "${input}"` };
  }

  // Validate range
  if (num < min || num > max) {
    return { error: `Value must be between ${min} and ${max}` };
  }

  return { value: num };
}

/**
 * Parse duration input and convert to simple value format
 *
 * Adapts the canonical parseDurationInput from SettingsModalFactory
 * to the format used by this handler (null=auto, -1=off, number=seconds).
 */
function parseDurationInputValue(input: string): { value?: number | null; error?: string } {
  const result = parseDurationInput(input);

  switch (result.type) {
    case 'auto':
      return { value: null };
    case 'off':
      // -1 is a sentinel for "off" - the handler interprets this
      return { value: -1 };
    case 'value':
      return { value: result.seconds };
    case 'error':
      return { error: result.message };
  }
}

// Session storage helpers using existing SessionManager
// We store the update handler separately since it can't be serialized

interface SessionMetadata {
  updateHandler: SettingUpdateHandler;
}

const sessionMetadata = new Map<string, SessionMetadata>();

function getSessionKey(userId: string, entityType: string, entityId: string): string {
  return `${userId}:${entityType}:${entityId}`;
}

function storeSession(
  session: SettingsDashboardSession,
  entityType: string,
  updateHandler: SettingUpdateHandler
): void {
  const manager = getSessionManager();
  manager.set({
    userId: session.userId,
    entityType,
    entityId: session.entityId,
    data: session,
    messageId: session.messageId,
    channelId: session.channelId,
  });

  // Store handler separately
  const key = getSessionKey(session.userId, entityType, session.entityId);
  sessionMetadata.set(key, { updateHandler });
}

function getSession(
  userId: string,
  entityType: string,
  entityId: string
): SettingsDashboardSession | null {
  const manager = getSessionManager();
  const dashboardSession = manager.get<SettingsDashboardSession>(userId, entityType, entityId);
  return dashboardSession?.data ?? null;
}

function deleteSession(userId: string, entityType: string, entityId: string): void {
  const manager = getSessionManager();
  manager.delete(userId, entityType, entityId);

  const key = getSessionKey(userId, entityType, entityId);
  sessionMetadata.delete(key);
}

/**
 * Get the update handler for a session
 */
export function getUpdateHandler(
  userId: string,
  entityType: string,
  entityId: string
): SettingUpdateHandler | undefined {
  const key = getSessionKey(userId, entityType, entityId);
  return sessionMetadata.get(key)?.updateHandler;
}

/**
 * Check if a custom ID belongs to a settings dashboard
 */
export { isSettingsInteraction };
