/**
 * Admin Debug Subcommand
 * Handles /admin debug - Retrieve LLM diagnostic logs for debugging prompt issues
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 *
 * The diagnostic log contains the full "flight recorder" data:
 * - Input processing (user message, attachments, references)
 * - Memory retrieval (what memories were found, scores, which were included)
 * - Token budget (how tokens were allocated)
 * - Assembled prompt (the EXACT messages sent to the LLM)
 * - LLM configuration (model, temperature, etc.)
 * - Raw LLM response (before any post-processing)
 * - Post-processing (what transforms were applied)
 */

import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { createLogger, type DiagnosticPayload } from '@tzurot/common-types';
import { adminFetch } from '../../utils/adminApiClient.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-debug');

interface DiagnosticLogResponse {
  log: {
    id: string;
    requestId: string;
    personalityId: string | null;
    userId: string | null;
    guildId: string | null;
    channelId: string | null;
    model: string;
    provider: string;
    durationMs: number;
    createdAt: string;
    data: DiagnosticPayload;
  };
}

/**
 * Build a summary embed with key diagnostic stats
 */
function buildDiagnosticEmbed(payload: DiagnosticPayload): EmbedBuilder {
  const { meta, memoryRetrieval, tokenBudget, llmConfig, llmResponse, timing } = payload;

  // Calculate token budget percentages for the "danger zone" indicator
  const totalTokens = tokenBudget.contextWindowSize || 1;
  const historyPercent = Math.round((tokenBudget.historyTokensUsed / totalTokens) * 100);
  const memoryPercent = Math.round((tokenBudget.memoryTokensUsed / totalTokens) * 100);
  const systemPercent = Math.round((tokenBudget.systemPromptTokens / totalTokens) * 100);

  // Build token distribution bar
  const tokenBar = `System: ${systemPercent}% | Memory: ${memoryPercent}% | History: ${historyPercent}%`;
  const dangerWarning = historyPercent > 70 ? '\n⚠️ **History > 70%** - Sycophancy risk!' : '';

  const embed = new EmbedBuilder()
    .setTitle('🔍 LLM Diagnostic Summary')
    .setColor(llmResponse.finishReason === 'length' ? 0xff6600 : 0x00ff00)
    .addFields(
      {
        name: '📝 Request',
        value: [
          `**ID:** \`${meta.requestId}\``,
          `**Personality:** ${meta.personalityName}`,
          `**User:** <@${meta.userId}>`,
          `**Channel:** <#${meta.channelId}>`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '🤖 Model',
        value: [
          `**Model:** ${llmConfig.model}`,
          `**Provider:** ${llmConfig.provider}`,
          `**Temperature:** ${llmConfig.temperature ?? 'default'}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '🧠 Memory',
        value: [
          `**Found:** ${memoryRetrieval.memoriesFound.length}`,
          `**Included:** ${memoryRetrieval.memoriesFound.filter(m => m.includedInPrompt).length}`,
          `**Focus Mode:** ${memoryRetrieval.focusModeEnabled ? 'Yes' : 'No'}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '📊 Token Budget',
        value: `\`${tokenBar}\`${dangerWarning}`,
        inline: false,
      },
      {
        name: '📤 Response',
        value: [
          `**Finish Reason:** ${llmResponse.finishReason}`,
          `**Prompt Tokens:** ${llmResponse.promptTokens}`,
          `**Completion Tokens:** ${llmResponse.completionTokens}`,
          llmResponse.stopSequenceTriggered !== null
            ? `**Stop Sequence:** \`${llmResponse.stopSequenceTriggered}\``
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
        inline: true,
      },
      {
        name: '⏱️ Timing',
        value: [
          `**Total:** ${timing.totalDurationMs}ms`,
          timing.memoryRetrievalMs !== undefined ? `**Memory:** ${timing.memoryRetrievalMs}ms` : '',
          timing.llmInvocationMs !== undefined ? `**LLM:** ${timing.llmInvocationMs}ms` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        inline: true,
      }
    )
    .setTimestamp(new Date(meta.timestamp))
    .setFooter({ text: 'Full diagnostic data attached as JSON' });

  return embed;
}

export async function handleDebug(context: DeferredCommandContext): Promise<void> {
  const requestId = context.getOption<string>('request-id');

  if (requestId === null || requestId === undefined || requestId === '') {
    await context.editReply({
      content: '❌ Request ID is required. You can find it in the bot logs or job result metadata.',
    });
    return;
  }

  try {
    const response = await adminFetch(`/admin/diagnostic/${encodeURIComponent(requestId)}`);

    if (!response.ok) {
      if (response.status === 404) {
        await context.editReply({
          content:
            '❌ Diagnostic log not found.\n' +
            '• The log may have expired (24h retention)\n' +
            '• The request ID may be incorrect\n' +
            '• The request may not have completed successfully',
        });
        return;
      }

      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, '[AdminDebug] Fetch failed');
      await context.editReply({
        content: `❌ Failed to fetch diagnostic log (HTTP ${response.status})`,
      });
      return;
    }

    const { log } = (await response.json()) as DiagnosticLogResponse;

    // Build summary embed
    const embed = buildDiagnosticEmbed(log.data);

    // Attach full JSON for detailed analysis
    const jsonContent = JSON.stringify(log.data, null, 2);
    const attachment = new AttachmentBuilder(Buffer.from(jsonContent), {
      name: `diagnostic-${requestId}.json`,
      description: 'Full LLM diagnostic data for debugging',
    });

    await context.editReply({
      embeds: [embed],
      files: [attachment],
    });

    logger.info(
      { requestId, personalityId: log.personalityId },
      '[AdminDebug] Diagnostic log retrieved'
    );
  } catch (error) {
    logger.error({ err: error, requestId }, '[AdminDebug] Error fetching diagnostic log');
    await context.editReply({
      content: '❌ Error fetching diagnostic log. Please try again later.',
    });
  }
}
