/**
 * Environment Formatter
 *
 * Formats Discord environment context (DM vs guild) as the system message's
 * `<location>` section, rendered ahead of chat_log — the location is stable
 * for the channel, so it lives in the cacheable prefix.
 * Uses pure XML structure for clear LLM context separation.
 *
 * This is a thin wrapper around the shared formatLocationAsXml() function,
 * adding logging for the ai-worker context.
 */

import { type DiscordEnvironment } from '@tzurot/common-types/types/schemas/discord';
import { formatLocationAsXml } from '@tzurot/common-types/utils/environmentFormatter';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { escapeXml } from '@tzurot/common-types/utils/xmlBuilder';

const logger = createLogger('EnvironmentFormatter');

/**
 * Format Discord environment context for the system message's location
 * section.
 * Returns a `<location>` XML element rendered as its own S1 section.
 *
 * Uses the shared formatLocationAsXml() from common-types (DRY with referenced messages).
 *
 * @param environment - Discord environment context (DM or guild)
 * @returns XML location element string
 */
export function formatEnvironmentContext(environment: DiscordEnvironment): string {
  logger.debug({ environment }, 'Formatting environment context');

  if (environment.type === 'dm') {
    logger.info('Environment type: DM');
  } else {
    logger.info(
      {
        guildName: environment.guild?.name,
        channelName: environment.channel.name,
        channelType: environment.channel.type,
      },
      'Environment type: Guild'
    );
  }

  return formatLocationAsXml(environment);
}

/**
 * Format the current channel as a single compact `<current_location>` line for
 * the volatile prefix.
 *
 * The full `<location>` block stays in the cacheable system prefix; this echo
 * pins the current channel near the generation point, where it must outcompete
 * the `<location>` blocks inside `<prior_conversations>` and the legacy
 * location spans baked into memory content — which otherwise outnumber and
 * out-position the single system-message location.
 *
 * Guild output is one line: `server "X" › category "Y" › channel #z › thread "W"`,
 * with the category and thread segments omitted when absent. The channel topic
 * is deliberately excluded — this is a pointer, not a description.
 *
 * @param environment - Discord environment context; undefined/null renders as DM
 * @returns A single `<current_location>` element string
 */
export function formatCurrentLocationLine(
  environment: DiscordEnvironment | undefined | null
): string {
  if (environment === undefined || environment === null || environment.type === 'dm') {
    return '<current_location>Direct Message (private one-on-one chat)</current_location>';
  }

  const segments: string[] = [];

  if (environment.guild !== undefined && environment.guild !== null) {
    segments.push(`server "${escapeXml(environment.guild.name)}"`);
  }
  if (
    environment.category !== undefined &&
    environment.category !== null &&
    environment.category.name.length > 0
  ) {
    segments.push(`category "${escapeXml(environment.category.name)}"`);
  }
  segments.push(`channel #${escapeXml(environment.channel.name)}`);
  if (environment.thread !== undefined && environment.thread !== null) {
    segments.push(`thread "${escapeXml(environment.thread.name)}"`);
  }

  return `<current_location>${segments.join(' › ')}</current_location>`;
}
