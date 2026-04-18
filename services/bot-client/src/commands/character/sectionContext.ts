/**
 * Character Section Context Resolver
 *
 * Shared preamble for handlers that need to act on a specific section of
 * a specific character: resolve admin status, build the dashboard config,
 * locate the section, and fetch (or session-cache) the current data.
 *
 * Three consumers at extraction time (rule-of-three trigger):
 * - `dashboard.ts` `handleSelectMenu` — when a user picks a section to edit
 * - `truncationWarning.ts` `handleEditTruncatedButton` — the opt-in edit path
 *   after a destructive-action warning
 * - `truncationWarning.ts` `handleViewFullButton` — the read-only inspection
 *   path for over-length legacy content
 *
 * On any failure (unknown section, character fetch miss), the helper
 * replies to the interaction with an ephemeral error and returns `null`.
 * Callers just check for null and return; no further error handling.
 *
 * Scope-limited to character. Persona/preset dashboards use the same
 * SessionManager + DashboardConfig abstractions but have their own
 * entity types / fetch functions — lifting this across entities would
 * need the kind of entity-agnostic parameterization that violates the
 * rule-of-three until those dashboards actually hit the same pattern.
 */

import { MessageFlags } from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { isBotOwner, type EnvConfig } from '@tzurot/common-types';
import {
  type DashboardConfig,
  type DashboardContext,
  type SectionDefinition,
} from '../../utils/dashboard/types.js';
import { fetchOrCreateSession } from '../../utils/dashboard/sessionHelpers.js';
import { DASHBOARD_MESSAGES } from '../../utils/dashboard/messages.js';
import {
  getCharacterDashboardConfig,
  type CharacterData,
  type CharacterSessionData,
} from './config.js';
import { fetchCharacter } from './api.js';

/**
 * Bundle returned by {@link resolveCharacterSectionContext} on success.
 * Holds everything a downstream section handler typically needs.
 */
export interface CharacterSectionContext {
  isAdmin: boolean;
  dashboardConfig: DashboardConfig<CharacterData>;
  section: SectionDefinition<CharacterData>;
  data: CharacterData;
  context: DashboardContext;
}

/**
 * Resolve the full context needed by a character section handler.
 *
 * On failure (unknown section / missing character), sends an ephemeral
 * error reply to `interaction` and returns `null` — caller should return.
 *
 * `hasVoiceReference` is pinned to `false` because this helper's output
 * is used for section field lookup and modal building, never for the
 * voice-gated dashboard action rendering. See the matching note in
 * `dashboard.ts` `handleSelectMenu`.
 */
export async function resolveCharacterSectionContext(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  entityId: string,
  sectionId: string,
  config: EnvConfig
): Promise<CharacterSectionContext | null> {
  const isAdmin = isBotOwner(interaction.user.id);
  const dashboardConfig = getCharacterDashboardConfig(isAdmin, false);
  const section = dashboardConfig.sections.find(s => s.id === sectionId);
  if (!section) {
    await replyError(interaction, '❌ Unknown section.');
    return null;
  }

  const result = await fetchOrCreateSession<CharacterSessionData, CharacterData>({
    userId: interaction.user.id,
    entityType: 'character',
    entityId,
    fetchFn: () => fetchCharacter(entityId, config, interaction.user.id),
    transformFn: (character: CharacterData) => ({ ...character, _isAdmin: isAdmin }),
    interaction,
  });
  if (!result.success) {
    await replyError(interaction, DASHBOARD_MESSAGES.NOT_FOUND('Character'));
    return null;
  }

  const context: DashboardContext = { isAdmin, userId: interaction.user.id };
  return { isAdmin, dashboardConfig, section, data: result.data, context };
}

/**
 * Reply with an ephemeral error, adapting to whether the caller has
 * already acked the interaction. Callers that `deferReply`-ed before
 * invoking this helper need `followUp`; fresh callers need `reply`.
 * Checking `interaction.deferred || interaction.replied` lets the helper
 * work transparently under both call shapes.
 */
async function replyError(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  content: string
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}
