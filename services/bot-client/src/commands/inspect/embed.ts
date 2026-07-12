/**
 * Diagnostic embed builder for the inspect command summary view
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { FINISH_REASONS } from '@tzurot/common-types/constants/finishReasons';
import { type DiagnosticPayload } from '@tzurot/common-types/types/diagnostic';

/**
 * Determine embed color based on diagnostic state
 */
export function getEmbedColor(payload: DiagnosticPayload): number {
  if (payload.error) {
    return DISCORD_COLORS.ERROR;
  }
  if (payload.llmResponse.finishReason === FINISH_REASONS.LENGTH) {
    return DISCORD_COLORS.WARNING;
  }
  return DISCORD_COLORS.SUCCESS;
}

/**
 * Format a finish reason with a status emoji prefix.
 * Natural completion (stop / end_turn / STOP / stop_sequence) → ✅
 * Length truncation → ⚠️
 * Content filter blocked → ⛔
 * Unknown sentinel → ❓
 * Anything else → no decoration
 */
export function formatFinishReason(reason: string): string {
  switch (reason) {
    case FINISH_REASONS.STOP:
    case FINISH_REASONS.END_TURN:
    case FINISH_REASONS.STOP_GOOGLE:
    case FINISH_REASONS.STOP_SEQUENCE:
      return `${reason} ✅`;
    case FINISH_REASONS.LENGTH:
      return `${reason} ⚠️`;
    case FINISH_REASONS.CONTENT_FILTER:
      return `${reason} ⛔`;
    case FINISH_REASONS.UNKNOWN:
      return `${reason} ❔`;
    default:
      return reason;
  }
}

/**
 * Format the API → Pipeline reasoning extraction chain. Surfaces the leak class
 * by comparing what the OpenRouter API emitted (`apiReasoningLength`) against
 * what our pipeline ended up with (`reasoningKwargsLength`).
 *
 * - Both > 0 and equal → ✅ healthy extraction
 * - API > 0 but pipeline === 0 → ❌ pipeline leak (would fire if the LangChain
 *   __includeRawResponse contract breaks despite passing CI)
 * - Both === 0 → ⚠️ model emitted no structured reasoning (the known model-
 *   behavior leak class — model embedded planning into content directly)
 * - API > 0 and pipeline > 0 but mismatched → ⚠️ partial
 *
 * Returns null when reasoningDebug is absent (pre-PR-#895 logs).
 */
export function formatExtractionStatus(
  reasoningDebug: NonNullable<DiagnosticPayload['llmResponse']['reasoningDebug']> | undefined
): string | null {
  if (reasoningDebug === undefined) {
    return null;
  }
  const apiLen = reasoningDebug.apiReasoningLength;
  const pipelineLen = reasoningDebug.reasoningKwargsLength;
  // Pre-PR-#895 log fallback: apiReasoningLength is undefined
  if (apiLen === undefined) {
    return null;
  }
  if (apiLen === 0 && pipelineLen === 0) {
    return '⚠️ Model emitted no structured reasoning (may be embedded in content)';
  }
  if (apiLen > 0 && pipelineLen === 0) {
    return `❌ LEAK: ${apiLen.toLocaleString()} chars (API) → 0 chars (extracted)`;
  }
  if (apiLen === pipelineLen) {
    return `✅ ${apiLen.toLocaleString()} chars (API) → ${pipelineLen.toLocaleString()} chars (extracted)`;
  }
  return `⚠️ ${apiLen.toLocaleString()} chars (API) → ${pipelineLen.toLocaleString()} chars (extracted)`;
}

/**
 * Format the Memory section's "Found" line with a score range when memories exist.
 */
