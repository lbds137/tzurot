/**
 * Environment Formatter
 *
 * Formats Discord environment context as XML for inclusion in AI prompts.
 * Shared between bot-client (for referenced messages) and ai-worker (for current context).
 *
 * This is the single source of truth for location context formatting.
 */

import type { DiscordEnvironment } from '../types/schemas/index.js';
import { escapeXml } from './xmlBuilder.js';

/** Rendering options for {@link formatLocationAsXml}. */
export interface FormatLocationOptions {
  /**
   * `'prior'` marks the element as a PAST conversation in a DIFFERENT channel,
   * emitting `scope="prior"`. Omitted entirely by default, so the no-options
   * output stays byte-identical for the cacheable system-prefix call sites.
   */
  scope?: 'prior';
}

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
 * @param opts - Optional rendering options; omitted entirely keeps the output
 *   byte-identical to the no-options form (cacheable system-prefix call sites
 *   depend on this — pinned by test)
 * @returns XML location element string
 */
export function formatLocationAsXml(
  environment: DiscordEnvironment,
  opts?: FormatLocationOptions
): string {
  const scopeAttr = opts?.scope === 'prior' ? ' scope="prior"' : '';

  if (environment.type === 'dm') {
    return `<location type="dm"${scopeAttr}>Direct Message (private one-on-one chat)</location>`;
  }

  const parts: string[] = [];
  parts.push(`<location type="guild"${scopeAttr}>`);

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
    `<channel name="${escapeXml(environment.channel.name)}" type="${escapeXml(environment.channel.type)}"${topicAttr}/>`
  );

  // Thread (if exists) - escape to prevent prompt injection
  if (environment.thread !== undefined && environment.thread !== null) {
    parts.push(`<thread name="${escapeXml(environment.thread.name)}"/>`);
  }

  parts.push('</location>');

  return parts.join('\n');
}
