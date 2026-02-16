/**
 * Admin Presence Subcommand
 * Handles /admin presence - Set or view the bot's Discord presence (activity status)
 *
 * Persists to Redis so the presence survives bot restarts.
 * Redis key: bot:presence → JSON { type: ActivityType, text: string }
 */

import { ActivityType } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { redis } from '../../redis.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { Client } from 'discord.js';

const logger = createLogger('admin-presence');

const REDIS_KEY = 'bot:presence';

interface PresenceData {
  type: ActivityType;
  text: string;
}

/** Activity type number → display name */
const ACTIVITY_LABELS: Record<number, string> = {
  [ActivityType.Playing]: 'Playing',
  [ActivityType.Listening]: 'Listening to',
  [ActivityType.Watching]: 'Watching',
  [ActivityType.Competing]: 'Competing in',
};

export async function handlePresence(context: DeferredCommandContext): Promise<void> {
  const typeOption = context.interaction.options.getInteger('type');
  const textOption = context.interaction.options.getString('text');

  // No args → show current presence
  if (typeOption === null) {
    await showCurrentPresence(context);
    return;
  }

  // Type = 99 (None) → clear presence
  if (typeOption === 99) {
    await clearPresence(context);
    return;
  }

  // Type + text → set presence
  if (textOption === null || textOption.length === 0) {
    await context.editReply({ content: '❌ Text is required when setting a presence type.' });
    return;
  }

  await setPresence(context, typeOption as ActivityType, textOption);
}

async function showCurrentPresence(context: DeferredCommandContext): Promise<void> {
  try {
    const stored = await redis.get(REDIS_KEY);
    if (stored === null) {
      await context.editReply({ content: '📋 No custom presence set.' });
      return;
    }

    const data = JSON.parse(stored) as PresenceData;
    const label = ACTIVITY_LABELS[data.type] ?? 'Unknown';
    await context.editReply({ content: `📋 Current presence: **${label}** ${data.text}` });
  } catch (error) {
    logger.error({ err: error }, 'Failed to read presence from Redis');
    await context.editReply({ content: '❌ Failed to read current presence.' });
  }
}

async function setPresence(
  context: DeferredCommandContext,
  type: ActivityType,
  text: string
): Promise<void> {
  const client = context.interaction.client;
  const data: PresenceData = { type, text };

  try {
    await redis.set(REDIS_KEY, JSON.stringify(data));
    client.user?.setActivity(text, { type });

    const label = ACTIVITY_LABELS[type] ?? 'Unknown';
    await context.editReply({ content: `✅ Presence set: **${label}** ${text}` });
    logger.info({ type, text }, '[Presence] Set');
  } catch (error) {
    logger.error({ err: error }, 'Failed to set presence');
    await context.editReply({ content: '❌ Failed to set presence.' });
  }
}

async function clearPresence(context: DeferredCommandContext): Promise<void> {
  const client = context.interaction.client;

  try {
    await redis.del(REDIS_KEY);
    client.user?.setPresence({ activities: [] });

    await context.editReply({ content: '✅ Presence cleared.' });
    logger.info({}, '[Presence] Cleared');
  } catch (error) {
    logger.error({ err: error }, 'Failed to clear presence');
    await context.editReply({ content: '❌ Failed to clear presence.' });
  }
}

/**
 * Restore bot presence from Redis on startup.
 * Called from the ClientReady handler.
 */
export async function restoreBotPresence(client: Client): Promise<void> {
  const stored = await redis.get(REDIS_KEY);
  if (stored === null) {
    return;
  }

  const data = JSON.parse(stored) as PresenceData;
  client.user?.setActivity(data.text, { type: data.type });

  const label = ACTIVITY_LABELS[data.type] ?? 'Unknown';
  logger.info({ type: data.type, text: data.text }, `[Presence] Restored: ${label} ${data.text}`);
}
