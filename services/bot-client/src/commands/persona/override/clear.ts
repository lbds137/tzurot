/**
 * Persona Override Clear Handler
 *
 * Allows users to clear persona overrides for specific personalities.
 * After clearing, the user's default persona will be used instead.
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import { createLogger } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';

const logger = createLogger('persona-override-clear');

/** Response type for clearing override */
interface ClearOverrideResponse {
  success: boolean;
  personality: {
    id: string;
    name: string;
    displayName: string | null;
  };
  hadOverride: boolean;
}

/**
 * Handle /persona override clear <personality> - Remove override
 */
export async function handleOverrideClear(context: DeferredCommandContext): Promise<void> {
  const discordId = context.user.id;
  const personalitySlug = context.interaction.options.getString('personality', true);

  try {
    // Clear override via gateway
    const result = await callGatewayApi<ClearOverrideResponse>(
      `/user/persona/override/${personalitySlug}`,
      {
        userId: discordId,
        method: 'DELETE',
      }
    );

    if (!result.ok) {
      // Handle specific errors
      if (result.error?.includes('Personality not found') || result.error?.includes('not found')) {
        await context.editReply({
          content: `❌ Personality "${personalitySlug}" not found.`,
        });
        return;
      }

      if (result.error?.includes('no account') || result.error?.includes('User')) {
        await context.editReply({
          content:
            "❌ You don't have an account yet. Send a message to any personality to create one!",
        });
        return;
      }

      logger.warn(
        { userId: discordId, personalitySlug, error: result.error },
        '[Persona] Failed to clear override via gateway'
      );
      await context.editReply({
        content: '❌ Failed to clear persona override. Please try again later.',
      });
      return;
    }

    const { personality, hadOverride } = result.data;
    const personalityName = personality.displayName ?? personality.name;

    if (!hadOverride) {
      await context.editReply({
        content: `ℹ️ You don't have a profile override set for ${personalityName}.`,
      });
      return;
    }

    logger.info(
      { userId: discordId, personalityId: personality.id },
      '[Persona] Cleared persona override'
    );

    await context.editReply({
      content: `✅ **Profile override cleared for ${personalityName}!**\n\nYour default persona will now be used when talking to ${personalityName}.`,
    });
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Persona] Failed to clear override');
    await context.editReply({
      content: '❌ Failed to clear persona override. Please try again later.',
    });
  }
}
