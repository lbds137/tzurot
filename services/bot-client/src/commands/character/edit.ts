/**
 * Character Edit Handler
 *
 * Opens the dashboard for editing an existing character.
 */

import {
  createLogger,
  isBotOwner,
  type EnvConfig,
  characterEditOptions,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import {
  getCharacterDashboardConfig,
  buildCharacterDashboardOptions,
  type CharacterSessionData,
} from './config.js';
import { fetchCharacter } from './api.js';

const logger = createLogger('character-edit');

/**
 * Handle the edit subcommand - show dashboard for selected character
 */
export async function handleEdit(
  context: DeferredCommandContext,
  config: EnvConfig
): Promise<void> {
  const options = characterEditOptions(context.interaction);
  const slug = options.character();
  const userId = context.user.id;

  try {
    // Fetch character data from API
    const character = await fetchCharacter(slug, config, userId);
    if (!character) {
      await context.editReply({ content: `❌ Character \`${slug}\` not found or not accessible.` });
      return;
    }

    // Use server-side permission check (compares internal User UUIDs, not Discord IDs)
    if (!character.canEdit) {
      await context.editReply({
        content:
          `❌ You don't have permission to edit \`${slug}\`.\n` +
          'You can only edit characters you own.',
      });
      return;
    }

    // Check if user is a bot admin (for admin-only sections)
    const isAdmin = isBotOwner(userId);
    const dashboardConfig = getCharacterDashboardConfig(isAdmin);

    // Build and send dashboard
    // Use slug as entityId (not UUID) because fetchCharacter expects slug
    const embed = buildDashboardEmbed(dashboardConfig, character);
    const components = buildDashboardComponents(
      dashboardConfig,
      character.slug,
      character,
      buildCharacterDashboardOptions(character)
    );

    const reply = await context.editReply({ embeds: [embed], components });

    // Create session for tracking (keyed by slug)
    // Store _isAdmin for later interactions (but always re-verify on sensitive operations)
    const sessionManager = getSessionManager();
    const sessionData: CharacterSessionData = { ...character, _isAdmin: isAdmin };
    await sessionManager.set({
      userId,
      entityType: 'character',
      entityId: character.slug,
      data: sessionData,
      messageId: reply.id,
      channelId: context.channelId,
    });

    logger.info({ userId, slug: character.slug, isAdmin }, 'Character dashboard opened');
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to open character dashboard');
    await context.editReply({ content: '❌ Failed to load character. Please try again.' });
  }
}
