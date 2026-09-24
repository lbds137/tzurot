/**
 * Settings dashboard index (hub) view: the navigation-only view that lists
 * every concern page of a paged dashboard and jumps to one through a single
 * select. No setting values render here.
 *
 * Also owns the landing decision — which view a freshly opened dashboard
 * shows — so the page-count threshold lives on one code path for every
 * settings command.
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  DashboardView,
  buildSettingsCustomId,
} from './types.js';
import {
  buildDescriptionPreamble,
  buildOverviewMessage,
  DISCORD_SELECT_OPTIONS_LIMIT,
} from './SettingsDashboardBuilder.js';

/**
 * A paged dashboard with at least this many pages opens on the index; one
 * with fewer opens on page 1, where the Index button keeps the index one tap
 * away. A hub in front of three pages or fewer is ceremony.
 */
export const INDEX_LANDING_MIN_PAGES = 4;

/** The view a freshly opened dashboard lands on. Flat configs have no pages, so never the index. */
export function resolveLandingView(config: SettingsDashboardConfig): DashboardView {
  const pageCount = config.pages?.length ?? 0;
  return pageCount >= INDEX_LANDING_MIN_PAGES ? DashboardView.INDEX : DashboardView.OVERVIEW;
}

/**
 * Build the index embed: the same scope-disclosure preamble the overview
 * renders above its settings (`buildDescriptionPreamble` — required so no
 * dashboard's bot-wide/channel/character scope statement is hidden on an
 * index-landing render), then one line per page in page order, then a
 * one-line hint naming the entity being edited. The hint is dropped when the
 * preamble already names the entity (the default `overviewDescription`
 * template does; a dashboard with a custom, name-free `overviewDescription`
 * and `scopeNote` — e.g. the admin dashboard — does not, so it keeps the
 * hint) to avoid saying the entity's name twice in one embed.
 */
export function buildIndexEmbed(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): EmbedBuilder {
  const pages = config.pages ?? [];
  const { safeName, text: preamble } = buildDescriptionPreamble(config, session);
  const pageLines = pages.map((page, index) => `**${index + 1}.** ${page.label}`);
  const hint = preamble.includes(safeName)
    ? 'Pick a page from the menu below.'
    : `Editing **${safeName}** — pick a page from the menu below.`;

  let description = `${preamble}\n\n${pageLines.join('\n')}\n\n${hint}`;
  if (config.descriptionNote !== undefined && config.descriptionNote.length > 0) {
    description += `\n\n${config.descriptionNote}`;
  }

  return new EmbedBuilder()
    .setTitle(`${config.titlePrefix} Settings · Index`)
    .setDescription(description)
    .setColor(config.color)
    .setTimestamp();
}

/**
 * Build the index's jump select: one option per page, labeled by the page
 * label, valued by the page's stable id (resolved back to a position at
 * click time by `handleJumpSelect`) — a position value would go stale if a
 * deploy reorders `config.pages` while the index message is still open.
 */
export function buildIndexSelectMenu(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const pages = config.pages ?? [];
  if (pages.length > DISCORD_SELECT_OPTIONS_LIMIT) {
    // Programmer error, mirroring the settings select's guard: past the cap the
    // index itself would need paging, which no dashboard needs today.
    throw new Error(
      `Settings index for "${config.entityType}" has ${pages.length} pages — ` +
        `exceeds Discord's ${DISCORD_SELECT_OPTIONS_LIMIT}-option limit`
    );
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildSettingsCustomId(config.entityType, 'jump', session.entityId))
    .setPlaceholder('Jump to a page…')
    .addOptions(
      pages.map(page => new StringSelectMenuOptionBuilder().setLabel(page.label).setValue(page.id))
    );

  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu);
}

/**
 * Build the complete index message. No Close control: the overview has none
 * either (D18 — native dismiss plus the session TTL handle teardown).
 */
export function buildIndexMessage(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] } {
  return {
    embeds: [buildIndexEmbed(config, session)],
    components: [buildIndexSelectMenu(config, session)],
  };
}

/**
 * Build the message for a view a dashboard can open on: the index for an
 * INDEX session, the overview for any other view.
 */
export function buildLandingMessage(
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] } {
  return session.view === DashboardView.INDEX
    ? buildIndexMessage(config, session)
    : buildOverviewMessage(config, session);
}
