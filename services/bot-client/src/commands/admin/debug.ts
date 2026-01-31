/**
 * Admin Debug Subcommand
 * Handles /admin debug - Retrieve LLM diagnostic logs for debugging prompt issues
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 *
 * Accepts multiple identifier formats:
 * - Discord message ID (e.g., "1234567890123456789")
 * - Discord message link (e.g., "https://discord.com/channels/123/456/789")
 * - Request UUID (e.g., "a1b2c3d4-e5f6-7890-abcd-ef1234567890")
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
import { createLogger, adminDebugOptions, type DiagnosticPayload } from '@tzurot/common-types';
import { adminFetch } from '../../utils/adminApiClient.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-debug');

/** Discord message link regex - captures guild/channel/message IDs */
const MESSAGE_LINK_REGEX = /discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;

/** UUID v4 regex for request IDs */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Discord snowflake ID regex (numeric, 17-20 digits) */
const SNOWFLAKE_REGEX = /^\d{17,20}$/;

interface DiagnosticLog {
  id: string;
  requestId: string;
  triggerMessageId?: string;
  personalityId: string | null;
  userId: string | null;
  guildId: string | null;
  channelId: string | null;
  model: string;
  provider: string;
  durationMs: number;
  createdAt: string;
  data: DiagnosticPayload;
}

interface DiagnosticLogResponse {
  log: DiagnosticLog;
}

interface DiagnosticLogsResponse {
  logs: DiagnosticLog[];
  count: number;
}

/** Result of a diagnostic log lookup */
type LookupResult =
  | { success: true; log: DiagnosticLog }
  | { success: false; errorMessage: string };

/**
 * Lookup diagnostic log by Discord message ID
 * Tries trigger message first, then response message as fallback
 */
async function lookupByMessageId(messageId: string): Promise<LookupResult> {
  // First try: Lookup by Discord trigger message ID (user's message)
  let response = await adminFetch(`/admin/diagnostic/by-message/${encodeURIComponent(messageId)}`);

  // If not found as trigger message, try as response message (AI's reply)
  if (response.status === 404) {
    logger.debug(
      { messageId },
      '[AdminDebug] Not found as trigger message, trying response message lookup'
    );
    response = await adminFetch(`/admin/diagnostic/by-response/${encodeURIComponent(messageId)}`);

    // Handle by-response result (returns single log, not array)
    if (response.ok) {
      const result = (await response.json()) as DiagnosticLogResponse;
      return { success: true, log: result.log };
    }
  }

  if (!response.ok) {
    if (response.status === 404) {
      return {
        success: false,
        errorMessage:
          '❌ No diagnostic logs found for this message.\n' +
          '• The log may have expired (24h retention)\n' +
          '• The message may not have triggered or been an AI response\n' +
          '• The message ID may be incorrect',
      };
    }

    const errorText = await response.text();
    logger.error(
      { status: response.status, error: errorText },
      '[AdminDebug] Fetch by message failed'
    );
    return {
      success: false,
      errorMessage: `❌ Failed to fetch diagnostic logs (HTTP ${response.status})`,
    };
  }

  // Parse by-message response (returns array)
  const { logs } = (await response.json()) as DiagnosticLogsResponse;

  if (logs.length === 0) {
    return {
      success: false,
      errorMessage:
        '❌ No diagnostic logs found for this message.\n' +
        '• The log may have expired (24h retention)\n' +
        '• The message may not have triggered an AI response',
    };
  }

  // Use the most recent log if multiple exist
  if (logs.length > 1) {
    logger.info(
      { messageId, count: logs.length },
      '[AdminDebug] Multiple logs found for message, using most recent'
    );
  }

  return { success: true, log: logs[0] };
}

/**
 * Lookup diagnostic log by request UUID
 */
async function lookupByRequestId(requestId: string): Promise<LookupResult> {
  const response = await adminFetch(`/admin/diagnostic/${encodeURIComponent(requestId)}`);

  if (!response.ok) {
    if (response.status === 404) {
      return {
        success: false,
        errorMessage:
          '❌ Diagnostic log not found.\n' +
          '• The log may have expired (24h retention)\n' +
          '• The request ID may be incorrect\n' +
          '• The request may not have completed successfully',
      };
    }

    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, '[AdminDebug] Fetch failed');
    return {
      success: false,
      errorMessage: `❌ Failed to fetch diagnostic log (HTTP ${response.status})`,
    };
  }

  const result = (await response.json()) as DiagnosticLogResponse;
  return { success: true, log: result.log };
}

/**
 * Parse identifier to extract message ID if it's a Discord link
 */
function parseIdentifier(identifier: string): { type: 'messageId' | 'requestId'; value: string } {
  // Check if it's a Discord message link
  const linkMatch = MESSAGE_LINK_REGEX.exec(identifier);
  if (linkMatch !== null) {
    return { type: 'messageId', value: linkMatch[3] };
  }

  // Check if it's a UUID (request ID)
  if (UUID_REGEX.test(identifier)) {
    return { type: 'requestId', value: identifier };
  }

  // Check if it's a snowflake (message ID)
  if (SNOWFLAKE_REGEX.test(identifier)) {
    return { type: 'messageId', value: identifier };
  }

  // Default to treating as request ID for backwards compatibility
  return { type: 'requestId', value: identifier };
}

