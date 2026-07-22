/**
 * Memory Fresh Mode Handlers
 * Handles /memory fresh enable|disable|status commands
 *
 * Fresh Mode disables LTM retrieval without deleting anything: the character
 * replies without using its long-term memories of you, and new memories keep
 * being saved. Every user-facing string here repeats that memories are KEPT —
 * "fresh" alone doesn't say it, so the copy has to.
 *
 * This is the opposite of Incognito Mode:
 * - Fresh Mode: Disable READING (memories still saved)
 * - Incognito Mode: Disable WRITING (memories still retrieved)
 */

import { escapeMarkdown } from 'discord.js';
import {
  memoryFreshEnableOptions,
  memoryFreshDisableOptions,
  memoryFreshStatusOptions,
} from '@tzurot/common-types/generated/commandOptions';
import { getDurationLabel, type MemoryModeDuration } from '@tzurot/common-types/types/memory-modes';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import {
  createSuccessEmbed,
  createInfoEmbed,
  createWarningEmbed,
} from '../../utils/commandHelpers.js';
import { getPersonalityName } from './autocomplete.js';
import {
  resolveMemoryModeTargetOrReply,
  formatSessionInfo,
  ALL_PERSONALITIES_LABEL,
} from './incognito.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

const logger = createLogger('memory-fresh');

/** Shared message for catch-all error logs in this module's handlers. */
const UNEXPECTED_ERROR_LOG_MESSAGE = 'Unexpected error';
/** Shared resource noun for the fresh classify paths. */
const FRESH_RESOURCE = 'fresh mode';

/**
 * Handle /memory fresh enable
 */
export async function handleFreshEnable(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const { userClient } = clientsFor(context.interaction);
  const options = memoryFreshEnableOptions(context.interaction);
  const personalityInput = options.character();
  const duration = options.timeframe() as MemoryModeDuration;

  try {
    const resolved = await resolveMemoryModeTargetOrReply(context, userClient, personalityInput);
    if (resolved === null) {
      return;
    }

    const result = await userClient.enableFresh({ personalityId: resolved.id, duration });

    if (!result.ok) {
      logger.warn({ userId, personalityInput, duration, status: result.status }, 'Enable failed');
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, FRESH_RESOURCE, { failedAction: 'enable fresh mode' })
        ),
      });
      return;
    }

    const data = result.data;
    const target = escapeMarkdown(resolved.name ?? personalityInput);

    const embed = data.wasAlreadyActive
      ? createInfoEmbed(
          '🌱 Fresh Mode Already Active',
          `Fresh mode is already active for **${target}**.\n\n**Time remaining:** ${data.timeRemaining}\n\nDisable it first if you want to change the duration.`
        )
      : createSuccessEmbed(
          '🌱 Fresh Mode Enabled',
          `Fresh mode is now **enabled** for **${target}** (${getDurationLabel(duration)}).\n\n**Replies won't use what they remember about you.** Your memories are kept — just not used — and new memories are still saved.\n\nUse \`/memory fresh disable\` to turn it off.`
        );

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, personalityId: resolved.id, duration, wasAlreadyActive: data.wasAlreadyActive },
      'Mode enabled'
    );
  } catch (error) {
    logger.error({ err: error, userId }, UNEXPECTED_ERROR_LOG_MESSAGE);
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, FRESH_RESOURCE, { failedAction: 'enable fresh mode' })
      ),
    });
  }
}

/**
 * Handle /memory fresh disable
 */
export async function handleFreshDisable(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const { userClient } = clientsFor(context.interaction);
  const options = memoryFreshDisableOptions(context.interaction);
  const personalityInput = options.character();

  try {
    const resolved = await resolveMemoryModeTargetOrReply(context, userClient, personalityInput);
    if (resolved === null) {
      return;
    }

    const result = await userClient.disableFresh({ personalityId: resolved.id });

    if (!result.ok) {
      logger.warn({ userId, personalityInput, status: result.status }, 'Disable failed');
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, FRESH_RESOURCE, { failedAction: 'disable fresh mode' })
        ),
      });
      return;
    }

    const data = result.data;
    const target = escapeMarkdown(resolved.name ?? personalityInput);

    const embed = data.disabled
      ? createSuccessEmbed(
          '🌱 Fresh Mode Disabled',
          `Fresh mode is now **disabled** for **${target}**.\n\nReplies will use their memories of you again.`
        )
      : createInfoEmbed('🌱 Fresh Mode Not Active', `Fresh mode was not active for **${target}**.`);

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, personalityId: resolved.id, wasActive: data.disabled }, 'Mode disabled');
  } catch (error) {
    logger.error({ err: error, userId }, UNEXPECTED_ERROR_LOG_MESSAGE);
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, FRESH_RESOURCE, { failedAction: 'disable fresh mode' })
      ),
    });
  }
}

/**
 * Handle /memory fresh status — overview of active sessions, with an optional
 * character filter (its own session plus any global 'all' session).
 */
export async function handleFreshStatus(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const { userClient } = clientsFor(context.interaction);
  const options = memoryFreshStatusOptions(context.interaction);
  const characterInput = options.character();

  try {
    let personalityId: string | undefined;
    if (characterInput !== null && characterInput.toLowerCase() !== 'all') {
      const resolved = await resolveMemoryModeTargetOrReply(context, userClient, characterInput);
      if (resolved === null) {
        return;
      }
      personalityId = resolved.id;
    }

    const result = await userClient.getFreshStatus({ personalityId });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, 'Status check failed');
      await context.editReply({
        content: renderSpec(classifyGatewayFailure(result, 'fresh status', { operation: 'read' })),
      });
      return;
    }

    const data = result.data;

    if (!data.active || data.sessions.length === 0) {
      const embed = createInfoEmbed(
        '🌱 Fresh Mode Status',
        'Fresh mode is **not active**.\n\nReplies are using long-term memories normally.'
      );
      await context.editReply({ embeds: [embed] });
      return;
    }

    // Get personality names for each session
    const sessionLines = await Promise.all(
      data.sessions.map(async session => {
        if (session.personalityId === 'all') {
          return formatSessionInfo(session, ALL_PERSONALITIES_LABEL);
        }
        const name = await getPersonalityName(userClient, session.personalityId);
        return formatSessionInfo(session, name ?? session.personalityId);
      })
    );

    const embed = createWarningEmbed(
      '🌱 Fresh Mode Active',
      `Fresh mode is currently **active**.\n\n**Active sessions:**\n${sessionLines.join('\n')}\n\nReplies won't use memories of you for these characters. Memories are kept — just not used — and new ones are still saved.`
    );

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, sessionCount: data.sessions.length }, 'Status checked');
  } catch (error) {
    logger.error({ err: error, userId }, UNEXPECTED_ERROR_LOG_MESSAGE);
    // handleFreshStatus only READS — never claim a write.
    await context.editReply({
      content: renderSpec(classifyGatewayFailure(error, 'fresh status', { operation: 'read' })),
    });
  }
}
