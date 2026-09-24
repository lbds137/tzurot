/**
 * The settings dashboard reset flow behind Reset page and Reset all: the
 * first click renders a Tier-A Cancel/Confirm surface naming how many
 * settings go back to Auto (design-system §3.5 — one-click bulk-destructive
 * dashboard actions confirm; the typed-phrase Tier B stays reserved for
 * irreversible purge-class acts), and Confirm clears exactly the scope's
 * locally-set settings through the dashboard's batch clear in one save.
 *
 * Dispatched by the settings router AFTER its ack and its expired/ownership
 * session guards. The scope rides in the customId extra (`settingsResetScope`)
 * and is re-resolved from it on every click — never from `session.page`, which
 * another message of the same session can move between prompt and confirm.
 */

import { type ButtonInteraction, MessageFlags, escapeMarkdown } from 'discord.js';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingsResetHandler,
  DashboardView,
  buildSettingsCustomId,
} from './types.js';
import { buildConfirmAction } from '../../confirmation/confirmAction.js';
import { buildLandingMessage } from './settingsIndexView.js';
import { handleBackButton } from './settingsNavigationHandlers.js';
import {
  type ResetScope,
  locallySetIds,
  parseResetScope,
  resetScopeExtra,
} from './settingsResetScope.js';
import { storeSession } from './SettingsSessionStorage.js';

/** Shown when a customId names an action (or a reset scope) this deploy no longer routes. */
export const STALE_DASHBOARD_NOTICE =
  'This dashboard is out of date. Please run the command again.';

/** Everything a reset-family click needs besides the interaction, config and session. */
export interface ResetActionOptions {
  /** 'reset' (first click), 'reset-confirm' or 'reset-cancel' */
  action: string;
  /** The customId extra: the scope, or undefined on a pre-scope message */
  extra: string | undefined;
  /** The dashboard's batch clear; undefined on a dashboard with none wired */
  resetHandler: SettingsResetHandler | undefined;
  /** Post-ack ephemeral notice (the router's followUp) */
  notify: (content: string) => Promise<unknown>;
}

/** Route one reset-family click. Every path answers: a render, a notice, or both. */
export async function handleResetAction(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  options: ResetActionOptions
): Promise<void> {
  const { action, extra, resetHandler, notify } = options;
  const scope = parseResetScope(config, extra);

  if (action === 'reset-cancel') {
    // Cancel never writes. A scope that no longer resolves falls back to Back.
    await (scope === null
      ? handleBackButton(interaction, config, session)
      : renderScopeHome(interaction, config, session, scope));
    return;
  }

  if (scope === null || resetHandler === undefined) {
    await notify(STALE_DASHBOARD_NOTICE);
    return;
  }

  if (action === 'reset') {
    await renderResetPrompt(interaction, config, session, scope);
    return;
  }
  await confirmReset({ interaction, config, session, scope, resetHandler });
}

/**
 * Re-render the view the scope belongs to: the page itself for Reset page,
 * the index hub for Reset all (the overview on a flat config, which has no hub).
 */
async function renderScopeHome(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  scope: ResetScope
): Promise<void> {
  if (scope.kind === 'page') {
    session.page = scope.pageIndex;
    session.view = DashboardView.OVERVIEW;
  } else {
    session.view = (config.pages?.length ?? 0) > 0 ? DashboardView.INDEX : DashboardView.OVERVIEW;
  }
  session.activeSetting = undefined;
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  // editReply: the router already deferUpdate'd before dispatching here.
  await interaction.editReply(buildLandingMessage(config, session));
}

/** "3 settings on **Memory** will go back to Auto." — the count and the scope. */
function describeReset(
  session: SettingsDashboardSession,
  scope: ResetScope,
  count: number
): string {
  const settings = count === 1 ? '1 setting' : `${count} settings`;
  const where =
    scope.kind === 'page'
      ? `on **${escapeMarkdown(scope.page.label)}**`
      : 'across **all settings**';
  const safeName = escapeMarkdown(session.entityName, { maskedLink: true });
  return (
    `${settings} ${where} will go back to Auto.\n\n` +
    `Editing **${safeName}**. The values set here cannot be recovered.`
  );
}

/**
 * First click: the Tier-A Cancel/Confirm surface in place of the dashboard.
 * Nothing is cleared until 'reset-confirm'. A scope with nothing set here (a
 * stale enabled button — another message of this session already reset it)
 * re-renders the scope's view instead, where the button now shows disabled.
 */
async function renderResetPrompt(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  scope: ResetScope
): Promise<void> {
  const count = locallySetIds(config, session, scope).length;
  if (count === 0) {
    await renderScopeHome(interaction, config, session, scope);
    return;
  }

  // Refresh the session TTL like every other view transition — otherwise a
  // near-expiry session could die between the prompt and the confirm click.
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  const scopeExtra = resetScopeExtra(scope);
  const { embed, components } = buildConfirmAction({
    title: scope.kind === 'page' ? '♻️ Reset page?' : '♻️ Reset all?',
    description: describeReset(session, scope, count),
    confirmCustomId: buildSettingsCustomId(
      config.entityType,
      'reset-confirm',
      session.entityId,
      scopeExtra
    ),
    cancelCustomId: buildSettingsCustomId(
      config.entityType,
      'reset-cancel',
      session.entityId,
      scopeExtra
    ),
    confirmLabel: scope.kind === 'page' ? 'Reset page' : 'Reset all',
    confirmEmoji: '♻️',
  });
  await interaction.editReply({ embeds: [embed], components });
}

/** Everything the confirm step needs (options object per max-params). */
interface ConfirmResetOptions {
  interaction: ButtonInteraction;
  config: SettingsDashboardConfig;
  session: SettingsDashboardSession;
  scope: ResetScope;
  resetHandler: SettingsResetHandler;
}

/**
 * Confirm: clear exactly the scope's locally-set settings in ONE batch-clear
 * call, then re-render the scope's view from the fresh data it returns. The
 * id set is recomputed from the session now, not carried from the prompt, so
 * a scope another message already cleared writes nothing. On failure, notify
 * ephemerally and leave the confirm surface untouched.
 */
async function confirmReset(options: ConfirmResetOptions): Promise<void> {
  const { interaction, config, session, scope, resetHandler } = options;
  const settingIds = locallySetIds(config, session, scope);

  if (settingIds.length > 0) {
    const result = await resetHandler(interaction, session, settingIds);
    if (!result.success) {
      // followUp: the router deferUpdate'd before dispatching here.
      await interaction.followUp({
        content: `Failed to reset: ${result.error}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (result.newData !== undefined) {
      session.data = result.newData;
    }
  }

  session.lastRejectedInput = undefined;
  await renderScopeHome(interaction, config, session, scope);
}
