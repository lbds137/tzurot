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

import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import {
  PERSONA_DASHBOARD_CONFIG,
  flattenPersonaData,
  buildPersonaDashboardOptions,
  type FlattenedPersonaData,
} from './config.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { fetchPersona, fetchDefaultPersona } from './api.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

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
    const { userClient } = clientsFor(context.interaction);
    let persona;

    if (personaId !== null && personaId !== undefined) {
      persona = await fetchPersona(personaId, userClient, userId);

      if (!persona) {
        await context.editReply({
          content: renderSpec(
            CATALOG.error.notFound('Persona', {
              hint: 'Use `/persona browse` to see your personas.',
            })
          ),
        });
        return;
      }
    } else {
      persona = await fetchDefaultPersona(userClient, userId);

      if (!persona) {
        await context.editReply({
          content: renderSpec(
            CATALOG.error.notFound('Persona', {
              hint: "You don't have any personas yet — use `/persona create` to make your first.",
            })
          ),
        });
        return;
      }
    }

    // Flatten the data for dashboard display
    const flattenedData = flattenPersonaData(persona);

    // Build dashboard embed and components using shared options builder
    const embed = buildDashboardEmbed(PERSONA_DASHBOARD_CONFIG, flattenedData);
    const components = buildDashboardComponents(
      PERSONA_DASHBOARD_CONFIG,
      persona.id,
      flattenedData,
      buildPersonaDashboardOptions(flattenedData)
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
    await context.editReply({
      content: renderSpec(classifyGatewayFailure(error, 'persona', { operation: 'read' })),
    });
  }
}
