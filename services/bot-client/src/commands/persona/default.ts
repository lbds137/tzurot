/**
 * Persona Default Handler
 *
 * Sets a persona as the user's default persona.
 * The default persona is used when no personality-specific override is set.
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import { createLogger, personaDefaultOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../utils/apiCheck.js';
import { callGatewayApi, toGatewayUser } from '../../utils/userGatewayClient.js';

const logger = createLogger('persona-default');

/** Response type for setting default persona */
interface SetDefaultResponse {
  success: boolean;
  persona: {
    id: string;
    name: string;
    preferredName: string | null;
  };
  alreadyDefault?: boolean;
}

/**
 * Handle /persona default <persona> command
 */
export async function handleSetDefaultPersona(context: DeferredCommandContext): Promise<void> {
  const discordId = context.user.id;
  const options = personaDefaultOptions(context.interaction);
  const personaId = options.persona();

  if (isAutocompleteErrorSentinel(personaId)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  try {
    // Set default via gateway API
    const result = await callGatewayApi<SetDefaultResponse>(
      `/user/persona/${encodeURIComponent(personaId)}/default`,
      {
        user: toGatewayUser(context.user),
        method: 'PATCH',
      }
    );

    if (!result.ok) {
      // Handle specific error cases
      if (result.error?.includes('not found') || result.error?.includes('Not found')) {
        await context.editReply({
          content: '❌ Persona not found. Use `/persona browse` to see your personas.',
        });
        return;
      }

      logger.warn({ userId: discordId, personaId, error: result.error }, 'Failed to set default');
      await context.editReply({
        content: '❌ Failed to set default persona. Please try again later.',
      });
      return;
    }

    const { persona, alreadyDefault } = result.data;
    const displayName = persona.preferredName ?? persona.name;

    // Check if already default
    if (alreadyDefault === true) {
      await context.editReply({
        content: `ℹ️ **${displayName}** is already your default persona.`,
      });
      return;
    }

    logger.info({ userId: discordId, personaId, personaName: persona.name }, 'Set default');

    await context.editReply({
      content: `⭐ **${displayName}** is now your default persona.\n\nThis persona will be used when talking to personalities that don't have a specific override set.`,
    });
  } catch (error) {
    logger.error({ err: error, userId: discordId }, 'Failed to set default');
    await context.editReply({
      content: '❌ Failed to set default persona. Please try again later.',
    });
  }
}
