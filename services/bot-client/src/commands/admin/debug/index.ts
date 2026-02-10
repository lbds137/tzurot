/**
 * Admin Debug Command — Interactive diagnostic log inspector
 *
 * Entry point for `/admin debug <identifier>`.
 * Shows a summary embed with buttons + select menu for drilling into specific views.
 *
 * Exported handlers:
 * - handleDebug() — slash command entry (DeferredCommandContext)
 * - handleDebugButton() — button click handler
 * - handleDebugSelectMenu() — select menu handler
 * - isDebugInteraction() — custom ID guard
 */

import { MessageFlags, type ButtonInteraction, type StringSelectMenuInteraction } from 'discord.js';
import { createLogger, adminDebugOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { DebugCustomIds } from './customIds.js';
import { resolveDiagnosticLog, lookupByRequestId } from './lookup.js';
import { buildDiagnosticEmbed } from './embed.js';
import { buildDebugComponents } from './components.js';
import { DebugViewType } from './types.js';
import {
  buildFullJsonView,
  buildCompactJsonView,
  buildSystemPromptView,
  buildReasoningView,
  buildMemoryInspectorView,
  buildTokenBudgetView,
} from './views.js';

const logger = createLogger('admin-debug');

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
 * Handle `/admin debug <identifier>` — show summary embed with interactive components
 */
export async function handleDebug(context: DeferredCommandContext): Promise<void> {
  const options = adminDebugOptions(context.interaction);
  const identifier = options.identifier();

  if (identifier === '') {
    await context.editReply({
      content:
        '\u274c Identifier is required. Provide a message ID, message link, or request UUID.',
    });
    return;
  }

  try {
    const result = await resolveDiagnosticLog(identifier);

    if (!result.success) {
      await context.editReply({ content: `\u274c ${result.errorMessage}` });
      return;
    }

    const { log } = result;
    const embed = buildDiagnosticEmbed(log.data);
    const components = buildDebugComponents(log.requestId);

    await context.editReply({
      embeds: [embed],
      components,
    });

    logger.info(
      { requestId: log.requestId, personalityId: log.personalityId },
      '[AdminDebug] Diagnostic log retrieved'
    );
  } catch (error) {
    logger.error({ err: error, identifier }, '[AdminDebug] Error fetching diagnostic log');
    await context.editReply({
      content: '\u274c Error fetching diagnostic log. Please try again later.',
    });
  }
}

/**
 * Handle button clicks on the debug embed
 */
export async function handleDebugButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = DebugCustomIds.parseButton(interaction.customId);
  if (parsed === null) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await lookupByRequestId(parsed.requestId);
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
      '[AdminDebug] Error building view'
    );
    await interaction.editReply({
      content: '\u274c Error loading debug view. The log may have expired.',
    });
  }
}

/**
 * Handle select menu choices on the debug embed
 */
export async function handleDebugSelectMenu(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const parsed = DebugCustomIds.parseSelectMenu(interaction.customId);
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
    const result = await lookupByRequestId(parsed.requestId);
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
      '[AdminDebug] Error building view from select'
    );
    await interaction.editReply({
      content: '\u274c Error loading debug view. The log may have expired.',
    });
  }
}

/**
 * Check if a custom ID belongs to the debug module
 */
export function isDebugInteraction(customId: string): boolean {
  return DebugCustomIds.isDebug(customId);
}
