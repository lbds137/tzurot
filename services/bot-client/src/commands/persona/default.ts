/**
 * Persona Default Handler
 *
 * Sets a persona as the user's default persona.
 * The default persona is used when no personality-specific override is set.
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import { personaDefaultOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../utils/apiCheck.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

const logger = createLogger('persona-default');

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
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.setPersonaDefault(personaId);

    if (!result.ok) {
      if (result.error.includes('not found') || result.error.includes('Not found')) {
        await context.editReply({
          content: renderSpec(
            CATALOG.error.notFound('Persona', {
              hint: 'Use `/persona browse` to see your personas.',
            })
          ),
        });
        return;
      }

      logger.warn({ userId: discordId, personaId, error: result.error }, 'Failed to set default');
      await context.editReply({
        content: renderSpec(classifyGatewayFailure(result, 'default persona')),
      });
      return;
    }

    const { persona, alreadyDefault } = result.data;
    const displayName = persona.preferredName ?? persona.name;

    if (alreadyDefault) {
      await context.editReply({
        content: `ℹ️ **${displayName}** is already your default persona.`,
      });
      return;
    }

    logger.info({ userId: discordId, personaId, personaName: persona.name }, 'Set default');

    await context.editReply({
      content: `⭐ **${displayName}** is now your default persona.\n\nThis persona will be used when talking to characters that don't have a specific override set.`,
    });
  } catch (error) {
    logger.error({ err: error, userId: discordId }, 'Failed to set default');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'default persona', {
          failedAction: 'set the default persona',
        })
      ),
    });
  }
}
