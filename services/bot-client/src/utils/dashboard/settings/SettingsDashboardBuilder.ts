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
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { Duration } from '@tzurot/common-types/utils/Duration';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingValue,
  type SettingDefinition,
  type SettingSource,
  SettingType,
  buildSettingsCustomId,
  clampPage,
  getPageSettings,
  isPlainSetting,
} from './types.js';
import {
  buildTriStateButtons,
  buildEnumButtons,
  buildEditButtons,
  buildBackButton,
  buildBooleanButtons,
  buildPaginationRow,
} from './settingsButtonBuilders.js';

/**
 * Map cascade source to a user-friendly display name.
 */
function friendlySourceName(source: SettingSource): string {
  switch (source) {
    case 'admin':
      return 'admin';
    case 'personality':
      return 'personality';
    case 'channel':
      return 'channel';
    case 'user-default':
      return 'your defaults';
    case 'user-personality':
      return 'your override';
    case 'hardcoded':
      return 'default';
  }
}

/**
 * Format a setting value for display.
 *
 * `status` is null in 'plain' mode (non-cascading bags — override/inherit
 * semantics would be false) and when the value is missing entirely (a session
 * written by pre-deploy code can lack keys added since; render a placeholder
 * for the 15-min TTL window instead of crashing mid-render).
 */
