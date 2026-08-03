/**
 * Settings Dashboard Handler
 *
 * Coordinates all settings dashboard interactions:
 * - Select menu: Navigate to setting drill-down
 * - Buttons: Set values (tri-state) or open modals
 * - Modals: Parse and apply values
 *
 * This is the main entry point for command handlers.
 */

import {
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ChatInputCommandInteraction,
  MessageFlags,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { showModalWithTimeoutCatch } from '../showModalWithTimeoutCatch.js';
import { ackWithTimeoutCatch } from '../ackWithTimeoutCatch.js';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingsData,
  type SettingValue,
  type SettingUpdateHandler,
  type SettingsResetHandler,
  DashboardView,
  buildSettingsCustomId,
  parseSettingsCustomId,
  clampPage,
} from './types.js';
import { buildConfirmAction } from '../../confirmation/confirmAction.js';
import {
  buildOverviewMessage,
  buildSettingMessage,
  getSettingById,
} from './SettingsDashboardBuilder.js';
import { buildSettingEditModal } from './SettingsModalFactory.js';
import { handleSetButton } from './settingsUpdate.js';
import { storeSession, getSession, deleteSession } from './SettingsSessionStorage.js';
import { ackUpdate } from '../../../ux/render/reply.js';

/** Shown when a customId names an action this deploy no longer routes. */
const STALE_DASHBOARD_NOTICE = 'This dashboard is out of date. Please run the command again.';

const logger = createLogger('SettingsDashboardHandler');

/**
 * Options for creating a settings dashboard
 */
interface CreateDashboardOptions {
  /** Dashboard configuration */
  config: SettingsDashboardConfig;
  /** Initial settings data */
  data: SettingsData;
  /** Entity ID */
  entityId: string;
  /** Entity name for display */
  entityName: string;
  /** User ID who owns this dashboard */
  userId: string;
}

/**
 * Create and display a new settings dashboard
 */
export async function createSettingsDashboard(
  interaction: ChatInputCommandInteraction,
  options: CreateDashboardOptions
): Promise<void> {
  const { config, data, entityId, entityName, userId } = options;

  // Build initial overview message
  const session: SettingsDashboardSession = {
    level: config.level,
    entityId,
    entityName,
    data,
    view: DashboardView.OVERVIEW,
    page: 0,
    userId,
    messageId: '', // Will be set after reply
    channelId: interaction.channelId,
    lastActivityAt: new Date(),
  };

  const message = buildOverviewMessage(config, session);

  // Send the dashboard
  const reply = await interaction.editReply({
    embeds: message.embeds,
    components: message.components,
  });

  // Store session with message ID
  session.messageId = reply.id;
  await storeSession(session, config.entityType);

  logger.debug({ entityType: config.entityType, entityId, userId }, 'Created dashboard');
}

/**
 * Fetch the dashboard session and run the shared expired + ownership guards.
 * Returns the session, or null after notifying the user. `notify` abstracts the
 * send shape that differs between callers (a select menu always `followUp`s
 * post-defer; the button handler routes the un-acked edit path through a
 * 10062-safe wrapped reply). Callers ack (deferUpdate) before calling — except
 * the edit path, whose `notify` owns its own ack.
 */
async function resolveValidatedSession(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  entityType: string,
  entityId: string,
  notify: (content: string) => Promise<unknown>
): Promise<SettingsDashboardSession | null> {
  const session = await getSession(interaction.user.id, entityType, entityId);
  if (session === null) {
    await notify('This dashboard has expired. Please run the command again.');
    return null;
  }
  if (session.userId !== interaction.user.id) {
    await notify('This dashboard belongs to another user.');
    return null;
  }
  return session;
}

/**
 * Handle a select menu interaction for settings navigation
 */
