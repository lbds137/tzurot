/**
 * Environment Formatter
 *
 * Formats Discord environment context (DM vs guild) for inclusion in system prompts.
 * Uses pure XML structure for clear LLM context separation.
 *
 * This is a thin wrapper around the shared formatLocationAsXml() function,
 * adding logging for the ai-worker context.
 */

import { createLogger, formatLocationAsXml, type DiscordEnvironment } from '@tzurot/common-types';

const logger = createLogger('EnvironmentFormatter');

/**
 * Format Discord environment context for inclusion in system prompt.
 * Returns a `<location>` XML element for embedding in the `<context>` section.
 *
 * Uses the shared formatLocationAsXml() from common-types (DRY with referenced messages).
 *
 * @param environment - Discord environment context (DM or guild)
 * @returns XML location element string
 */
export function formatEnvironmentContext(environment: DiscordEnvironment): string {
  logger.debug({ environment }, '[EnvironmentFormatter] Formatting environment context');

  if (environment.type === 'dm') {
    logger.info('[EnvironmentFormatter] Environment type: DM');
  } else {
    logger.info(
      {
        guildName: environment.guild?.name,
        channelName: environment.channel.name,
        channelType: environment.channel.type,
      },
      '[EnvironmentFormatter] Environment type: Guild'
    );
  }

  return formatLocationAsXml(environment);
}
