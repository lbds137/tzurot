/**
 * Memory Incognito Mode Handlers
 * Handles /memory incognito enable|disable|status|forget commands
 *
 * Incognito Mode disables LTM writing without affecting retrieval.
 * Memories won't be saved, but existing memories can still be retrieved.
 *
 * This is the opposite of Focus Mode:
 * - Focus Mode: Disable READING (memories still saved)
 * - Incognito Mode: Disable WRITING (memories still retrieved)
 */

import { escapeMarkdown } from 'discord.js';
import {
  createLogger,
  getDurationLabel,
  type IncognitoSession,
  type IncognitoDuration,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import {
  createSuccessEmbed,
  createInfoEmbed,
  createWarningEmbed,
} from '../../utils/commandHelpers.js';
import { resolvePersonalityId, getPersonalityName } from './autocomplete.js';

const logger = createLogger('memory-incognito');

interface SessionWithTime extends IncognitoSession {
  timeRemaining: string;
}

interface IncognitoStatusResponse {
  active: boolean;
  sessions: SessionWithTime[];
}

interface IncognitoEnableResponse {
  session: IncognitoSession;
  timeRemaining: string;
  message: string;
}

interface IncognitoDisableResponse {
  disabled: boolean;
  message: string;
}

interface IncognitoForgetResponse {
  deletedCount: number;
  personalities: string[];
  message: string;
}

/**
 * Format session info for display
 */
function formatSessionInfo(session: SessionWithTime, personalityName?: string): string {
  const target =
    session.personalityId === 'all' ? 'all personalities' : (personalityName ?? 'Unknown');
  return `• **${escapeMarkdown(target)}** (${session.timeRemaining})`;
}

/**
 * Resolve personality input to ID, handling 'all' specially
 * @returns { id: personality UUID or 'all', name: display name or null }
 */
async function resolvePersonalityOrAll(
  userId: string,
  personalityInput: string
): Promise<{ id: string; name: string | null } | null> {
  if (personalityInput.toLowerCase() === 'all') {
    return { id: 'all', name: 'all personalities' };
  }

  const personalityId = await resolvePersonalityId(userId, personalityInput);
  if (personalityId === null) {
    return null;
  }

  const name = await getPersonalityName(userId, personalityId);
  return { id: personalityId, name };
}

/**
 * Handle /memory incognito enable
 */
export async function handleIncognitoEnable(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const personalityInput = context.interaction.options.getString('personality', true);
  const duration = context.interaction.options.getString('duration', true) as IncognitoDuration;

  try {
    const resolved = await resolvePersonalityOrAll(userId, personalityInput);

    if (resolved === null) {
      await context.editReply({
        content: `❌ Personality "${personalityInput}" not found. Use autocomplete to select a valid personality, or type "all" for all personalities.`,
      });
      return;
    }

    const result = await callGatewayApi<IncognitoEnableResponse>('/user/memory/incognito', {
      userId,
      method: 'POST',
      body: { personalityId: resolved.id, duration },
    });

    if (!result.ok) {
      logger.warn(
        { userId, personalityInput, duration, status: result.status },
        '[Memory/Incognito] Enable failed'
      );
      await context.editReply({ content: '❌ Failed to enable incognito mode. Please try again.' });
      return;
    }

    const data = result.data;

    // Check if it was already active (message contains "already")
    const wasAlreadyActive = data.message.includes('already');

    const embed = wasAlreadyActive
      ? createInfoEmbed(
          '👻 Incognito Already Active',
          `Incognito mode is already active for **${escapeMarkdown(resolved.name ?? personalityInput)}**.\n\n**Time remaining:** ${data.timeRemaining}\n\nDisable it first if you want to change the duration.`
        )
      : createSuccessEmbed(
          '👻 Incognito Mode Enabled',
          `Incognito mode is now **enabled** for **${escapeMarkdown(resolved.name ?? personalityInput)}** (${getDurationLabel(duration)}).\n\n**New memories will NOT be saved.** Existing memories can still be retrieved.\n\nUse \`/memory incognito disable\` to turn it off.`
        );

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, personalityId: resolved.id, duration, wasAlreadyActive },
      '[Memory/Incognito] Mode enabled'
    );
  } catch (error) {
    logger.error({ error, userId }, '[Memory/Incognito Enable] Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}

/**
 * Handle /memory incognito disable
 */
export async function handleIncognitoDisable(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const personalityInput = context.interaction.options.getString('personality', true);

  try {
    const resolved = await resolvePersonalityOrAll(userId, personalityInput);

    if (resolved === null) {
      await context.editReply({
        content: `❌ Personality "${personalityInput}" not found. Use autocomplete to select a valid personality, or type "all" for all personalities.`,
      });
      return;
    }

    const result = await callGatewayApi<IncognitoDisableResponse>('/user/memory/incognito', {
      userId,
      method: 'DELETE',
      body: { personalityId: resolved.id },
    });

    if (!result.ok) {
      logger.warn(
        { userId, personalityInput, status: result.status },
        '[Memory/Incognito] Disable failed'
      );
      await context.editReply({
        content: '❌ Failed to disable incognito mode. Please try again.',
      });
      return;
    }

    const data = result.data;

    const embed = data.disabled
      ? createSuccessEmbed(
          '👻 Incognito Mode Disabled',
          `Incognito mode is now **disabled** for **${escapeMarkdown(resolved.name ?? personalityInput)}**.\n\nMemories will be saved normally during conversations.`
        )
      : createInfoEmbed(
          '👻 Incognito Not Active',
          `Incognito mode was not active for **${escapeMarkdown(resolved.name ?? personalityInput)}**.`
        );

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, personalityId: resolved.id, wasActive: data.disabled },
      '[Memory/Incognito] Mode disabled'
    );
  } catch (error) {
    logger.error({ error, userId }, '[Memory/Incognito Disable] Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}

/**
 * Handle /memory incognito status
 */
export async function handleIncognitoStatus(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await callGatewayApi<IncognitoStatusResponse>('/user/memory/incognito', {
      userId,
      method: 'GET',
    });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, '[Memory/Incognito] Status check failed');
      await context.editReply({
        content: '❌ Failed to check incognito status. Please try again.',
      });
      return;
    }

    const data = result.data;

    if (!data.active || data.sessions.length === 0) {
      const embed = createInfoEmbed(
        '👻 Incognito Status',
        'Incognito mode is **not active**.\n\nMemories are being saved normally during conversations.'
      );
      await context.editReply({ embeds: [embed] });
      return;
    }

    // Get personality names for each session
    const sessionLines = await Promise.all(
      data.sessions.map(async session => {
        if (session.personalityId === 'all') {
          return formatSessionInfo(session, 'all personalities');
        }
        const name = await getPersonalityName(userId, session.personalityId);
        return formatSessionInfo(session, name ?? session.personalityId);
      })
    );

    const embed = createWarningEmbed(
      '👻 Incognito Active',
      `Incognito mode is currently **active**.\n\n**Active sessions:**\n${sessionLines.join('\n')}\n\nNew memories will NOT be saved for these personalities.`
    );

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, sessionCount: data.sessions.length },
      '[Memory/Incognito] Status checked'
    );
  } catch (error) {
    logger.error({ error, userId }, '[Memory/Incognito Status] Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}

/**
 * Handle /memory incognito forget
 */
export async function handleIncognitoForget(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const personalityInput = context.interaction.options.getString('personality', true);
  const timeframe = context.interaction.options.getString('timeframe', true);

  try {
    const resolved = await resolvePersonalityOrAll(userId, personalityInput);

    if (resolved === null) {
      await context.editReply({
        content: `❌ Personality "${personalityInput}" not found. Use autocomplete to select a valid personality, or type "all" for all personalities.`,
      });
      return;
    }

    const result = await callGatewayApi<IncognitoForgetResponse>('/user/memory/incognito/forget', {
      userId,
      method: 'POST',
      body: { personalityId: resolved.id, timeframe },
    });

    if (!result.ok) {
      logger.warn(
        { userId, personalityInput, timeframe, status: result.status },
        '[Memory/Incognito] Forget failed'
      );
      await context.editReply({
        content: '❌ Failed to delete recent memories. Please try again.',
      });
      return;
    }

    const data = result.data;

    const embed =
      data.deletedCount > 0
        ? createSuccessEmbed(
            '🗑️ Memories Deleted',
            `**${data.deletedCount} memories** from the last ${timeframe} have been deleted.\n\n${data.personalities.length > 0 ? `**Affected personalities:** ${data.personalities.map(p => escapeMarkdown(p)).join(', ')}` : ''}\n\n*Note: Locked memories are preserved.*`
          )
        : createInfoEmbed(
            '🗑️ No Memories Found',
            `No unlocked memories found in the last ${timeframe} for **${escapeMarkdown(resolved.name ?? personalityInput)}**.`
          );

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, personalityId: resolved.id, timeframe, deletedCount: data.deletedCount },
      '[Memory/Incognito] Forget executed'
    );
  } catch (error) {
    logger.error({ error, userId }, '[Memory/Incognito Forget] Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}