function formatSettingValue(
  config: SettingsDashboardConfig,
  setting: SettingDefinition,
  value: SettingValue<unknown> | undefined
): { display: string; status: string | null } {
  if (value === undefined) {
    return { display: '—', status: null };
  }
  const { hasLocalOverride, effectiveValue, source } = value;

  let display: string;
  let status: string | null;

  switch (setting.type) {
    case SettingType.TRI_STATE:
    case SettingType.BOOLEAN: {
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
    case SettingType.ENUM: {
      const choice = setting.choices?.find(c => c.value === effectiveValue);
      display = choice !== undefined ? `${choice.emoji} ${choice.label}` : String(effectiveValue);
      break;
    }
    default:
      display = String(effectiveValue);
  }

  if (isPlainSetting(config, setting)) {
    status = null;
  } else if (hasLocalOverride) {
    status = '🔵 Override';
  } else if (source === 'hardcoded') {
    status = '⚪ Auto (default)';
  } else {
    status = `⚪ Auto (from ${friendlySourceName(source)})`;
  }

  return { display, status };
}

/**
 * Resolve the paged-view chrome (title + footer) for the overview embed —
 * flat configs get the bare title/hint, paged configs get the page label
 * and `Page N/M` indicator.
 */
function resolvePageChrome(
  config: SettingsDashboardConfig,
  page: number
): { title: string; footerText: string } {
  const currentPage = config.pages?.[page];
  if (currentPage === undefined) {
    return {
      title: `${config.titlePrefix} Settings`,
      footerText: 'Use the menu below to edit settings',
    };
  }
  const pageCount = config.pages?.length ?? 0;
  return {
    title: `${config.titlePrefix} Settings · ${currentPage.label}`,
    footerText: `Page ${page + 1}/${pageCount} · ${currentPage.label} — use the menu below to edit settings`,
  };
}

/**
 * Build the overview embed showing all settings
 */
export function buildOverviewEmbed(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): EmbedBuilder {
  const baseDescription =
    config.overviewDescription ??
    `Configure extended context settings for **${session.entityName}**.`;
  let description = `${baseDescription}\nSelect a setting below to modify it.`;
  if (config.descriptionNote !== undefined && config.descriptionNote.length > 0) {
    description += `\n\n${config.descriptionNote}`;
  }

  const page = clampPage(config, session.page);
  const { title, footerText } = resolvePageChrome(config, page);

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(config.color)
    .setTimestamp();

  // Add each visible setting as a field (current page only for paged configs)
  for (const setting of getPageSettings(config, page)) {
    const value = session.data[setting.id];
    const { display, status } = formatSettingValue(config, setting, value);

    embed.addFields({
      name: `${setting.emoji} ${setting.label}`,
      value: status === null ? `**${display}**` : `**${display}**\n${status}`,
      inline: true,
    });
  }

  // Add footer with hint (+ page indicator on paged configs)
  embed.setFooter({ text: footerText });

  return embed;
}

/**
 * Format the inherited (parent-cascade) value for the drill-down's
 * "Parent Value" field — the effectiveValue rendered per setting type.
 */
function formatInheritedDisplay(setting: SettingDefinition, effectiveValue: unknown): string {
  switch (setting.type) {
    case SettingType.TRI_STATE:
      return (effectiveValue as boolean) ? '✅ Enabled' : '❌ Disabled';
    case SettingType.DURATION: {
      const durationValue = effectiveValue as number | null;
      return durationValue === null ? 'Off' : Duration.fromSeconds(durationValue).toHuman();
    }
    case SettingType.ENUM: {
      const choice = setting.choices?.find(c => c.value === effectiveValue);
      return choice !== undefined ? `${choice.emoji} ${choice.label}` : String(effectiveValue);
    }
    default:
      return String(effectiveValue);
  }
}

/**
 * Build the drill-down embed for a specific setting
 */
export function buildSettingEmbed(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  setting: SettingDefinition
): EmbedBuilder {
  const value = session.data[setting.id];
  const { display, status } = formatSettingValue(config, setting, value);

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

  // Status (override or inherited) — omitted entirely in plain mode, where
  // cascade semantics don't apply (and for missing stale-session values)
  if (status !== null) {
    embed.addFields({
      name: 'Status',
      value: status,
      inline: true,
    });
  }

  // Show inherited value if this level has an override (cascade mode only —
  // the plain adapter's hasLocalOverride shape would render a nonsense
  // "Parent Value: <same value>" for a non-cascading bag)
  if (
    !isPlainSetting(config, setting) &&
    value !== undefined &&
    value.hasLocalOverride &&
    value.source !== 'hardcoded'
  ) {
    embed.addFields({
      name: 'Parent Value',
      value: formatInheritedDisplay(setting, value.effectiveValue),
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

/** Discord's hard cap on select-menu options */
const DISCORD_SELECT_OPTIONS_LIMIT = 25;

/**
 * Build the settings select menu for overview — scoped to the current page on
 * paged configs (§3.3: "the section select scopes to the current page").
 */
export function buildSettingsSelectMenu(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildSettingsCustomId(config.entityType, 'select', session.entityId))
    .setPlaceholder('Select a setting to edit...');

  const visibleSettings = getPageSettings(config, clampPage(config, session.page));
  if (visibleSettings.length > DISCORD_SELECT_OPTIONS_LIMIT) {
    // Programmer error: a page (or flat config) grew past Discord's cap — the
    // fix is page composition, not silent truncation (mirrors the browse guard).
    throw new Error(
      `Settings select for "${config.entityType}" has ${visibleSettings.length} options — ` +
        `exceeds Discord's ${DISCORD_SELECT_OPTIONS_LIMIT}-option limit; split into pages`
    );
  }

  for (const setting of visibleSettings) {
    const value = session.data[setting.id];
    const { display } = formatSettingValue(config, setting, value);

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
 * Build complete dashboard message for overview view
 */
export function buildOverviewMessage(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] } {
  const embed = buildOverviewEmbed(config, session);
  const selectMenu = buildSettingsSelectMenu(config, session);

  // No Close row (D18 complete): ephemeral dashboards need no explicit
  // Close — native dismiss suffices and the Redis session TTL handles
  // teardown. The 'close' action stays routable for pre-removal messages.
  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [selectMenu];
  if (config.pages !== undefined && config.pages.length > 0) {
    components.push(buildPaginationRow(config, session));
  }

  return {
    embeds: [embed],
    components,
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

  // Add appropriate controls based on setting type. BOOLEAN gets an explicit
  // branch — falling through to the modal edit buttons would render a text
  // editor for a two-state flag.
  if (setting.type === SettingType.TRI_STATE) {
    components.push(buildTriStateButtons(config, session, setting));
  } else if (setting.type === SettingType.BOOLEAN) {
    components.push(buildBooleanButtons(config, session, setting));
  } else if (setting.type === SettingType.ENUM) {
    components.push(buildEnumButtons(config, session, setting));
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
 * Get a setting definition by ID — scoped to THIS dashboard's config. The old
 * global ALL_SETTINGS lookup let a forged/stale customId address a setting the
 * dashboard deliberately excludes (e.g. the admin-only voice toggle via the
 * user-defaults entityType); config-scoping makes exclusion real.
 */
export function getSettingById(
  config: SettingsDashboardConfig,
  settingId: string
): SettingDefinition | undefined {
  return config.settings.find(s => s.id === settingId);
}
