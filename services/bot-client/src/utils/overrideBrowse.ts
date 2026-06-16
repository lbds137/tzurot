/**
 * Shared per-character override browser (select → clear).
 *
 * `/settings preset browse` and `/voice tts browse` are structurally
 * identical: both list the user's per-character overrides (personality →
 * config) and let the user clear one by selecting it. The only differences
 * are the gateway list/delete calls, the customId prefix, and a few display
 * strings — captured in {@link OverrideBrowseConfig}.
 *
 * Flow:
 *   1. Slash handler renders an embed + select menu of overrides.
 *   2. Selecting an override shows a clear-confirmation (confirm/cancel).
 *   3. Confirm deletes the override and re-renders the browse view; cancel
 *      re-renders without deleting.
 *
 * Clearing an override is reversible (re-set via the `set` subcommand), so the
 * confirmation wording deliberately avoids the "cannot be undone" framing of
 * the shared `buildDeleteConfirmation` helper.
 */

import {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  escapeMarkdown,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { DISCORD_COLORS, type createLogger } from '@tzurot/common-types';
import type { GatewayResult, UserClient } from '@tzurot/clients';
import type { DeferredCommandContext } from './commandContext/types.js';
import { clientsFor } from './gatewayClients.js';
import { buildBrowseSelectMenu } from './browse/index.js';

/** Logger shape produced by {@link createLogger}. */
type Logger = ReturnType<typeof createLogger>;

/**
 * Common shape of a per-character override. Both `ModelOverrideSummary` and
 * `TtsOverrideSummary` are structurally assignable to this.
 */
export interface OverrideSummary {
  personalityId: string;
  personalityName: string;
  configName: string | null;
}

/**
 * Per-domain configuration for the shared override browser. The two callbacks
 * (`list`, `delete`) are the only behavioural divergence between preset and
 * TTS — within the 2-callback ceiling, so a shared helper is the right call.
 */
export interface OverrideBrowseConfig {
  /**
   * customId prefix. Must also be registered in the owning command's
   * `componentPrefixes` so the CommandHandler routes components here.
   */
  prefix: string;
  /** Embed title, e.g. `🎭 Your Preset Overrides`. */
  title: string;
  /** Entity-type noun for the confirm dialog, e.g. `preset override`. */
  entityType: string;
  /** Lowercase noun for the fallback sentence, e.g. `preset`. */
  fallbackNoun: string;
  /** Description shown when the user has no overrides. */
  emptyDescription: string;
  /** Slash-command path used in footer hints, e.g. `/settings preset clear`. */
  clearCommandHint: string;
  /** Select-menu placeholder. */
  selectPlaceholder: string;
  /** Domain logger (e.g. `settings-preset-browse`). */
  logger: Logger;
  /** Fetch the user's overrides. */
  list: (userClient: UserClient) => Promise<GatewayResult<{ overrides: OverrideSummary[] }>>;
  /** Clear one override by personality id. */
  delete: (userClient: UserClient, personalityId: string) => Promise<GatewayResult<unknown>>;
}

const CUSTOM_ID_DELIMITER = '::';

/** Max options Discord allows in one select menu. */
const SELECT_LIMIT = 25;

/** Shown when the overrides list call fails. */
const FAILED_TO_LOAD_MSG = '❌ Failed to load overrides. Please try again later.';

/** Shown when a handler throws unexpectedly (network error, etc.). */
const GENERIC_ERROR_MSG = '❌ An error occurred. Please try again later.';

/**
 * Error payload for component handlers. Explicitly clears `embeds`/`components`
 * so an error replaces the prior view (browse list or confirm dialog) instead
 * of leaving stale — and still clickable — buttons behind. `editReply` merges,
 * so a bare `{ content }` would keep the previous components.
 */
function errorReply(content: string): { content: string; embeds: []; components: [] } {
  return { content, embeds: [], components: [] };
}

/** customId builders/parsers for a given override-browse domain. */
export function createOverrideBrowseCustomIds(prefix: string): {
  select: string;
  cancel: string;
  clear: (personalityId: string) => string;
  isOwn: (customId: string) => boolean;
  parse: (
    customId: string
  ) => { action: 'select' | 'clear' | 'cancel'; personalityId?: string } | null;
} {
  const select = `${prefix}${CUSTOM_ID_DELIMITER}select`;
  const cancel = `${prefix}${CUSTOM_ID_DELIMITER}cancel`;
  return {
    select,
    cancel,
    clear: (personalityId: string) =>
      `${prefix}${CUSTOM_ID_DELIMITER}clear${CUSTOM_ID_DELIMITER}${personalityId}`,
    isOwn: (customId: string) => customId.startsWith(`${prefix}${CUSTOM_ID_DELIMITER}`),
    parse: customId => {
      if (!customId.startsWith(`${prefix}${CUSTOM_ID_DELIMITER}`)) {
        return null;
      }
      const parts = customId.split(CUSTOM_ID_DELIMITER);
      const action = parts[1];
      if (action === 'select' || action === 'cancel') {
        return { action };
      }
      if (action === 'clear' && parts[2] !== undefined && parts[2] !== '') {
        return { action: 'clear', personalityId: parts[2] };
      }
      return null;
    },
  };
}

/** Build the browse embed + (optional) select-menu row for a set of overrides. */
export function buildOverrideBrowseView(
  config: OverrideBrowseConfig,
  overrides: OverrideSummary[]
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle(config.title)
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTimestamp();

  if (overrides.length === 0) {
    embed.setDescription(config.emptyDescription);
    return { embeds: [embed], components: [] };
  }

  const lines = overrides.map(
    o => `**${escapeMarkdown(o.personalityName)}** → ${escapeMarkdown(o.configName ?? 'Unknown')}`
  );
  embed.setDescription(lines.join('\n'));

  // The select menu can only hold 25 options; show the first 25 and point at
  // the autocomplete-based `clear` command for the rest (rare in practice).
  const selectable = overrides.slice(0, SELECT_LIMIT);
  const truncated = overrides.length > SELECT_LIMIT;
  embed.setFooter({
    text: truncated
      ? `${overrides.length} overrides • Select one below to clear it (first ${SELECT_LIMIT} shown; use ${config.clearCommandHint} for the rest)`
      : `${overrides.length} override(s) • Select one below to clear it`,
  });

  const ids = createOverrideBrowseCustomIds(config.prefix);
  const selectRow = buildBrowseSelectMenu<OverrideSummary>({
    items: selectable,
    customId: ids.select,
    placeholder: config.selectPlaceholder,
    startIndex: 0,
    formatItem: o => ({
      label: o.personalityName,
      value: o.personalityId,
      description: `→ ${o.configName ?? 'Unknown'}`,
    }),
  });

  const components = selectRow !== null ? [selectRow] : [];
  return { embeds: [embed], components };
}

/** Slash handler: fetch overrides and render the browse view. */
export async function handleOverrideBrowse(
  config: OverrideBrowseConfig,
  context: DeferredCommandContext
): Promise<void> {
  const userId = context.user.id;
  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await config.list(userClient);
    if (!result.ok) {
      config.logger.warn({ userId, status: result.status }, 'Failed to list overrides');
      await context.editReply({ content: FAILED_TO_LOAD_MSG });
      return;
    }
    const view = buildOverrideBrowseView(config, result.data.overrides);
    await context.editReply(view);
    config.logger.info({ userId, count: result.data.overrides.length }, 'Browsed overrides');
  } catch (error) {
    config.logger.error({ err: error, userId }, 'Error browsing overrides');
    await context.editReply({ content: GENERIC_ERROR_MSG });
  }
}

