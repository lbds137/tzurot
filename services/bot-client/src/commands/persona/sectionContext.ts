/**
 * Persona Section Context Resolver
 *
 * Shared preamble for persona-section handlers: build the dashboard
 * config, locate the section, and fetch (or session-cache) the current
 * data. Mirrors `commands/character/sectionContext.ts` but for persona.
 *
 * Differences from character:
 * - No `isAdmin` — persona is strictly owner-scoped (each user owns
 *   their own personas; no cross-user admin edit).
 * - `fetchPersona(personaId, user)` takes a `GatewayUser` instead of
 *   the `(entityId, config, user)` triple character uses; the persona
 *   gateway client is internally configured.
 *
 * Three consumers at extraction time:
 * - `dashboard.ts` `handleSelectMenu` — when a user picks the section to edit
 * - `truncationWarning.ts` `handleEditTruncatedButton` — the opt-in edit path
 * - `truncationWarning.ts` `handleViewFullButton` — the read-only inspection
 *   path for over-length legacy content
 */

import { MessageFlags } from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { type DashboardConfig, type SectionDefinition } from '../../utils/dashboard/types.js';
import { fetchOrCreateSession } from '../../utils/dashboard/sessionHelpers.js';
import { DASHBOARD_MESSAGES } from '../../utils/dashboard/messages.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import {
  PERSONA_DASHBOARD_CONFIG,
  type FlattenedPersonaData,
  flattenPersonaData,
} from './config.js';
import { fetchPersona } from './api.js';
import type { PersonaDetails } from './types.js';

/**
 * Pure-sync portion of the section resolution. Split out so callers that
 * need the section label _before_ they can await (e.g., the two-click
 * Edit-with-Truncation flow's step 1, which must `interaction.update`
 * within the 3-second budget) can get the section without paying for a
 * redundant dashboard-config build later.
 */
export interface PersonaSectionSync {
  dashboardConfig: DashboardConfig<FlattenedPersonaData>;
  section: SectionDefinition<FlattenedPersonaData>;
}

/**
 * Bundle returned by {@link resolvePersonaSectionContext} on success.
 */
export interface PersonaSectionContext extends PersonaSectionSync {
  data: FlattenedPersonaData;
}

/**
 * Sync helper: resolve dashboard config + section lookup from static
 * inputs. No Redis, no gateway — safe to call before any
 * `interaction.update` / `deferReply` ack.
 *
 * Returns `null` if the section id is unknown.
 */
export function findPersonaSection(sectionId: string): PersonaSectionSync | null {
  const dashboardConfig = PERSONA_DASHBOARD_CONFIG;
  const section = dashboardConfig.sections.find(s => s.id === sectionId);
  if (!section) {
    return null;
  }
  return { dashboardConfig, section };
}

/**
 * Given an already-resolved sync bundle, fetch the persona data (Redis
 * session cache → gateway fallback) and assemble the full context.
 *
 * On persona-fetch miss, sends an ephemeral error reply and returns
 * `null`.
 */
export async function loadPersonaSectionData(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  entityId: string,
  sync: PersonaSectionSync
): Promise<PersonaSectionContext | null> {
  const { userClient } = clientsFor(interaction);
  const userId = interaction.user.id;
  const result = await fetchOrCreateSession<FlattenedPersonaData, PersonaDetails>({
    userId,
    entityType: 'persona',
    entityId,
    fetchFn: () => fetchPersona(entityId, userClient, userId),
    transformFn: flattenPersonaData,
    interaction,
  });
  if (!result.success) {
    await replyError(interaction, DASHBOARD_MESSAGES.NOT_FOUND('Persona'));
    return null;
  }
  return { ...sync, data: result.data };
}

/**
 * Resolve the full context needed by a persona section handler.
 *
 * On failure (unknown section / missing persona), sends an ephemeral
 * error reply and returns `null`.
 */
export async function resolvePersonaSectionContext(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  entityId: string,
  sectionId: string
): Promise<PersonaSectionContext | null> {
  const sync = findPersonaSection(sectionId);
  if (sync === null) {
    await replyError(interaction, '❌ Unknown section.');
    return null;
  }
  return loadPersonaSectionData(interaction, entityId, sync);
}

/**
 * Reply with an ephemeral error, adapting to the interaction's ack state.
 *
 * - `deferred && !replied` → `editReply` fills the deferred slot (replaces
 *   the loading indicator instead of leaving it dangling + spawning a
 *   separate followUp).
 * - `replied` → `followUp` for an additional ephemeral message.
 * - fresh → `reply`.
 *
 * **PRECONDITION (deferred path)**: Callers must have called
 * `deferReply({ flags: MessageFlags.Ephemeral })`. `editReply` inherits
 * the deferred slot's flags; a non-ephemeral defer would expose the
 * error publicly. See `commands/character/sectionContext.ts` for the
 * canonical longer rationale.
 */
async function replyError(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  content: string
): Promise<void> {
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ content });
  } else if (interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}
