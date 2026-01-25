/**
 * Environment Formatter
 *
 * Formats Discord environment context (DM vs guild) for inclusion in system prompts.
 * Uses pure XML structure for clear LLM context separation.
 *
 * Extracted from PromptBuilder for better modularity.
 */

import { createLogger, escapeXml } from '@tzurot/common-types';
import type { DiscordEnvironment } from '../ConversationalRAGService.js';

const logger = createLogger('EnvironmentFormatter');

/**
 * Format Discord environment context for inclusion in system prompt.
 * Returns a `<location>` XML element for embedding in the `<context>` section.
 *
 * DM output:
 * ```xml
 * <location type="dm">Direct Message (private one-on-one chat)</location>
 * ```
 *
 * Guild output:
 * ```xml
 * <location type="guild">
 *   <server name="Test Server"/>
 *   <category name="General"/>
 *   <channel name="chat" type="text" topic="Channel description here"/>
 *   <thread name="discussion"/>
 * </location>
 * ```
 *
 * The channel topic provides context about the channel's purpose (if set by server admins).
 *
 * @param environment - Discord environment context (DM or guild)
 * @returns XML location element string
 */
export function formatEnvironmentContext(environment: DiscordEnvironment): string {
  logger.debug({ environment }, '[EnvironmentFormatter] Formatting environment context');

  if (environment.type === 'dm') {
    logger.info('[EnvironmentFormatter] Environment type: DM');
    return '<location type="dm">Direct Message (private one-on-one chat)</location>';
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
  parts.push('<location type="guild">');

  // Guild name - escape to prevent prompt injection via malicious server names
  if (environment.guild !== undefined && environment.guild !== null) {
    parts.push(`<server name="${escapeXml(environment.guild.name)}"/>`);
  }

  // Category (if exists) - escape to prevent prompt injection
  if (
    environment.category !== undefined &&
    environment.category !== null &&
    environment.category.name.length > 0
  ) {
    parts.push(`<category name="${escapeXml(environment.category.name)}"/>`);
  }

  // Channel - escape to prevent prompt injection
  // Include topic if available (provides context about the channel's purpose)
  const topic = environment.channel.topic;
  const topicAttr = topic !== undefined && topic.length > 0 ? ` topic="${escapeXml(topic)}"` : '';
  parts.push(
    `<channel name="${escapeXml(environment.channel.name)}" type="${environment.channel.type}"${topicAttr}/>`
  );

  // Thread (if exists) - escape to prevent prompt injection
  if (environment.thread !== undefined && environment.thread !== null) {
    parts.push(`<thread name="${escapeXml(environment.thread.name)}"/>`);
  }

  parts.push('</location>');

  return parts.join('\n');
}