/** Select-menu handler: show the clear-confirmation for the chosen override. */
export async function handleOverrideBrowseSelect(
  config: OverrideBrowseConfig,
  interaction: StringSelectMenuInteraction
): Promise<void> {
  await interaction.deferUpdate();

  const personalityId = interaction.values[0];
  const userId = interaction.user.id;
  try {
    const { userClient } = clientsFor(interaction);
    const result = await config.list(userClient);
    if (!result.ok) {
      config.logger.warn({ userId, status: result.status }, 'Failed to list overrides for select');
      await interaction.editReply(errorReply(FAILED_TO_LOAD_MSG));
      return;
    }

    const override = result.data.overrides.find(o => o.personalityId === personalityId);
    if (override === undefined) {
      // Already cleared elsewhere — just refresh the list.
      const view = buildOverrideBrowseView(config, result.data.overrides);
      await interaction.editReply({ content: '', ...view });
      return;
    }

    const ids = createOverrideBrowseCustomIds(config.prefix);
    const embed = new EmbedBuilder()
      .setTitle(`Clear ${config.entityType}?`)
      .setColor(DISCORD_COLORS.WARNING)
      .setDescription(
        `Clear the ${config.entityType} for **${escapeMarkdown(override.personalityName)}**?\n\n` +
          `It will fall back to your default ${config.fallbackNoun}. You can re-set it any time.`
      );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ids.cancel)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(ids.clear(personalityId))
        .setLabel('Clear')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️')
    );

    await interaction.editReply({ content: '', embeds: [embed], components: [buttons] });
  } catch (error) {
    config.logger.error({ err: error, userId }, 'Error in override select handler');
    await interaction.editReply(errorReply(GENERIC_ERROR_MSG));
  }
}

/** Button handler: routes clear-confirm and cancel to a fresh browse view. */
export async function handleOverrideBrowseButton(
  config: OverrideBrowseConfig,
  interaction: ButtonInteraction
): Promise<void> {
  const ids = createOverrideBrowseCustomIds(config.prefix);
  const parsed = ids.parse(interaction.customId);
  if (parsed === null || parsed.action === 'select') {
    // Unreachable via the router (select customIds dispatch to the select
    // handler); log if it ever happens so a routing regression is visible.
    config.logger.debug({ customId: interaction.customId }, 'Ignoring non-clear/cancel customId');
    return;
  }

  await interaction.deferUpdate();
  const userId = interaction.user.id;
  try {
    const { userClient } = clientsFor(interaction);

    if (parsed.action === 'clear' && parsed.personalityId !== undefined) {
      const deleteResult = await config.delete(userClient, parsed.personalityId);
      if (!deleteResult.ok) {
        config.logger.warn({ userId, status: deleteResult.status }, 'Failed to clear override');
        await interaction.editReply(
          errorReply('❌ Failed to clear the override. Please try again later.')
        );
        return;
      }
      config.logger.info({ userId, personalityId: parsed.personalityId }, 'Cleared override');
    }

    // Both confirm and cancel land back on a freshly-fetched browse view.
    const result = await config.list(userClient);
    if (!result.ok) {
      config.logger.warn({ userId, status: result.status }, 'Failed to refresh overrides');
      await interaction.editReply(errorReply(FAILED_TO_LOAD_MSG));
      return;
    }
    const view = buildOverrideBrowseView(config, result.data.overrides);
    await interaction.editReply({ content: '', ...view });
  } catch (error) {
    config.logger.error({ err: error, userId }, 'Error in override button handler');
    await interaction.editReply(errorReply(GENERIC_ERROR_MSG));
  }
}
