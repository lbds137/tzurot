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
