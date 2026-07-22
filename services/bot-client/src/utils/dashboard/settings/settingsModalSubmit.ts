/**
 * Settings modal-submit flow: parse the typed value per setting type, dispatch
 * to the update handler, and — on ANY rejection (client parse or update-handler
 * failure) — preserve the user's input behind a Try-again button (design-system
 * D15: losing typed input to a validation error is the most hostile modal
 * behavior). Extracted from SettingsDashboardHandler to keep that file within
 * the max-lines budget and this flow independently testable.
 */

import {
  type ModalSubmitInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  type SettingDefinition,
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingUpdateHandler,
  parseSettingsCustomId,
  buildSettingsCustomId,
  SettingType,
  isPlainSetting,
} from './types.js';
import { buildSettingMessage, getSettingById } from './SettingsDashboardBuilder.js';
import { storeSession, getSession } from './SettingsSessionStorage.js';
import { parseNumericInputValue, parseDurationInputValue } from './settingsInputParser.js';
import { ackUpdate } from '../../../ux/render/reply.js';

const logger = createLogger('SettingsModalSubmit');

/**
 * Parse a modal input string per the setting's type. TEXT gets an explicit
 * branch — the old fallthrough left the value undefined, and JSON
 * serialization silently DROPS undefined keys, yielding an empty patch at the
 * gateway. TRI_STATE/BOOLEAN/ENUM never open modals, so they never reach here.
 */
function parseModalValue(
  setting: SettingDefinition,
  inputValue: string
): { value?: unknown; error?: string } {
  switch (setting.type) {
    case SettingType.NUMERIC:
      return parseNumericInputValue(inputValue, setting.min ?? 0, setting.max ?? 100);
    case SettingType.DURATION:
      return parseDurationInputValue(inputValue);
    case SettingType.TEXT: {
      // Free-text values (model ids): trimmed verbatim; deep validation is the
      // update handler's job (gateway catalog rules).
      const trimmed = inputValue.trim();
      return trimmed.length === 0 ? { error: 'Value cannot be empty.' } : { value: trimmed };
    }
    default:
      return { value: undefined, error: 'This setting is not edited via a form.' };
  }
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
  await ackUpdate(interaction);

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
  const setting = getSettingById(config, settingId);

  if (setting === undefined) {
    await interaction.followUp({
      content: 'Unknown setting.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Parse based on setting type
  const parsedInput = parseModalValue(setting, inputValue);
  let error = parsedInput.error;

  // Empty NUMERIC/DURATION input parses to null ("reset to auto") — valid for
  // cascade tiers, meaningless for a non-cascading bag. Catch it here with the
  // same friendly shape as the button-path guard.
  if (error === undefined && parsedInput.value === null && isPlainSetting(config, setting)) {
    error = 'This setting has no Auto — enter an explicit value.';
  }

  if (error !== undefined) {
    await sendRejectionWithRetry({ interaction, config, session, settingId, inputValue, error });
    return;
  }

  // Call the update handler (interaction was already deferUpdate'd above)
  const result = await updateHandler(interaction, session, settingId, parsedInput.value);

  if (!result.success) {
    // Update-handler rejection (gateway validation, 409, network): offer the
    // same preserve-input retry as a client-side parse failure.
    await sendRejectionWithRetry({
      interaction,
      config,
      session,
      settingId,
      inputValue,
      error: result.error ?? 'Update failed.',
    });
    return;
  }

  // Update session with new data; a success clears any pending rejected input
  if (result.newData !== undefined) {
    session.data = result.newData;
  }
  session.lastRejectedInput = undefined;
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  // Rebuild the setting view
  const message = buildSettingMessage(config, session, setting);

  await interaction.editReply({
    embeds: message.embeds,
    components: message.components,
  });
}

/** Everything a rejection notice needs (options object per max-params). */
interface RejectionOptions {
  interaction: ModalSubmitInteraction;
  config: SettingsDashboardConfig;
  session: SettingsDashboardSession;
  settingId: string;
  inputValue: string;
  error: string;
}

/**
 * Deliver a rejected-value notice with a Try-again button (D15: preserve the
 * user's typed input across validation failures). The rejected value is stored
 * in the session; the retry button re-opens the modal prefilled with it. The
 * error text names the reason (never a bare "invalid").
 */
async function sendRejectionWithRetry(options: RejectionOptions): Promise<void> {
  const { interaction, config, session, settingId, inputValue, error } = options;
  session.lastRejectedInput = { settingId, value: inputValue };
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  const retryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildSettingsCustomId(config.entityType, 'retry', session.entityId, settingId))
      .setLabel('Try again')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.followUp({
    content: `❌ ${error}`,
    components: [retryRow],
    flags: MessageFlags.Ephemeral,
  });
}
