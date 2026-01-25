/**
 * Environment Formatter
 *
 * Formats Discord environment context as XML for inclusion in AI prompts.
 * Shared between bot-client (for referenced messages) and ai-worker (for current context).
 *
 * This is the single source of truth for location context formatting.
 */

import type { DiscordEnvironment } from '../types/schemas.js';
import { escapeXml } from './xmlBuilder.js';

/**
 * Format Discord environment context as XML location element.
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
 * @param environment - Discord environment context (DM or guild)
 * @returns XML location element string
 */
export function formatLocationAsXml(environment: DiscordEnvironment): string {
  if (environment.type === 'dm') {
    return '<location type="dm">Direct Message (private one-on-one chat)</location>';
  }

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
