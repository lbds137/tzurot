/**
 * Settings dashboard navigation: Back (a setting → its page), the page
 * buttons (prev/next), Close, the Index button (any page → the index) and the
 * index's jump select (index → a page).
 *
 * All are dispatched by the settings router in SettingsDashboardHandler
 * AFTER its ack and its expired/ownership session guards, so a stale or
 * expired session gets exactly the notices every other settings action gets.
 * These handlers only move the session between views and re-render.
 */

import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  DashboardView,
  clampPage,
} from './types.js';
import { buildOverviewMessage } from './SettingsDashboardBuilder.js';
import { buildIndexMessage } from './settingsIndexView.js';
import { storeSession, deleteSession } from './SettingsSessionStorage.js';

const logger = createLogger('settingsNavigationHandlers');

/**
 * Back button (and reset-cancel on a confirm surface that carries no scope):
 * return to the overview of the session's current page.
 */
export async function handleBackButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): Promise<void> {
  session.view = DashboardView.OVERVIEW;
  session.activeSetting = undefined;
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  const message = buildOverviewMessage(config, session);

  // editReply: the router already deferUpdate'd before dispatching here.
  await interaction.editReply({
    embeds: message.embeds,
    components: message.components,
  });
}

/**
 * Handle page navigation (paged configs) — mutate the session page and
 * re-render the overview. Clamped on BOTH the stored value and the result, so
 * a stale button (session already at an edge, or a shrunk page list after a
 * deploy) can never render an out-of-range page. The `noop` indicator button
 * is disabled and never reaches here; treat it as a re-render if it somehow does.
 */
export async function handlePageButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  direction: string | undefined
): Promise<void> {
  const current = clampPage(config, session.page);
  const delta = direction === 'next' ? 1 : direction === 'prev' ? -1 : 0;
  session.page = clampPage(config, current + delta);
  session.view = DashboardView.OVERVIEW;
  session.activeSetting = undefined;
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  const message = buildOverviewMessage(config, session);

  // editReply: the router already deferUpdate'd (page is a non-modal action).
  await interaction.editReply({
    embeds: message.embeds,
    components: message.components,
  });
}

/**
 * Close button — remove the dashboard. No settings dashboard renders a Close
 * row anymore; the action stays routable for messages that predate its removal.
 */
export async function handleCloseButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): Promise<void> {
  await deleteSession(session.userId, config.entityType, session.entityId);

  // editReply: the router already deferUpdate'd before dispatching here.
  await interaction.editReply({
    content: 'Settings dashboard closed.',
    embeds: [],
    components: [],
  });
}

/**
 * Index button → the index view. A flat config has no index (and its overview
 * renders no Index button), so a stale Index click on a dashboard whose pages
 * were removed by a deploy re-renders the overview instead of an empty index.
 */
export async function handleIndexButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): Promise<void> {
  const hasPages = (config.pages?.length ?? 0) > 0;
  session.view = hasPages ? DashboardView.INDEX : DashboardView.OVERVIEW;
  session.activeSetting = undefined;
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  // editReply: the router already deferUpdate'd (index is a non-modal action).
  await interaction.editReply(
    hasPages ? buildIndexMessage(config, session) : buildOverviewMessage(config, session)
  );

  logger.debug({ entityType: config.entityType, entityId: session.entityId }, 'Navigated to index');
}

/**
 * Jump select → the chosen page's overview. The selected value is the
 * page's stable id, resolved to its CURRENT position in `config.pages` at
 * click time — so a deploy that reorders pages while the index message is
 * still open still lands the click on the page the user read, not on
 * whatever now sits at that position. The resolved position is clamped like
 * the prev/next path, so a stale menu from a since-shrunk page list cannot
 * render an out-of-range page; an id with no matching page (a removed page,
 * or a forged interaction) keeps the session's current page.
 */
export async function handleJumpSelect(
  interaction: StringSelectMenuInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): Promise<void> {
  const selected = interaction.values[0];
  const resolvedIndex = (config.pages ?? []).findIndex(page => page.id === selected);
  const target = resolvedIndex === -1 ? session.page : resolvedIndex;
  session.page = clampPage(config, target);
  session.view = DashboardView.OVERVIEW;
  session.activeSetting = undefined;
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  // editReply: the router already deferUpdate'd (select menus always defer).
  await interaction.editReply(buildOverviewMessage(config, session));

  logger.debug(
    { entityType: config.entityType, entityId: session.entityId, pageId: selected },
    'Navigated to page'
  );
}
