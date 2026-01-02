/**
 * Settings Dashboard Builder
 *
 * Builds embeds and components for the settings dashboard.
 * Supports both overview (all settings) and drill-down (single setting) views.
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { Duration } from '@tzurot/common-types';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingValue,
  type SettingDefinition,
  SettingType,
  buildSettingsCustomId,
} from './types.js';
import { EXTENDED_CONTEXT_SETTINGS } from './settingsConfig.js';

/**
 * Format a setting value for display
 */
function formatSettingValue(
  setting: SettingDefinition,
  value: SettingValue<unknown>
): { display: string; status: string } {
  const { localValue, effectiveValue, source } = value;

  // Determine if this level has an override
  const isOverridden = localValue !== null;
  const sourceLabel = source === 'default' ? 'default' : `from ${source}`;

  let display: string;
  let status: string;

  switch (setting.type) {
    case SettingType.TRI_STATE: {
      const boolValue = effectiveValue as boolean;
      display = boolValue ? '✅ Enabled' : '❌ Disabled';
      break;
    }
    case SettingType.NUMERIC: {
      display = String(effectiveValue);
      break;
    }
    case SettingType.DURATION: {
      const durationValue = effectiveValue as number | null;
      if (durationValue === null) {
        display = 'Off (no limit)';
      } else {
        display = Duration.fromSeconds(durationValue).toHuman();
      }
      break;
    }
    default:
      display = String(effectiveValue);
  }

  if (isOverridden) {
    status = '🔵 Override';
  } else {
    status = `⚪ Auto (${sourceLabel})`;
  }

  return { display, status };
}

/**
 * Build the overview embed showing all settings
 */
