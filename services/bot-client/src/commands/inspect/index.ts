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

import {
  SlashCommandBuilder,
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { inspectOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { defineCommand } from '../../utils/defineCommand.js';
import type {
  SafeCommandContext,
  DeferredCommandContext,
} from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { replyError } from '../../utils/dashboard/replyError.js';
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
  buildVoiceAttributionView,
  type DebugViewResult,
} from './views.js';
import { sendChunkedReply } from '../../utils/chunkedReply.js';
import {
  buildPipelineHealthView,
  buildInputView,
  buildGenerationParamsView,
  buildPostProcessingView,
} from './extendedViews.js';
import { computeViewContext } from './viewContext.js';

const logger = createLogger('inspect');

/**
 * Render one view result onto an already-acked component interaction.
 * `chunkedText` goes through the chunked-reply path (inline text, split
 * across ephemeral follow-ups when long — components ride the first chunk);
 * everything else is a single editReply. Passing components: [] clears any
 * prior rows when the user switches views on the same message.
 */
async function renderViewResult(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  viewResult: DebugViewResult
): Promise<void> {
  if (viewResult.chunkedText !== undefined) {
    await sendChunkedReply({
      interaction,
      content: viewResult.chunkedText.text,
      header: '',
      continuedHeader: viewResult.chunkedText.continuedHeader,
      components: viewResult.components ?? [],
      maxChunks: viewResult.chunkedText.maxChunks,
      overflowFilename: viewResult.chunkedText.overflowFilename,
    });
    return;
  }
  await interaction.editReply({
    content: viewResult.content,
    embeds: viewResult.embeds ?? [],
    files: viewResult.files,
    components: viewResult.components ?? [],
  });
}

/** Map view type to its builder function */
const VIEW_BUILDERS = {
  [DebugViewType.FullJson]: buildFullJsonView,
  [DebugViewType.CompactJson]: buildCompactJsonView,
  [DebugViewType.SystemPrompt]: buildSystemPromptView,
  [DebugViewType.Reasoning]: buildReasoningView,
  [DebugViewType.Input]: buildInputView,
  [DebugViewType.GenerationParams]: buildGenerationParamsView,
  [DebugViewType.PostProcessing]: buildPostProcessingView,
  [DebugViewType.MemoryInspector]: buildMemoryInspectorView,
  [DebugViewType.TokenBudget]: buildTokenBudgetView,
  [DebugViewType.VoiceAttribution]: buildVoiceAttributionView,
  [DebugViewType.PipelineHealth]: buildPipelineHealthView,
} as const;

/**
 * Handle `/inspect [identifier]` — browse recent logs or show specific log.
 *
 * The caller's Discord ID is forwarded to the gateway, which applies
 * per-user filtering server-side (bot owner sees all logs; other users see
 * only their own). No client-side filtering needed.
 */
async function execute(ctx: SafeCommandContext): Promise<void> {
  const context = ctx as DeferredCommandContext;
  const { userClient } = clientsFor(context.interaction);

  const options = inspectOptions(context.interaction);
  const identifier = options.identifier();

  if (identifier === null || identifier === '') {
    await handleRecentBrowse(context, userClient);
    return;
  }

  try {
    const result = await resolveDiagnosticLog(identifier, userClient);

    if (!result.success) {
      await context.editReply({ content: `\u274c ${result.errorMessage}` });
      return;
    }

    const { log } = result;
    const embed = buildDiagnosticEmbed(log.data);
    const components = buildInspectComponents(
      log.requestId,
      log.data.postProcessing.thinkingContent?.length ?? 0
    );

    await context.editReply({
      embeds: [embed],
      components,
    });

    logger.info(
      { requestId: log.requestId, personalityId: log.personalityId },
      'Diagnostic log retrieved'
    );
  } catch (error) {
    logger.error({ err: error, identifier }, 'Error fetching diagnostic log');
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
    await handleBrowseLogSelection(interaction);
    return;
  }

  // Interactive view select menu
  const parsed = InspectCustomIds.parseSelectMenu(interaction.customId);
  if (parsed === null) {
    return;
  }

  const viewType = interaction.values[0] as DebugViewType;
  if (!Object.values(DebugViewType).includes(viewType)) {
    await replyError(interaction, '\u274c Unknown view type.');
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { userClient } = clientsFor(interaction);
  try {
    const result = await lookupByRequestId(parsed.requestId, userClient);
    if (!result.success) {
      await replyError(interaction, `\u274c ${result.errorMessage}`);
      return;
    }

    // Defense in depth: re-evaluate ownership against the CLICKER's id, not the
    // original /inspect invoker. Ephemeral replies already prevent other users
    // from seeing the buttons, but each click revalidates.
    const ctx = computeViewContext(result.log, interaction.user.id);
    // Picking MemoryInspector from the select menu always starts at DEFAULT_MEMORY_STATE.
    // Filter / sort / Top-N state is only preserved when navigating between memory-inspector
    // buttons (handleButton below threads parsed.memoryState through).
    const viewResult = VIEW_BUILDERS[viewType](result.log.data, parsed.requestId, ctx);
    await renderViewResult(interaction, viewResult);
  } catch (error) {
    logger.error(
      { err: error, requestId: parsed.requestId, viewType },
      'Error building view from select'
    );
    await replyError(
      interaction,
      '\u274c Error loading diagnostic view. The log may have expired.'
    );
  }
}

/**
 * Handle button interactions
 */
async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;

  // Browse pagination (must check before general inspect interaction)
  if (isInspectBrowseInteraction(customId)) {
    await handleBrowsePagination(interaction);
    return;
  }

  // Interactive view buttons
  const parsed = InspectCustomIds.parseButton(customId);
  if (parsed === null) {
    return;
  }

  // Memory-state filter buttons mutate the existing view in place — use deferUpdate
  // so editReply edits the message that owns the button rather than spawning a new
  // ephemeral per click. View-navigation buttons (Reasoning, FullJson, etc.) keep
  // deferReply because they semantically open a new view as a separate ephemeral.
  if (parsed.memoryState !== undefined) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const { userClient } = clientsFor(interaction);
  try {
    const result = await lookupByRequestId(parsed.requestId, userClient);
    if (!result.success) {
      await interaction.editReply({ content: `\u274c ${result.errorMessage}` });
      return;
    }

    // See handleSelectMenu — same defense-in-depth re-evaluation.
    const ctx = computeViewContext(result.log, interaction.user.id);
    const viewResult =
      parsed.viewType === DebugViewType.MemoryInspector
        ? buildMemoryInspectorView(result.log.data, parsed.requestId, ctx, parsed.memoryState)
        : VIEW_BUILDERS[parsed.viewType](result.log.data, parsed.requestId, ctx);
    await renderViewResult(interaction, viewResult);
  } catch (error) {
    logger.error(
      { err: error, requestId: parsed.requestId, viewType: parsed.viewType },
      'Error building view'
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