export function formatMemoryFoundLine(
  memories: DiagnosticPayload['memoryRetrieval']['memoriesFound']
): string {
  if (memories.length === 0) {
    return '**Found:** 0';
  }
  const scores = memories.map(m => m.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  return `**Found:** ${memories.length} (scores ${min.toFixed(2)}–${max.toFixed(2)})`;
}

/**
 * Build the reasoning diagnostics field for the embed.
 *
 * Post-PR-#895: shows upstream provider + extraction-chain health rather than
 * the now-stale "<reasoning> tag interception" check (which always reads false
 * after the consumer-layer refactor).
 */
export function buildReasoningField(
  payload: DiagnosticPayload
): { name: string; value: string } | null {
  const reasoningConfig = payload.llmConfig.allParams.reasoning as
    { effort?: string; enabled?: boolean } | undefined;
  if (reasoningConfig === undefined) {
    return null;
  }

  const { llmResponse } = payload;
  const reasoningDebug = llmResponse.reasoningDebug;
  const lines: string[] = [
    `**Config:** effort=${reasoningConfig.effort ?? 'default'}, enabled=${String(reasoningConfig.enabled ?? true)}`,
  ];

  if (reasoningDebug?.upstreamProvider !== undefined) {
    lines.push(`**Upstream:** ${reasoningDebug.upstreamProvider}`);
  }

  const extractionStatus = formatExtractionStatus(reasoningDebug);
  if (extractionStatus !== null) {
    lines.push(`**Extraction:** ${extractionStatus}`);
  }

  return {
    name: '💭 Reasoning',
    value: lines.join('\n'),
  };
}

/** Strip the provider prefix and lowercase — the comparable model base. */
function bareModel(id: string): string {
  const lower = id.toLowerCase();
  const slash = lower.indexOf('/');
  return slash >= 0 ? lower.slice(slash + 1) : lower;
}

/** Same model modulo provider prefix and a date/version STAMP suffix.
 * Only `-<digits>` counts as a stamp (`claude-3-5-sonnet-20241022`) — dotted
 * or named suffixes (`-4.5`, `-turbo`, `-air`, `:free`) are DIFFERENT models
 * and must flag. A false "Served" line is honest info; a false negative
 * hides exactly the substitution this field exists to surface. */
function isSameModel(requested: string, served: string): boolean {
  const a = bareModel(requested);
  const b = bareModel(served);
  if (a === b) {
    return true;
  }
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return longer.startsWith(shorter) && /^-\d+$/.test(longer.slice(shorter.length));
}

/**
 * Build the Model field. "Family" is the namespace prefix from the model name
 * (e.g. "z-ai" from "z-ai/glm-4.7") — this is NOT the actual upstream OpenRouter
 * provider that handled the request. The real upstream lives in
 * reasoningDebug.upstreamProvider and is shown as a separate "Upstream" line
 * when available.
 */
function buildModelField(
  llmConfig: DiagnosticPayload['llmConfig'],
  llmResponse: DiagnosticPayload['llmResponse']
): { name: string; value: string; inline: boolean } {
  // Silent model substitution is a diagnosis blind spot — when the model
  // that actually served differs from the requested one (guest overrides,
  // fallback retargets), show BOTH prominently. Normalized comparison:
  // provider prefixes ('z-ai/…' → bare) and version-suffixed variants
  // ('…-sonnet' served as '…-sonnet-20241022') are the SAME model.
  const served = llmResponse.modelUsed;
  const substituted = served.length > 0 && !isSameModel(llmConfig.model, served);
  const lines: string[] = substituted
    ? [`**Requested:** ${llmConfig.model}`, `⚠️ **Served:** ${served}`]
    : [`**Model:** ${llmConfig.model}`];
  lines.push(`**Family:** ${llmConfig.provider}`);
  const upstreamProvider = llmResponse.reasoningDebug?.upstreamProvider;
  if (upstreamProvider !== undefined) {
    lines.push(`**Upstream:** ${upstreamProvider}`);
  }
  lines.push(`**Temperature:** ${llmConfig.temperature ?? 'default'}`);
  return { name: '🤖 Model', value: lines.join('\n'), inline: true };
}

/**
 * Build the Response field with finish-reason emoji decoration and a LOW
 * completion-tokens warning.
 */
function buildResponseField(llmResponse: DiagnosticPayload['llmResponse']): {
  name: string;
  value: string;
  inline: boolean;
} {
  const lowTokenWarning =
    llmResponse.completionTokens < 100 && llmResponse.completionTokens > 0 ? ' ⚠️ LOW' : '';
  return {
    name: '📤 Response',
    value: [
      `**Finish Reason:** ${formatFinishReason(llmResponse.finishReason)}`,
      `**Prompt Tokens:** ${llmResponse.promptTokens}`,
      `**Completion Tokens:** ${llmResponse.completionTokens}${lowTokenWarning}`,
    ].join('\n'),
    inline: true,
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
  const dangerWarning = historyPercent > 70 ? '\n⚠️ **History > 70%** - Sycophancy risk!' : '';

  const title = error ? '❌ LLM Diagnostic (FAILED)' : '🔍 LLM Diagnostic Summary';

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(getEmbedColor(payload))
    .addFields(
      {
        name: '📝 Request',
        value: [
          `**ID:** \`${meta.requestId}\``,
          `**Character:** ${meta.personalityName}`,
          `**User:** <@${meta.userId}>`,
          `**Channel:** <#${meta.channelId}>`,
        ].join('\n'),
        inline: true,
      },
      buildModelField(llmConfig, llmResponse),
      {
        name: '🧠 Memory',
        value: [
          formatMemoryFoundLine(memoryRetrieval.memoriesFound),
          `**Included:** ${memoryRetrieval.memoriesFound.filter(m => m.includedInPrompt).length}`,
          `**Focus Mode:** ${memoryRetrieval.focusModeEnabled ? 'Yes' : 'No'}`,
        ].join('\n'),
        inline: true,
      }
    );

  if (error) {
    embed.addFields({
      name: '🚨 Error',
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
      name: '📊 Token Budget',
      value: `\`${tokenBar}\`${dangerWarning}`,
      inline: false,
    },
    buildResponseField(llmResponse),
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