export function buildOverviewEmbed(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${config.titlePrefix} Settings`)
    .setDescription(
      `Configure extended context settings for **${session.entityName}**.\n` +
        'Select a setting below to modify it.'
    )
    .setColor(config.color)
    .setTimestamp();

  // Add each setting as a field
  for (const setting of config.settings) {
    const value = session.data[setting.id as keyof typeof session.data] as SettingValue<unknown>;
    const { display, status } = formatSettingValue(setting, value);

    embed.addFields({
      name: `${setting.emoji} ${setting.label}`,
      value: `**${display}**\n${status}`,
      inline: true,
    });
  }

  // Add footer with hint
  embed.setFooter({
    text: 'Use the menu below to edit settings',
  });

  return embed;
}

/**
 * Build the drill-down embed for a specific setting
 */
export function buildSettingEmbed(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  setting: SettingDefinition
): EmbedBuilder {
  const value = session.data[setting.id as keyof typeof session.data] as SettingValue<unknown>;
  const { display, status } = formatSettingValue(setting, value);

  const embed = new EmbedBuilder()
    .setTitle(`${setting.emoji} ${setting.label}`)
    .setDescription(setting.description)
    .setColor(config.color)
    .setTimestamp();

  // Current value
  embed.addFields({
    name: 'Current Value',
    value: `**${display}**`,
    inline: true,
  });

  // Status (override or inherited)
  embed.addFields({
    name: 'Status',
    value: status,
    inline: true,
  });

  // Show inherited value if this level has an override
  if (value.localValue !== null && value.source !== 'default') {
    let inheritedDisplay: string;
    switch (setting.type) {
      case SettingType.TRI_STATE: {
        const boolValue = value.effectiveValue as boolean;
        inheritedDisplay = boolValue ? '✅ Enabled' : '❌ Disabled';
        break;
      }
      case SettingType.DURATION: {
        const durationValue = value.effectiveValue as number | null;
        inheritedDisplay = durationValue === null ? 'Off' : Duration.fromSeconds(durationValue).toHuman();
        break;
      }
      default:
        inheritedDisplay = String(value.effectiveValue);
    }
    embed.addFields({
      name: 'Parent Value',
      value: inheritedDisplay,
      inline: true,
    });
  }

  // Add help text if available
  if (setting.helpText !== undefined && setting.helpText.length > 0) {
    embed.addFields({
      name: 'Help',
      value: setting.helpText,
      inline: false,
    });
  }

  embed.setFooter({
    text: `Editing: ${session.entityName}`,
  });

  return embed;
}

/**
 * Build the settings select menu for overview
 */
export function buildSettingsSelectMenu(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildSettingsCustomId(config.entityType, 'select', session.entityId))
    .setPlaceholder('Select a setting to edit...');

  for (const setting of config.settings) {
    const value = session.data[setting.id as keyof typeof session.data] as SettingValue<unknown>;
    const { display } = formatSettingValue(setting, value);

    const option = new StringSelectMenuOptionBuilder()
      .setLabel(setting.label)
      .setValue(setting.id)
      .setDescription(`Current: ${display}`)
      .setEmoji(setting.emoji);

    menu.addOptions(option);
  }

  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu);
}

/**
 * Build tri-state buttons for boolean settings (Auto/On/Off)
 */
export function buildTriStateButtons(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  setting: SettingDefinition
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const value = session.data[setting.id as keyof typeof session.data] as SettingValue<boolean>;
  const localValue = value.localValue;

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  // Auto button (inherit from parent)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildSettingsCustomId(config.entityType, 'set', session.entityId, `${setting.id}:auto`))
      .setLabel('Auto (Inherit)')
      .setEmoji('🔄')
      .setStyle(localValue === null ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  // Enable button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildSettingsCustomId(config.entityType, 'set', session.entityId, `${setting.id}:true`))
      .setLabel('Enable')
      .setEmoji('✅')
      .setStyle(localValue === true ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  // Disable button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildSettingsCustomId(config.entityType, 'set', session.entityId, `${setting.id}:false`))
      .setLabel('Disable')
      .setEmoji('❌')
      .setStyle(localValue === false ? ButtonStyle.Danger : ButtonStyle.Secondary)
  );

  return row;
}

/**
 * Build edit/reset buttons for numeric and duration settings
 */
export function buildEditButtons(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  setting: SettingDefinition
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const value = session.data[setting.id as keyof typeof session.data] as SettingValue<unknown>;
  const hasOverride = value.localValue !== null;

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  // Edit value button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildSettingsCustomId(config.entityType, 'edit', session.entityId, setting.id))
      .setLabel('Edit Value')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Primary)
  );

  // Reset to auto button (only show if there's an override)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildSettingsCustomId(config.entityType, 'set', session.entityId, `${setting.id}:auto`))
      .setLabel('Reset to Auto')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasOverride)
  );

  return row;
}

/**
 * Build back button row
 */
export function buildBackButton(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildSettingsCustomId(config.entityType, 'back', session.entityId))
      .setLabel('Back to Overview')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
  );

  return row;
}

/**
 * Build close button row for overview
 */
export function buildCloseButton(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildSettingsCustomId(config.entityType, 'close', session.entityId))
      .setLabel('Close')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Secondary)
  );

  return row;
}

/**
 * Build complete dashboard message for overview view
 */
export function buildOverviewMessage(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] } {
  const embed = buildOverviewEmbed(config, session);
  const selectMenu = buildSettingsSelectMenu(config, session);
  const closeButton = buildCloseButton(config, session);

  return {
    embeds: [embed],
    components: [selectMenu, closeButton],
  };
}

/**
 * Build complete dashboard message for setting view
 */
export function buildSettingMessage(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  setting: SettingDefinition
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] } {
  const embed = buildSettingEmbed(config, session, setting);
  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  // Add appropriate controls based on setting type
  if (setting.type === SettingType.TRI_STATE) {
    components.push(buildTriStateButtons(config, session, setting));
  } else {
    components.push(buildEditButtons(config, session, setting));
  }

  // Always add back button
  components.push(buildBackButton(config, session));

  return {
    embeds: [embed],
    components,
  };
}

/**
 * Get setting definition by ID
 */
export function getSettingById(settingId: string): SettingDefinition | undefined {
  return EXTENDED_CONTEXT_SETTINGS.find(s => s.id === settingId);
}
