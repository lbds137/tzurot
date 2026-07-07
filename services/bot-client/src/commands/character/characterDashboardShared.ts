/**
 * Shared open-dashboard flow for the two character cascade dashboards
 * (`/character overrides` — any user's own tier, and `/character settings`
 * — creator-only personality defaults). The flow is identical: resolve the
 * character by slug, 404 politely, resolve the relevant cascade tier,
 * convert to dashboard data, open the settings dashboard. What differs is
 * pure configuration — the dashboard config, which cascade endpoint to
 * resolve (the one callback), the source tier, and the error-copy noun —
 * so this stays a directory-LOCAL helper: same-family duplication gets a
 * same-family solution, not a top-level utility.
 */

import { type ResolvedConfigOverrides } from '@tzurot/common-types/schemas/api/configOverrides';
import type { createLogger } from '@tzurot/common-types/utils/logger';
import type { UserClient } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import {
  type SettingsDashboardConfig,
  createSettingsDashboard,
} from '../../utils/dashboard/settings/index.js';
import { convertCascadeToSettingsData } from '../../utils/dashboard/settings/settingsUpdateFactory.js';

type Logger = ReturnType<typeof createLogger>;

export interface CharacterDashboardSpec {
  dashboardConfig: SettingsDashboardConfig;
  /** Which cascade the dashboard shows — feeds the source-indicator badges. */
  sourceTier: 'user-personality' | 'personality';
  /** The one genuine divergence: which cascade endpoint backs this view. */
  resolveCascade: (
    userClient: UserClient,
    personalityId: string
  ) => Promise<{ ok: true; data: ResolvedConfigOverrides } | { ok: false; error: string }>;
  /** Error-copy noun — narrowed so a future caller can't typo it silently. */
  noun: 'overrides' | 'settings';
  logger: Logger;
}

/** Open a character cascade dashboard: slug → personality → cascade → dashboard. */
export async function openCharacterCascadeDashboard(
  context: DeferredCommandContext,
  characterSlug: string,
  spec: CharacterDashboardSpec
): Promise<void> {
  const { dashboardConfig, sourceTier, resolveCascade, noun, logger } = spec;
  const userId = context.user.id;

  logger.debug({ characterSlug, userId }, 'Opening dashboard');

  try {
    const { userClient } = clientsFor(context.interaction);

    const result = await userClient.getPersonality(characterSlug);

    if (!result.ok) {
      if (result.status === 404) {
        await context.editReply({
          content: `❌ Character "${characterSlug}" not found.`,
        });
        return;
      }
      logger.warn({ error: result.error, characterSlug }, 'Fetch failed');
      await context.editReply({
        content: '❌ Failed to load character data.',
      });
      return;
    }

    const personality = result.data.personality;

    const cascadeResult = await resolveCascade(userClient, personality.id);

    if (!cascadeResult.ok) {
      // Log before the generic reply so timeout-vs-5xx-vs-validation
      // failures stay distinguishable in logs (the user copy stays generic).
      logger.warn(
        { characterSlug, personalityId: personality.id, error: cascadeResult.error },
        'Cascade resolve failed'
      );
      await context.editReply({
        content: '❌ Failed to fetch config settings.',
      });
      return;
    }

    const data = convertCascadeToSettingsData(cascadeResult.data, sourceTier);

    await createSettingsDashboard(context.interaction, {
      config: dashboardConfig,
      data,
      entityId: personality.id,
      entityName: `${personality.name} (${personality.slug})`,
      userId,
    });

    logger.info({ characterSlug, userId }, 'Dashboard opened');
  } catch (error) {
    logger.error({ err: error, characterSlug }, 'Error opening dashboard');

    await context.editReply({
      content: `❌ An error occurred while opening the ${noun} dashboard.`,
    });
  }
}
