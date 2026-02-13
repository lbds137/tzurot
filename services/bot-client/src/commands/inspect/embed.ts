/**
 * Diagnostic embed builder for the inspect command summary view
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS, type DiagnosticPayload } from '@tzurot/common-types';

/**
 * Determine embed color based on diagnostic state
 */
export function getEmbedColor(payload: DiagnosticPayload): number {
  if (payload.error) {
    return DISCORD_COLORS.ERROR;
  }
  if (payload.llmResponse.finishReason === 'length') {
    return DISCORD_COLORS.WARNING;
  }
  return DISCORD_COLORS.SUCCESS;
}

/**
 * Build the reasoning diagnostics field for the embed
 */
export function buildReasoningField(
  payload: DiagnosticPayload
): { name: string; value: string } | null {
  const reasoningConfig = payload.llmConfig.allParams.reasoning as
    | { effort?: string; enabled?: boolean }
    | undefined;
  if (reasoningConfig === undefined) {
    return null;
  }

  const { postProcessing, llmResponse } = payload;
  const reasoningDebug = llmResponse.reasoningDebug;
  const hasInterceptionTags = reasoningDebug?.hasReasoningTagsInContent === true;
  const thinkingLen = postProcessing.thinkingContent?.length ?? 0;
  const lowTokenWarning =
    llmResponse.completionTokens < 100 && llmResponse.completionTokens > 0
      ? ' \u26a0\ufe0f LOW'
      : '';

  return {
    name: '\ud83d\udcad Reasoning',
    value: [
      `**Config:** effort=${reasoningConfig.effort ?? 'default'}, enabled=${String(reasoningConfig.enabled ?? true)}`,
      `**Interception:** <reasoning> tags ${hasInterceptionTags ? 'found \u2705' : 'not found \u274c'}`,
      `**Thinking Extracted:** ${thinkingLen > 0 ? `Yes (${thinkingLen.toLocaleString()} chars)` : 'No'}`,
      `**Completion Tokens:** ${llmResponse.completionTokens}${lowTokenWarning}`,
    ].join('\n'),
  };
}

/**
 * Build a summary embed with key diagnostic stats
 */
export function buildDiagnosticEmbed(payload: DiagnosticPayload): EmbedBuilder {
  const { meta, memoryRetrieval, tokenBudget, llmConfig, llmResponse, timing, error } = payload;

  const totalTokens = tokenBudget.contextWindowSize || 1;
  const historyPercent = Math.round((tokenBudget.historyTokensUsed / totalTokens) * 100);
  const memoryPercent = Math.round((tokenBudget.memoryTokensUsed / totalTokens) * 100);
  const systemPercent = Math.round((tokenBudget.systemPromptTokens / totalTokens) * 100);

  const tokenBar = `System: ${systemPercent}% | Memory: ${memoryPercent}% | History: ${historyPercent}%`;
  const dangerWarning =
    historyPercent > 70 ? '\n\u26a0\ufe0f **History > 70%** - Sycophancy risk!' : '';

  const title = error ? '\u274c LLM Diagnostic (FAILED)' : '\ud83d\udd0d LLM Diagnostic Summary';

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(getEmbedColor(payload))
    .addFields(
      {
        name: '\ud83d\udcdd Request',
        value: [
          `**ID:** \`${meta.requestId}\``,
          `**Personality:** ${meta.personalityName}`,
          `**User:** <@${meta.userId}>`,
          `**Channel:** <#${meta.channelId}>`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '\ud83e\udd16 Model',
        value: [
          `**Model:** ${llmConfig.model}`,
          `**Provider:** ${llmConfig.provider}`,
          `**Temperature:** ${llmConfig.temperature ?? 'default'}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '\ud83e\udde0 Memory',
        value: [
          `**Found:** ${memoryRetrieval.memoriesFound.length}`,
          `**Included:** ${memoryRetrieval.memoriesFound.filter(m => m.includedInPrompt).length}`,
          `**Focus Mode:** ${memoryRetrieval.focusModeEnabled ? 'Yes' : 'No'}`,
        ].join('\n'),
        inline: true,
      }
    );

  if (error) {
    embed.addFields({
      name: '\ud83d\udea8 Error',
      value: [
        `**Category:** ${error.category}`,
        `**Message:** ${error.message.substring(0, 200)}${error.message.length > 200 ? '...' : ''}`,
        error.referenceId !== undefined ? `**Reference:** \`${error.referenceId}\`` : '',
        `**Failed At:** ${error.failedAtStage}`,
      ]
        .filter(Boolean)
        .join('\n'),
      inline: false,
    });
  }

  embed.addFields(
    {
      name: '\ud83d\udcca Token Budget',
      value: `\`${tokenBar}\`${dangerWarning}`,
      inline: false,
    },
    {
      name: '\ud83d\udce4 Response',
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
      name: '\u23f1\ufe0f Timing',
      value: [
        `**Total:** ${timing.totalDurationMs}ms`,
        timing.memoryRetrievalMs !== undefined ? `**Memory:** ${timing.memoryRetrievalMs}ms` : '',
        timing.llmInvocationMs !== undefined ? `**LLM:** ${timing.llmInvocationMs}ms` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      inline: true,
    }
  );

  const reasoningField = buildReasoningField(payload);
  if (reasoningField !== null) {
    embed.addFields({ ...reasoningField, inline: false });
  }

  embed
    .setTimestamp(new Date(meta.timestamp))
    .setFooter({ text: 'Use the buttons and menu below to inspect details' });

  return embed;
}
