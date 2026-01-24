/**
 * Dashboard Builder
 *
 * Creates consistent dashboard embeds for entity editing.
 * Reusable across /character, /profile, /preset, etc.
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
import { DISCORD_COLORS } from '@tzurot/common-types';
import {
  type DashboardConfig,
  STATUS_EMOJI,
  SectionStatus,
  buildDashboardCustomId,
} from './types.js';

/**
 * Build a dashboard embed for an entity
 */
export function buildDashboardEmbed<T>(config: DashboardConfig<T>, data: T): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(config.getTitle(data))
    .setColor(config.color ?? DISCORD_COLORS.BLURPLE)
    .setTimestamp();

  // Add description if provided
  if (config.getDescription) {
    embed.setDescription(config.getDescription(data));
  }

  // Add section fields
  for (const section of config.sections) {
    const status = section.getStatus(data);
    const statusEmoji = STATUS_EMOJI[status];
    const preview = section.getPreview(data);

    embed.addFields({
      name: `${section.label} ${statusEmoji}`,
      value: preview || '_Not configured_',
      inline: false,
    });
  }

  // Add footer if provided
  if (config.getFooter) {
    embed.setFooter({ text: config.getFooter(data) });
  }

  return embed;
}

/**
 * Extract emoji from the beginning of a label string
 * Returns the emoji and the label without the emoji
 */
function extractLabelEmoji(label: string): { emoji: string | null; cleanLabel: string } {
  // Match emoji at start of string (Unicode emoji or Discord custom emoji format)
  const emojiRegex = /^([^\w\s]+)\s*/;
  const emojiMatch = emojiRegex.exec(label);
  if (emojiMatch !== null) {
    return {
      emoji: emojiMatch[1],
      cleanLabel: label.replace(emojiRegex, ''),
    };
  }
  return { emoji: null, cleanLabel: label };
}

/**
 * Build the edit selection menu for a dashboard
 */
export function buildEditMenu<T>(
  config: DashboardConfig<T>,
  entityId: string,
  data: T
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildDashboardCustomId(config.entityType, 'menu', entityId))
    .setPlaceholder('Select a section to edit...');

  // Add section options
  for (const section of config.sections) {
    // Extract the section's own emoji from its label (e.g., "🏷️ Identity & Basics" -> "🏷️")
    const { emoji: sectionEmoji, cleanLabel } = extractLabelEmoji(section.label);

    const option = new StringSelectMenuOptionBuilder()
      .setLabel(cleanLabel)
      .setValue(`edit-${section.id}`)
      .setDescription(section.description ?? `Edit ${section.label.toLowerCase()}`);

    // Use section emoji if available, otherwise fall back to status emoji
    if (sectionEmoji !== null) {
      option.setEmoji(sectionEmoji);
    } else {
      const status = section.getStatus(data);
      option.setEmoji(STATUS_EMOJI[status]);
    }

    menu.addOptions(option);
  }

  // Add action options if defined
  if (config.actions && config.actions.length > 0) {
    for (const action of config.actions) {
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(action.label)
        .setValue(`action-${action.id}`)
        .setDescription(action.description);

      if (action.emoji !== undefined && action.emoji.length > 0) {
        option.setEmoji(action.emoji);
      }

      menu.addOptions(option);
    }
  }

  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu);
}

/**
 * Options for building dashboard action buttons
 */
export interface ActionButtonOptions {
  showDelete?: boolean;
  showClose?: boolean;
  showRefresh?: boolean;
  showClone?: boolean;
  /** Show "Back to Browse" button instead of close (when opened from browse) */
  showBack?: boolean;
  /** If defined, shows a toggle button with state-appropriate label */
  toggleGlobal?: {
    /** Current global state */
    isGlobal: boolean;
    /** Only show if user owns the entity */
    isOwned: boolean;
  };
}

/**
 * Build action buttons row (for common actions like Save, Delete, Close)
 */
export function buildActionButtons<T>(
  config: DashboardConfig<T>,
  entityId: string,
  options?: ActionButtonOptions
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();

  if (options?.showRefresh === true) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildDashboardCustomId(config.entityType, 'refresh', entityId))
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄')
    );
  }

  if (options?.showClone === true) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildDashboardCustomId(config.entityType, 'clone', entityId))
        .setLabel('Clone')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📋')
    );
  }

  // Toggle Global button - only for owned entities
  if (options?.toggleGlobal?.isOwned === true) {
    const { isGlobal } = options.toggleGlobal;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildDashboardCustomId(config.entityType, 'toggle-global', entityId))
        .setLabel(isGlobal ? 'Make Private' : 'Make Global')
        .setStyle(isGlobal ? ButtonStyle.Secondary : ButtonStyle.Primary)
        .setEmoji(isGlobal ? '🔒' : '🌐')
    );
  }

  // Back to Browse button - shown when opened from browse view
  if (options?.showBack === true) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildDashboardCustomId(config.entityType, 'back', entityId))
        .setLabel('Back to Browse')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('◀️')
    );
  }

  if (options?.showClose === true) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildDashboardCustomId(config.entityType, 'close', entityId))
        .setLabel('Close')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('✖️')
    );
  }

  if (options?.showDelete === true) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildDashboardCustomId(config.entityType, 'delete', entityId))
        .setLabel('Delete')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️')
    );
  }

  return row;
}

/**
 * Build complete dashboard message components
 */
export function buildDashboardComponents<T>(
  config: DashboardConfig<T>,
  entityId: string,
  data: T,
  options?: ActionButtonOptions
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  // Always add the edit menu
  components.push(buildEditMenu(config, entityId, data));

  // Add action buttons if any options are enabled
  const hasButtonOptions =
    options?.showDelete === true ||
    options?.showClose === true ||
    options?.showRefresh === true ||
    options?.showBack === true ||
    options?.showClone === true ||
    options?.toggleGlobal !== undefined;

  if (hasButtonOptions) {
    components.push(buildActionButtons(config, entityId, options));
  }

  return components;
}

/**
 * Get overall completion status for an entity
 */
export function getOverallStatus<T>(
  config: DashboardConfig<T>,
  data: T
): {
  status: SectionStatus;
  completedCount: number;
  totalCount: number;
  percentage: number;
} {
  let completedCount = 0;
  const totalCount = config.sections.length;

  for (const section of config.sections) {
    const status = section.getStatus(data);
    if (status === SectionStatus.COMPLETE) {
      completedCount++;
    }
  }

  const percentage = Math.round((completedCount / totalCount) * 100);

  let status: SectionStatus;
  if (completedCount === totalCount) {
    status = SectionStatus.COMPLETE;
  } else if (completedCount > 0) {
    status = SectionStatus.PARTIAL;
  } else {
    status = SectionStatus.EMPTY;
  }

  return { status, completedCount, totalCount, percentage };
}
