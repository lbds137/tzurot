/**
 * Settings dashboard button-row builders — the per-setting-type control rows
 * (tri-state / boolean / enum / edit) and the navigation rows (back / close /
 * pagination). Extracted from SettingsDashboardBuilder to keep it within the
 * max-lines budget; the Builder's message assemblers compose these.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingValue,
  type SettingDefinition,
  buildSettingsCustomId,
  clampPage,
  isPlainSetting,
} from './types.js';

/**
 * Build tri-state buttons for boolean settings (Auto/On/Off)
 */
export function buildTriStateButtons(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  setting: SettingDefinition
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const value = session.data[setting.id] as SettingValue<boolean> | undefined;
  const localValue = value?.localValue ?? null;

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  // Auto button (inherit from parent)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(
        buildSettingsCustomId(config.entityType, 'set', session.entityId, `${setting.id}:auto`)
      )
      .setLabel('Auto (Inherit)')
      .setEmoji('🔄')
      .setStyle(localValue === null ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  // Enable button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(
        buildSettingsCustomId(config.entityType, 'set', session.entityId, `${setting.id}:true`)
      )
      .setLabel('Enable')
      .setEmoji('✅')
      .setStyle(localValue === true ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  // Disable button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(
        buildSettingsCustomId(config.entityType, 'set', session.entityId, `${setting.id}:false`)
      )
      .setLabel('Disable')
      .setEmoji('❌')
      .setStyle(localValue === false ? ButtonStyle.Danger : ButtonStyle.Secondary)
  );

  return row;
}

/**
 * Build two-state buttons for BOOLEAN settings (On/Off — no Auto: these are
 * non-cascading values with no inherit tier).
 */
export function buildBooleanButtons(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  setting: SettingDefinition
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const value = session.data[setting.id] as SettingValue<boolean> | undefined;
  const current = value?.effectiveValue;

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(
        buildSettingsCustomId(config.entityType, 'set', session.entityId, `${setting.id}:true`)
      )
      .setLabel('Enable')
      .setEmoji('✅')
      .setStyle(current === true ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(
        buildSettingsCustomId(config.entityType, 'set', session.entityId, `${setting.id}:false`)
      )
      .setLabel('Disable')
      .setEmoji('❌')
      .setStyle(current === false ? ButtonStyle.Danger : ButtonStyle.Secondary)
  );

  return row;
}

/**
 * Build the page-navigation row for paged configs: ◀ Prev / disabled
 * `Page N/M · <Label>` indicator / Next ▶. All Secondary (navigation per the
 * button vocabulary); three DISTINCT customIds — Discord rejects duplicate
 * customIds within one message, so the disabled indicator carries `noop`.
 */
export function buildPaginationRow(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const page = clampPage(config, session.page);
  const pageCount = config.pages?.length ?? 1;
  const label = config.pages?.[page]?.label ?? '';

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildSettingsCustomId(config.entityType, 'page', session.entityId, 'prev'))
      .setLabel('Prev')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0)
  );

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildSettingsCustomId(config.entityType, 'page', session.entityId, 'noop'))
      .setLabel(`Page ${page + 1}/${pageCount} · ${label}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildSettingsCustomId(config.entityType, 'page', session.entityId, 'next'))
      .setLabel('Next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pageCount - 1)
  );

  return row;
}

/** Discord limits action rows to 5 buttons */
const DISCORD_MAX_BUTTONS_PER_ROW = 5;

/** Values reserved by handleSetButton's switch — mapped to non-string types */
const RESERVED_ENUM_VALUES = ['auto', 'true', 'false'] as const;

/**
 * Build enum buttons for enum settings (Auto + one per choice)
 */
export function buildEnumButtons(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  setting: SettingDefinition
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const choices = setting.choices ?? [];
  // Plain settings (non-cascading bags) have no inherit tier — no Auto button.
  const includeAuto = !isPlainSetting(config, setting);
  const totalButtons = (includeAuto ? 1 : 0) + choices.length;
  if (totalButtons > DISCORD_MAX_BUTTONS_PER_ROW) {
    throw new Error(
      `ENUM setting "${setting.id}" has ${choices.length} choices — ` +
        `exceeds Discord's ${DISCORD_MAX_BUTTONS_PER_ROW}-button row limit`
    );
  }

  for (const choice of choices) {
    if ((RESERVED_ENUM_VALUES as readonly string[]).includes(choice.value)) {
      throw new Error(
        `ENUM setting "${setting.id}" has reserved choice value "${choice.value}" — ` +
          `"auto", "true", and "false" are reserved by the settings handler`
      );
    }
  }

  // Cast required: dynamic key lookup can't narrow the generic type param.
  // Same pattern as buildTriStateButtons. Safe because ENUM settings use string values.
  const value = session.data[setting.id] as SettingValue<string> | undefined;
  const localValue = value?.localValue ?? null;

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  // Auto button (inherit from parent) — cascade mode only
  if (includeAuto) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(
          buildSettingsCustomId(config.entityType, 'set', session.entityId, `${setting.id}:auto`)
        )
        .setLabel('Auto (Inherit)')
        .setEmoji('🔄')
        .setStyle(localValue === null ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  }

  // One button per choice
  for (const choice of choices) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(
          buildSettingsCustomId(
            config.entityType,
            'set',
            session.entityId,
            `${setting.id}:${choice.value}`
          )
        )
        .setLabel(choice.label)
        .setEmoji(choice.emoji)
        .setStyle(localValue === choice.value ? ButtonStyle.Success : ButtonStyle.Secondary)
    );
  }

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
  const value = session.data[setting.id];
  // Presence, not value: a stored null (explicit OFF) IS an override — the
  // Reset-to-Auto button must stay enabled for it.
  const hasOverride = value?.hasLocalOverride === true;

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  // Edit value button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildSettingsCustomId(config.entityType, 'edit', session.entityId, setting.id))
      .setLabel('Edit Value')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Primary)
  );

  // Reset to auto button — cascade mode only. A non-cascading bag has no
  // "auto" to reset to; rendering it there would be a first-class broken
  // button (null is rejected by the system write path by design).
  if (!isPlainSetting(config, setting)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(
          buildSettingsCustomId(config.entityType, 'set', session.entityId, `${setting.id}:auto`)
        )
        .setLabel('Reset to Auto')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasOverride)
    );
  }

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
