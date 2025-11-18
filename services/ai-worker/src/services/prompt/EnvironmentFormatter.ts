/**
 * Environment Formatter
 *
 * Formats Discord environment context (DM vs guild) for inclusion in system prompts.
 * Extracted from PromptBuilder for better modularity.
 */

import { createLogger } from '@tzurot/common-types';
import type { DiscordEnvironment } from '../ConversationalRAGService.js';

const logger = createLogger('EnvironmentFormatter');

/**
 * Format Discord environment context for inclusion in system prompt
 */
export function formatEnvironmentContext(environment: DiscordEnvironment): string {
  logger.debug({ environment }, '[EnvironmentFormatter] Formatting environment context');

  if (environment.type === 'dm') {
    logger.info('[EnvironmentFormatter] Environment type: DM');
    return '## Conversation Location\nThis conversation is taking place in a **Direct Message** (private one-on-one chat).';
  }

  logger.info(
    {
      guildName: environment.guild?.name,
      channelName: environment.channel.name,
      channelType: environment.channel.type,
    },
    '[EnvironmentFormatter] Environment type: Guild'
  );

  const parts: string[] = [];
  parts.push('## Conversation Location');
  parts.push('This conversation is taking place in a Discord server:\n');

  // Guild name
  if (environment.guild !== undefined && environment.guild !== null) {
    parts.push(`**Server**: ${environment.guild.name}`);
  }

  // Category (if exists)
  if (
    environment.category !== undefined &&
    environment.category !== null &&
    environment.category.name.length > 0
  ) {
    parts.push(`**Category**: ${environment.category.name}`);
  }

  // Channel
  parts.push(`**Channel**: #${environment.channel.name} (${environment.channel.type})`);

  // Thread (if exists)
  if (environment.thread !== undefined && environment.thread !== null) {
    parts.push(`**Thread**: ${environment.thread.name}`);
  }

  return parts.join('\n');
}
