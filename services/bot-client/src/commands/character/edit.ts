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
import { getCharacterDashboardConfig, type CharacterData } from './config.js';
import { fetchCharacter } from './api.js';

const logger = createLogger('character-edit');

/**
 * Extended character data with admin flag for session storage.
 *
 * Note: The underscore prefix (`_isAdmin`) indicates session-only metadata
 * that is NOT persisted to the database. This flag is stored for debugging
 * and audit purposes, but is NEVER trusted for authorization decisions.
 * All sensitive operations must re-verify admin status via `isBotOwner()`.
 */
export interface CharacterSessionData extends CharacterData {
  /**
   * Whether the session was opened by a bot admin.
   * Stored for audit/debugging only - always re-verify with isBotOwner() for authorization.
   */
  _isAdmin?: boolean;
}

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
    const components = buildDashboardComponents(dashboardConfig, character.slug, character, {
      showClose: true,
      showRefresh: true,
      showDelete: character.canEdit, // Only show delete for owned characters
    });

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
