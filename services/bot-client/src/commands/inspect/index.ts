/**
 * Inspect Command — Interactive diagnostic log inspector
 *
 * Top-level `/inspect [identifier]` command available to all users.
 * Without identifier: shows a paginated browse list of recent logs.
 * With identifier: shows a summary embed with buttons + select menu.
 *
 * Access control:
 * - Admin (bot owner): sees all logs
 * - Regular users: see only their own logs
 */

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { createLogger, isBotOwner, inspectOptions } from '@tzurot/common-types';
import { defineCommand } from '../../utils/defineCommand.js';
import type {
  SafeCommandContext,
  DeferredCommandContext,
} from '../../utils/commandContext/types.js';
import { InspectCustomIds } from './customIds.js';
import { resolveDiagnosticLog, lookupByRequestId } from './lookup.js';
import { buildDiagnosticEmbed } from './embed.js';
import { buildInspectComponents } from './components.js';
import {
  handleRecentBrowse,
  handleBrowsePagination,
  handleBrowseLogSelection,
  isInspectBrowseInteraction,
  isInspectBrowseSelectInteraction,
} from './browse.js';
import { DebugViewType } from './types.js';
import {
  buildFullJsonView,
  buildCompactJsonView,
  buildSystemPromptView,
  buildReasoningView,
  buildMemoryInspectorView,
  buildTokenBudgetView,
} from './views.js';

const logger = createLogger('inspect');

/** Map view type to its builder function */
const VIEW_BUILDERS = {
  [DebugViewType.FullJson]: buildFullJsonView,
  [DebugViewType.CompactJson]: buildCompactJsonView,
  [DebugViewType.SystemPrompt]: buildSystemPromptView,
  [DebugViewType.Reasoning]: buildReasoningView,
  [DebugViewType.MemoryInspector]: buildMemoryInspectorView,
  [DebugViewType.TokenBudget]: buildTokenBudgetView,
} as const;

/**
 * Determine the userId filter for a given user.
 * Admin: no filter (sees all). Regular user: filter to own logs.
 */
function getFilterUserId(userId: string): string | undefined {
  return isBotOwner(userId) ? undefined : userId;
}

/**
 * Handle `/inspect [identifier]` — browse recent logs or show specific log
 */
async function execute(ctx: SafeCommandContext): Promise<void> {
  const context = ctx as DeferredCommandContext;
  const userId = context.user.id;
  const filterUserId = getFilterUserId(userId);

  const options = inspectOptions(context.interaction);
  const identifier = options.identifier();

  if (identifier === null || identifier === '') {
    await handleRecentBrowse(context, filterUserId);
    return;
  }

  try {
    const result = await resolveDiagnosticLog(identifier, filterUserId);

    if (!result.success) {
      await context.editReply({ content: `\u274c ${result.errorMessage}` });
      return;
    }

    const { log } = result;
    const embed = buildDiagnosticEmbed(log.data);
    const components = buildInspectComponents(log.requestId);

    await context.editReply({
      embeds: [embed],
      components,
    });

    logger.info(
      { requestId: log.requestId, personalityId: log.personalityId },
      '[Inspect] Diagnostic log retrieved'
    );
  } catch (error) {
    logger.error({ err: error, identifier }, '[Inspect] Error fetching diagnostic log');
    await context.editReply({
      content: '\u274c Error fetching diagnostic log. Please try again later.',
    });
  }
}

/**
 * Handle select menu interactions
 */
async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  // Browse select (must check before general inspect interaction)
  if (isInspectBrowseSelectInteraction(interaction.customId)) {
    const filterUserId = getFilterUserId(interaction.user.id);
    await handleBrowseLogSelection(interaction, filterUserId);
    return;
  }

  // Interactive view select menu
  const parsed = InspectCustomIds.parseSelectMenu(interaction.customId);
  if (parsed === null) {
    return;
  }

  const viewType = interaction.values[0] as DebugViewType;
  if (!Object.values(DebugViewType).includes(viewType)) {
    await interaction.reply({
      content: '\u274c Unknown view type.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const filterUserId = getFilterUserId(interaction.user.id);
    const result = await lookupByRequestId(parsed.requestId, filterUserId);
    if (!result.success) {
      await interaction.editReply({ content: `\u274c ${result.errorMessage}` });
      return;
    }

    const viewResult = VIEW_BUILDERS[viewType](result.log.data, parsed.requestId);
    await interaction.editReply({
      content: viewResult.content,
      files: viewResult.files,
    });
  } catch (error) {
    logger.error(
      { err: error, requestId: parsed.requestId, viewType },
      '[Inspect] Error building view from select'
    );
    await interaction.editReply({
      content: '\u274c Error loading diagnostic view. The log may have expired.',
    });
  }
}

/**
 * Handle button interactions
 */
async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;

  // Browse pagination (must check before general inspect interaction)
  if (isInspectBrowseInteraction(customId)) {
    const filterUserId = getFilterUserId(interaction.user.id);
    await handleBrowsePagination(interaction, filterUserId);
    return;
  }

  // Interactive view buttons
  const parsed = InspectCustomIds.parseButton(customId);
  if (parsed === null) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const filterUserId = getFilterUserId(interaction.user.id);
    const result = await lookupByRequestId(parsed.requestId, filterUserId);
    if (!result.success) {
      await interaction.editReply({ content: `\u274c ${result.errorMessage}` });
      return;
    }

    const viewResult = VIEW_BUILDERS[parsed.viewType](result.log.data, parsed.requestId);
    await interaction.editReply({
      content: viewResult.content,
      files: viewResult.files,
    });
  } catch (error) {
    logger.error(
      { err: error, requestId: parsed.requestId, viewType: parsed.viewType },
      '[Inspect] Error building view'
    );
    await interaction.editReply({
      content: '\u274c Error loading diagnostic view. The log may have expired.',
    });
  }
}

/**
 * Export command definition
 */
export default defineCommand({
  deferralMode: 'ephemeral',
  data: new SlashCommandBuilder()
    .setName('inspect')
    .setDescription('Inspect AI diagnostic logs for your conversations')
    .addStringOption(option =>
      option
        .setName('identifier')
        .setDescription('Message ID, message link, or request UUID (omit to browse recent)')
        .setRequired(false)
    ),
  execute,
  handleSelectMenu,
  handleButton,
});
