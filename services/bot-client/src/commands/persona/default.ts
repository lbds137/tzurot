/**
 * Me Default Handler
 *
 * Sets a profile as the user's default profile.
 * The default profile is used when no personality-specific override is set.
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import { createLogger } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('me-default');

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
 * Handle /me profile default <profile> command
 */
export async function handleSetDefaultPersona(context: DeferredCommandContext): Promise<void> {
  const discordId = context.user.id;
  const personaId = context.interaction.options.getString('profile', true);

  try {
    // Set default via gateway API
    const result = await callGatewayApi<SetDefaultResponse>(`/user/persona/${personaId}/default`, {
      userId: discordId,
      method: 'PATCH',
    });

    if (!result.ok) {
      // Handle specific error cases
      if (result.error?.includes('not found') || result.error?.includes('Not found')) {
        await context.editReply({
          content: '❌ Profile not found. Use `/me profile list` to see your profiles.',
        });
        return;
      }

      logger.warn(
        { userId: discordId, personaId, error: result.error },
        '[Me] Failed to set default profile'
      );
      await context.editReply({
        content: '❌ Failed to set default profile. Please try again later.',
      });
      return;
    }

    const { persona, alreadyDefault } = result.data;
    const displayName = persona.preferredName ?? persona.name;

    // Check if already default
    if (alreadyDefault === true) {
      await context.editReply({
        content: `ℹ️ **${displayName}** is already your default profile.`,
      });
      return;
    }

    logger.info(
      { userId: discordId, personaId, personaName: persona.name },
      '[Me] Set default profile'
    );

    await context.editReply({
      content: `⭐ **${displayName}** is now your default profile.\n\nThis profile will be used when talking to personalities that don't have a specific override set.`,
    });
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Me] Failed to set default profile');
    await context.editReply({
      content: '❌ Failed to set default profile. Please try again later.',
    });
  }
}
