/**
 * Persona Override Clear Handler
 *
 * Allows users to clear persona overrides for specific characters.
 * After clearing, the user's default persona will be used instead.
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import { personaOverrideClearOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../../utils/apiCheck.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { CATALOG } from '../../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../../ux/catalog/classify.js';
import { renderSpec } from '../../../ux/render/render.js';
import { escapeMarkdown } from 'discord.js';

const logger = createLogger('persona-override-clear');

/**
 * Handle /persona override clear <personality> - Remove override
 */
export async function handleOverrideClear(context: DeferredCommandContext): Promise<void> {
  const discordId = context.user.id;
  const options = personaOverrideClearOptions(context.interaction);
  const personalitySlug = options.character();

  if (isAutocompleteErrorSentinel(personalitySlug)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.clearPersonaOverride(personalitySlug);

    if (!result.ok) {
      if (result.error.includes('Personality not found') || result.error.includes('not found')) {
        await context.editReply({
          content: renderSpec(
            CATALOG.error.notFound('Character', { name: escapeMarkdown(personalitySlug) })
          ),
        });
        return;
      }

      if (result.error.includes('no account') || result.error.includes('User')) {
        await context.editReply({
          content: renderSpec(
            CATALOG.error.validation(
              "You don't have an account yet. Send a message to any character to create one!"
            )
          ),
        });
        return;
      }

      logger.warn(
        { userId: discordId, personalitySlug, error: result.error },
        'Failed to clear override via gateway'
      );
      await context.editReply({
        content: renderSpec(classifyGatewayFailure(result, 'persona override')),
      });
      return;
    }

    const { personality, hadOverride } = result.data;
    const personalityName = personality.displayName ?? personality.name;

    if (!hadOverride) {
      await context.editReply({
        content: `ℹ️ You don't have a persona override set for ${personalityName}.`,
      });
      return;
    }

    logger.info({ userId: discordId, personalityId: personality.id }, 'Cleared persona override');

    await context.editReply({
      content: `✅ **Persona override cleared for ${personalityName}!**\n\nYour default persona will now be used when talking to ${personalityName}.`,
    });
  } catch (error) {
    logger.error({ err: error, userId: discordId }, 'Failed to clear override');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'persona override', {
          failedAction: 'clear the persona override',
        })
      ),
    });
  }
}
