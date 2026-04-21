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
import { getCharacterDashboardConfig, type CharacterSessionData } from './config.js';
import type { CharacterData } from './characterTypes.js';
import { toGatewayUser } from '../../utils/userGatewayClient.js';
import { fetchCharacter } from './api.js';

/**
 * Pure-sync portion of the section resolution. Split out so callers that
 * need the section label _before_ they can await (e.g., the two-click
 * Edit-with-Truncation flow's step 1, which must `interaction.update`
 * within the 3-second budget) can get the section without paying for a
 * redundant dashboard-config build later.
 */
export interface CharacterSectionSync {
  isAdmin: boolean;
  dashboardConfig: DashboardConfig<CharacterData>;
  section: SectionDefinition<CharacterData>;
  context: DashboardContext;
}

/**
 * Bundle returned by {@link resolveCharacterSectionContext} on success.
 * Holds everything a downstream section handler typically needs.
 */
export interface CharacterSectionContext extends CharacterSectionSync {
  data: CharacterData;
}

/**
 * Sync helper: resolve `isAdmin` + dashboard config + section lookup from
 * static inputs. No Redis, no gateway — safe to call before any
 * `interaction.update` / `deferReply` ack.
 *
 * Returns `null` if the section id is unknown. Callers are expected to
 * handle the null case themselves (send an ephemeral error, etc.) — this
 * helper does not touch the interaction so it can be called in contexts
 * that are post-ack and post-response.
 *
 * `hasVoiceReference` is pinned to `false` because the output is used
 * for section field lookup / modal building, never for voice-gated
 * action rendering. See the matching note in `dashboard.ts`
 * `handleSelectMenu`.
 */
export function findCharacterSection(
  sectionId: string,
  userId: string
): CharacterSectionSync | null {
  const isAdmin = isBotOwner(userId);
  const dashboardConfig = getCharacterDashboardConfig(isAdmin, false);
  const section = dashboardConfig.sections.find(s => s.id === sectionId);
  if (!section) {
    return null;
  }
  const context: DashboardContext = { isAdmin, userId };
  return { isAdmin, dashboardConfig, section, context };
}

/**
 * Given an already-resolved sync bundle, fetch the character data (Redis
 * session cache → gateway fallback) and assemble the full context.
 *
 * Extracted so callers that already did the sync resolution (to render a
 * label before an `update` ack) can avoid rebuilding the dashboard config
 * when they later need the data. On character-fetch miss, sends an
 * ephemeral error and returns `null`.
 */
export async function loadCharacterSectionData(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  entityId: string,
  config: EnvConfig,
  sync: CharacterSectionSync
): Promise<CharacterSectionContext | null> {
  const result = await fetchOrCreateSession<CharacterSessionData, CharacterData>({
    userId: interaction.user.id,
    entityType: 'character',
    entityId,
    fetchFn: () => fetchCharacter(entityId, config, toGatewayUser(interaction.user)),
    transformFn: (character: CharacterData) => ({ ...character, _isAdmin: sync.isAdmin }),
    interaction,
  });
  if (!result.success) {
    await replyError(interaction, DASHBOARD_MESSAGES.NOT_FOUND('Character'));
    return null;
  }
  return { ...sync, data: result.data };
}

/**
 * Resolve the full context needed by a character section handler.
 *
 * On failure (unknown section / missing character), sends an ephemeral
 * error reply to `interaction` and returns `null` — caller should return.
 *
 * This is the combined-path helper most callers want. Callers that need
 * the section label _before_ an async ack (two-click edit flow, step 1)
 * should call {@link findCharacterSection} + {@link loadCharacterSectionData}
 * separately so the dashboard-config build happens only once per request.
 */
export async function resolveCharacterSectionContext(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  entityId: string,
  sectionId: string,
  config: EnvConfig
): Promise<CharacterSectionContext | null> {
  const sync = findCharacterSection(sectionId, interaction.user.id);
  if (sync === null) {
    await replyError(interaction, '❌ Unknown section.');
    return null;
  }
  return loadCharacterSectionData(interaction, entityId, config, sync);
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