/**
 * Determine embed color based on diagnostic state
 */
function getEmbedColor(payload: DiagnosticPayload): number {
  // Red for errors
  if (payload.error) {
    return 0xff0000;
  }
  // Orange for truncated responses
  if (payload.llmResponse.finishReason === 'length') {
    return 0xff6600;
  }
  // Green for success
  return 0x00ff00;
}

/** Output format options */
type DebugFormat = 'json' | 'xml' | 'both';

/**
 * Extract and format the system prompt as XML
 * Wraps in <SystemPrompt> root tag for valid XML structure
 */
function extractSystemPromptXml(payload: DiagnosticPayload): string {
  const systemMessage = payload.assembledPrompt.messages.find(m => m.role === 'system');
  if (!systemMessage) {
    return '<SystemPrompt>\n  <!-- No system message found -->\n</SystemPrompt>';
  }

  // The content is already formatted with newlines in the source
  // Just wrap it in a root tag for valid XML
  return `<SystemPrompt>\n${systemMessage.content}\n</SystemPrompt>`;
}

/**
 * Build attachments based on format option
 */
function buildAttachments(
  payload: DiagnosticPayload,
  requestId: string,
  format: DebugFormat
): AttachmentBuilder[] {
  const files: AttachmentBuilder[] = [];

  if (format === 'json' || format === 'both') {
    const jsonContent = JSON.stringify(payload, null, 2);
    files.push(
      new AttachmentBuilder(Buffer.from(jsonContent), {
        name: `debug-${requestId}.json`,
        description: 'Full LLM debug data for prompt analysis',
      })
    );
  }

  if (format === 'xml' || format === 'both') {
    const xmlContent = extractSystemPromptXml(payload);
    files.push(
      new AttachmentBuilder(Buffer.from(xmlContent), {
        name: `system-prompt-${requestId}.xml`,
        description: 'Formatted system prompt for analysis',
      })
    );
  }

  return files;
}

/**
 * Build a summary embed with key diagnostic stats
 */
function buildDiagnosticEmbed(payload: DiagnosticPayload): EmbedBuilder {
  const { meta, memoryRetrieval, tokenBudget, llmConfig, llmResponse, timing, error } = payload;

  // Calculate token budget percentages for the "danger zone" indicator
  const totalTokens = tokenBudget.contextWindowSize || 1;
  const historyPercent = Math.round((tokenBudget.historyTokensUsed / totalTokens) * 100);
  const memoryPercent = Math.round((tokenBudget.memoryTokensUsed / totalTokens) * 100);
  const systemPercent = Math.round((tokenBudget.systemPromptTokens / totalTokens) * 100);

  // Build token distribution bar
  const tokenBar = `System: ${systemPercent}% | Memory: ${memoryPercent}% | History: ${historyPercent}%`;
  const dangerWarning = historyPercent > 70 ? '\n⚠️ **History > 70%** - Sycophancy risk!' : '';

  // Determine title based on error state
  const title = error ? '❌ LLM Diagnostic (FAILED)' : '🔍 LLM Diagnostic Summary';

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(getEmbedColor(payload))
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
      }
    );

  // Add error field if present (before token budget for visibility)
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
  );

  embed
    .setTimestamp(new Date(meta.timestamp))
    .setFooter({ text: 'Full diagnostic data attached as JSON' });

  return embed;
}

export async function handleDebug(context: DeferredCommandContext): Promise<void> {
  const options = adminDebugOptions(context.interaction);
  const identifier = options.identifier();
  const format = (options.format() ?? 'json') as DebugFormat;

  // Note: identifier() returns string (required option), so only empty check needed
  if (identifier === '') {
    await context.editReply({
      content: '❌ Identifier is required. Provide a message ID, message link, or request UUID.',
    });
    return;
  }

  try {
    const parsed = parseIdentifier(identifier);

    // Call appropriate lookup function based on identifier type
    const result =
      parsed.type === 'messageId'
        ? await lookupByMessageId(parsed.value)
        : await lookupByRequestId(parsed.value);

    if (!result.success) {
      await context.editReply({ content: result.errorMessage });
      return;
    }

    const log = result.log;

    // Build summary embed and attachments
    const embed = buildDiagnosticEmbed(log.data);
    const files = buildAttachments(log.data, log.requestId, format);

    await context.editReply({
      embeds: [embed],
      files,
    });

    logger.info(
      { requestId: log.requestId, personalityId: log.personalityId },
      '[AdminDebug] Diagnostic log retrieved'
    );
  } catch (error) {
    logger.error({ err: error, identifier }, '[AdminDebug] Error fetching diagnostic log');
    await context.editReply({
      content: '❌ Error fetching diagnostic log. Please try again later.',
    });
  }
}
