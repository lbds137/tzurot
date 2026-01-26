/**
 * Persona Edit Handler
 *
 * Opens the persona dashboard for editing personas:
 * - Shows dashboard with persona info and edit options
 * - Delete button available (except for default persona)
 * - If no persona specified, edits the user's default persona
 * - If user has no personas, shows instructions to create one
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import { createLogger } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import {
  PERSONA_DASHBOARD_CONFIG,
  flattenPersonaData,
  type FlattenedPersonaData,
} from './config.js';
import { fetchPersona, fetchDefaultPersona } from './api.js';

const logger = createLogger('persona-edit');

/**
 * Handle /persona edit [persona] command
 * Opens the persona dashboard for the selected or default persona
 *
 * @param context - The deferred command context
 * @param personaId - Optional persona ID from autocomplete. If null, edit default persona.
 */
export async function handleEditPersona(
  context: DeferredCommandContext,
  personaId?: string | null
): Promise<void> {
  const userId = context.user.id;

  try {
    let persona;

    if (personaId !== null && personaId !== undefined) {
      // Fetch specific persona
      persona = await fetchPersona(personaId, userId);

      if (!persona) {
        await context.editReply({
          content: '❌ Persona not found. Use `/persona browse` to see your personas.',
        });
        return;
      }
    } else {
      // Fetch default persona
      persona = await fetchDefaultPersona(userId);

      if (!persona) {
        await context.editReply({
          content:
            "❌ You don't have any personas yet.\n\n" +
            'Use `/persona create` to create your first persona.',
        });
        return;
      }
    }

    // Flatten the data for dashboard display
    const flattenedData = flattenPersonaData(persona);

    // Build dashboard embed and components
    const embed = buildDashboardEmbed(PERSONA_DASHBOARD_CONFIG, flattenedData);
    const components = buildDashboardComponents(
      PERSONA_DASHBOARD_CONFIG,
      persona.id,
      flattenedData,
      {
        showClose: true,
        showRefresh: true,
        showDelete: !persona.isDefault, // Can't delete default persona
      }
    );

    // Send dashboard
    const reply = await context.editReply({ embeds: [embed], components });

    // Create session for tracking
    const sessionManager = getSessionManager();
    await sessionManager.set<FlattenedPersonaData>({
      userId,
      entityType: 'persona', // IMPORTANT: Matches command name for routing
      entityId: persona.id,
      data: flattenedData,
      messageId: reply.id,
      channelId: context.channelId,
    });

    logger.info({ userId, personaId: persona.id, name: persona.name }, 'Opened persona dashboard');
  } catch (error) {
    logger.error({ err: error, personaId }, 'Failed to open persona dashboard');
    await context.editReply({ content: '❌ Failed to load persona. Please try again.' });
  }
}