export async function handleSettingsSelectMenu(
  interaction: StringSelectMenuInteraction,
  config: SettingsDashboardConfig
): Promise<void> {
  const parsed = parseSettingsCustomId(interaction.customId);
  if (parsed === null) {
    logger.warn({ customId: interaction.customId }, 'Invalid customId');
    return;
  }

  // Ack first (3-second rule): deferUpdate before the Redis session read + store.
  // A select menu never opens a modal, so it can always defer; the responses
  // below become followUp (errors) / editReply (the drill-down).
  await ackUpdate(interaction);

  const session = await resolveValidatedSession(
    interaction,
    config.entityType,
    parsed.entityId,
    content => interaction.followUp({ content, flags: MessageFlags.Ephemeral })
  );
  if (session === null) {
    return;
  }

  // Get selected setting
  const settingId = interaction.values[0];
  const setting = getSettingById(config, settingId);

  if (setting === undefined) {
    await interaction.followUp({
      content: 'Unknown setting selected.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Update session to drill-down view
  session.view = DashboardView.SETTING;
  session.activeSetting = settingId;
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  // Build and update message (the builder returns exactly the editReply payload)
  await interaction.editReply(buildSettingMessage(config, session, setting));

  logger.debug(
    { entityType: config.entityType, entityId: parsed.entityId, settingId },
    'Navigated to setting'
  );
}

/**
 * Handle a button interaction for settings
 */
export async function handleSettingsButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  updateHandler: SettingUpdateHandler,
  resetHandler?: SettingsResetHandler
): Promise<void> {
  const parsed = parseSettingsCustomId(interaction.customId);
  if (parsed === null) {
    logger.warn({ customId: interaction.customId }, 'Invalid button customId');
    return;
  }

  // Ack first (3-second rule): deferUpdate before the Redis session read — EXCEPT
  // the modal-opening actions (edit, and retry which re-opens the modal with the
  // rejected input). `showModal` IS the ack and can't be preceded by a defer, so
  // those paths keep the read-then-showModal flow (mitigated by
  // showModalWithTimeoutCatch). For every other action we defer first; error
  // notices then use followUp (post-defer) vs reply (the not-yet-acked modal paths).
  const isModalAction = parsed.action === 'edit' || parsed.action === 'retry';
  if (!isModalAction) {
    await ackUpdate(interaction);
  }
  // The edit action can't defer (showModal is its ack), so its guard replies are
  // un-acked — route them through replyEditGuard so a budget-blown 10062 degrades
  // to a followUp instead of a silent failure. Every other action deferred above,
  // so followUp (post-defer) is correct and safe.
  const notify = (content: string): Promise<unknown> =>
    isModalAction
      ? replyEditGuard(interaction, parsed.entityId, content, parsed.extra ?? parsed.action)
      : interaction.followUp({ content, flags: MessageFlags.Ephemeral });

  const session = await resolveValidatedSession(
    interaction,
    config.entityType,
    parsed.entityId,
    notify
  );
  if (session === null) {
    return;
  }

  // Handle different actions
  switch (parsed.action) {
    case 'back':
      await handleBackButton(interaction, config, session);
      break;
    case 'close':
      // No settings dashboard renders a Close row anymore — ephemeral
      // dashboards rely on native dismiss plus the session TTL for teardown.
      // The action stays routable because stale messages predating the
      // removal still carry the button.
      await handleCloseButton(interaction, config, session);
      break;
    case 'page':
      await handlePageButton(interaction, config, session, parsed.extra);
      break;
    case 'set':
      await handleSetButton(interaction, config, session, parsed.extra, updateHandler);
      break;
    case 'edit':
      await handleEditButton(interaction, config, session, parsed.extra);
      break;
    case 'retry':
      await handleRetryButton(interaction, config, session, parsed.extra);
      break;
    // The reset flow is two clicks (design-system §3.5 Tier A: one-click
    // bulk-destructive dashboard actions get a Cancel/Confirm step; the
    // typed-phrase Tier B stays reserved for irreversible purge-class acts).
    // Any reset-family customId with no handler wired (stale message from a
    // dashboard that dropped the affordance) gets the stale-dashboard notice.
    case 'reset':
      if (resetHandler === undefined) {
        await notify(STALE_DASHBOARD_NOTICE);
        break;
      }
      await handleResetPrompt(interaction, config, session);
      break;
    case 'reset-confirm':
      if (resetHandler === undefined) {
        await notify(STALE_DASHBOARD_NOTICE);
        break;
      }
      await handleResetButton(interaction, config, session, resetHandler);
      break;
    case 'reset-cancel':
      // Same render as Back: return to the overview untouched.
      await handleBackButton(interaction, config, session);
      break;
    default:
      // The router already deferUpdate'd (non-edit actions defer above), so a
      // bare return leaves the interaction silently unresolved. An unrecognized
      // action is realistically a stale customId on an old dashboard message that
      // outlived a deploy renaming/removing the action — give the user feedback.
      logger.warn({ action: parsed.action }, 'Unknown button action');
      await notify(STALE_DASHBOARD_NOTICE);
  }
}

/**
 * First click of the reset flow — render the Tier-A Cancel/Confirm surface
 * in place of the dashboard. Nothing is cleared until 'reset-confirm'.
 */
async function handleResetPrompt(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): Promise<void> {
  // Refresh the session TTL like every other view transition — otherwise a
  // near-expiry session could die between the prompt and the confirm click.
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  const { embed, components } = buildConfirmAction({
    title: '♻️ Reset to defaults?',
    description:
      `Every ${config.level}-level override for **${session.entityName}** will be cleared ` +
      `and values will inherit from the cascade again. The specific override values ` +
      `cannot be recovered.`,
    confirmCustomId: buildSettingsCustomId(config.entityType, 'reset-confirm', session.entityId),
    cancelCustomId: buildSettingsCustomId(config.entityType, 'reset-cancel', session.entityId),
    confirmLabel: config.resetButton?.label ?? 'Reset to defaults',
    confirmEmoji: '♻️',
  });
  await interaction.editReply({ embeds: [embed], components });
}

/**
 * Second click ('reset-confirm'): clear the entity's overrides via the
 * injected handler, then re-render the overview from the fresh data it
 * returns. Mirrors handleSetButton's result contract — failure notifies
 * ephemerally and leaves the confirm surface untouched.
 */
async function handleResetButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  resetHandler: SettingsResetHandler
): Promise<void> {
  const result = await resetHandler(interaction, session);

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
  session.view = DashboardView.OVERVIEW;
  session.activeSetting = undefined;
  session.lastRejectedInput = undefined;
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  const message = buildOverviewMessage(config, session);
  await interaction.editReply({
    embeds: message.embeds,
    components: message.components,
  });
}

/**
 * Handle back button - return to overview
 */
async function handleBackButton(
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
async function handlePageButton(
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
 * Handle close button - remove dashboard
 */
async function handleCloseButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession
): Promise<void> {
  // Delete session
  await deleteSession(session.userId, config.entityType, session.entityId);

  // editReply: the router already deferUpdate'd before dispatching here.
  await interaction.editReply({
    content: 'Settings dashboard closed.',
    embeds: [],
    components: [],
  });
}

/**
 * Reply on the un-deferred edit path, wrapped so a budget-blown 10062 degrades
 * to a followUp instead of a silent "Interaction Failed". The edit action skips
 * deferUpdate (showModal is its ack), so getSession has already eaten into the
 * 3-second budget by the time these guard replies fire — same risk the sibling
 * showModalWithTimeoutCatch defends against on the success path.
 */
function replyEditGuard(
  interaction: ButtonInteraction,
  entityId: string,
  content: string,
  sectionId: string
): Promise<void> {
  return ackWithTimeoutCatch(
    interaction,
    () => interaction.reply({ content, flags: MessageFlags.Ephemeral }),
    {
      source: 'handleSettingsButton/edit',
      userId: interaction.user.id,
      entityId,
      sectionId,
    },
    content
  );
}

/**
 * Handle edit button - show modal for value input
 */
async function handleEditButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  settingId: string | undefined
): Promise<void> {
  if (settingId === undefined) {
    // Un-deferred edit path: a bare return leaves the interaction unacknowledged
    // → "This interaction failed". Same dead-end class as handleSetButton's
    // missing-extra guard, but reply (not followUp) since this path never acked.
    logger.warn('Edit button missing setting ID');
    await replyEditGuard(
      interaction,
      session.entityId,
      'Invalid button data. Please run the command again.',
      'edit'
    );
    return;
  }

  const setting = getSettingById(config, settingId);
  if (setting === undefined) {
    await replyEditGuard(interaction, session.entityId, 'Unknown setting.', settingId);
    return;
  }

  // Get current value for the modal (undefined for stale pre-deploy sessions —
  // the modal prefill degrades to empty)
  const currentValue = session.data[settingId] as SettingValue<unknown> | undefined;

  // Build and show modal. Wrap showModal so the 3-second budget can't
  // blow silently after the preceding getSession await — see
  // showModalWithTimeoutCatch JSDoc.
  const modal = buildSettingEditModal(
    config.entityType,
    session.entityId,
    setting,
    currentValue?.effectiveValue
  );
  await showModalWithTimeoutCatch(
    interaction,
    modal,
    {
      source: 'handleSettingsButton/edit',
      userId: interaction.user.id,
      entityId: session.entityId,
      sectionId: settingId,
    },
    '⏰ Took too long to open the editor. Please click the setting button again.'
  );
}

/**
 * Handle the Try-again button from a rejected modal submission (D15: never
 * lose typed input to a validation error). Re-opens the modal PREFILLED with
 * the rejected value from the session. Un-deferred path — showModal is the
 * ack, same flow as handleEditButton.
 */
async function handleRetryButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  settingId: string | undefined
): Promise<void> {
  if (settingId === undefined) {
    await replyEditGuard(
      interaction,
      session.entityId,
      'Invalid button data. Please run the command again.',
      'retry'
    );
    return;
  }

  const setting = getSettingById(config, settingId);
  if (setting === undefined) {
    await replyEditGuard(interaction, session.entityId, 'Unknown setting.', settingId);
    return;
  }

  // The rejected input to prefill; a mismatched/expired one degrades to the
  // current effective value (the plain edit-modal behavior).
  const rejected =
    session.lastRejectedInput?.settingId === settingId
      ? session.lastRejectedInput.value
      : undefined;
  const currentValue = session.data[settingId] as SettingValue<unknown> | undefined;

  const modal = buildSettingEditModal(
    config.entityType,
    session.entityId,
    setting,
    rejected ?? currentValue?.effectiveValue
  );
  await showModalWithTimeoutCatch(
    interaction,
    modal,
    {
      source: 'handleSettingsButton/retry',
      userId: interaction.user.id,
      entityId: session.entityId,
      sectionId: settingId,
    },
    '⏰ Took too long to open the editor. Please click Try again once more.'
  );
}
