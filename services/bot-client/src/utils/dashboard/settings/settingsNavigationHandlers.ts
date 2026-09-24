/**
 * Settings dashboard index navigation: the Index button (any page → the
 * index) and the index's jump select (index → a page).
 *
 * Both are dispatched by the settings router in SettingsDashboardHandler
 * AFTER its ack and its expired/ownership session guards, so a stale or
 * expired session gets exactly the notices every other settings action gets.
 * These handlers only move the session between views and re-render.
 */

import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  DashboardView,
  clampPage,
} from './types.js';
import { buildOverviewMessage } from './SettingsDashboardBuilder.js';
import { buildIndexMessage } from './settingsIndexView.js';
import { storeSession } from './SettingsSessionStorage.js';

/** A page option's value: the page's position in `config.pages`. */
const PAGE_INDEX_VALUE = /^\d+$/;

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
}

/**
 * Jump select → the chosen page's overview. The selected value is clamped
 * like the prev/next path, so a stale menu from a since-shrunk page list
 * cannot render an out-of-range page; a value that is not a page index (a
 * forged interaction) keeps the session's current page.
 */
export async function handleJumpSelect(
  interaction: StringSelectMenuInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): Promise<void> {
  const selected = interaction.values[0];
  const target = PAGE_INDEX_VALUE.test(selected) ? Number(selected) : session.page;
  session.page = clampPage(config, target);
  session.view = DashboardView.OVERVIEW;
  session.activeSetting = undefined;
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  // editReply: the router already deferUpdate'd (select menus always defer).
  await interaction.editReply(buildOverviewMessage(config, session));
}
