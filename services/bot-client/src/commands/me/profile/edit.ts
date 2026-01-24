/**
 * Profile Edit Handler
 *
 * Opens the profile dashboard for editing profiles:
 * - Shows dashboard with profile info and edit options
 * - Delete button available (except for default profile)
 * - If no profile specified, edits the user's default profile
 * - If user has no profiles, shows instructions to create one
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import { createLogger } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../../utils/dashboard/index.js';
import {
  PROFILE_DASHBOARD_CONFIG,
  flattenProfileData,
  type FlattenedProfileData,
} from './config.js';
import { fetchProfile, fetchDefaultProfile } from './api.js';

const logger = createLogger('me-profile-edit');

/**
 * Handle /me profile edit [profile] command
 * Opens the profile dashboard for the selected or default profile
 *
 * @param context - The deferred command context
 * @param profileId - Optional profile ID from autocomplete. If null, edit default profile.
 */
export async function handleEditProfile(
  context: DeferredCommandContext,
  profileId?: string | null
): Promise<void> {
  const userId = context.user.id;

  try {
    let profile;

    if (profileId !== null && profileId !== undefined) {
      // Fetch specific profile
      profile = await fetchProfile(profileId, userId);

      if (!profile) {
        await context.editReply({
          content: '❌ Profile not found. Use `/me profile list` to see your profiles.',
        });
        return;
      }
    } else {
      // Fetch default profile
      profile = await fetchDefaultProfile(userId);

      if (!profile) {
        await context.editReply({
          content:
            "❌ You don't have any profiles yet.\n\n" +
            'Use `/me profile create` to create your first profile.',
        });
        return;
      }
    }

    // Flatten the data for dashboard display
    const flattenedData = flattenProfileData(profile);

    // Build dashboard embed and components
    const embed = buildDashboardEmbed(PROFILE_DASHBOARD_CONFIG, flattenedData);
    const components = buildDashboardComponents(
      PROFILE_DASHBOARD_CONFIG,
      profile.id,
      flattenedData,
      {
        showClose: true,
        showRefresh: true,
        showDelete: !profile.isDefault, // Can't delete default profile
      }
    );

    // Send dashboard
    const reply = await context.editReply({ embeds: [embed], components });

    // Create session for tracking
    const sessionManager = getSessionManager();
    await sessionManager.set<FlattenedProfileData>({
      userId,
      entityType: 'profile',
      entityId: profile.id,
      data: flattenedData,
      messageId: reply.id,
      channelId: context.channelId,
    });

    logger.info({ userId, profileId: profile.id, name: profile.name }, 'Opened profile dashboard');
  } catch (error) {
    logger.error({ err: error, profileId }, 'Failed to open profile dashboard');
    await context.editReply({ content: '❌ Failed to load profile. Please try again.' });
  }
}
