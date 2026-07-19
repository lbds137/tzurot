/**
 * Memory Facts Detail View (memory Phase 2 correction slice)
 *
 * Detail embed + the correction verbs for a single extracted fact:
 * Correct (modal → PATCH), Forget (confirm → DELETE, terminal), Lock toggle.
 *
 * Lock is a hard freeze with the SAME semantics as episode-memory locks:
 * a locked fact rejects correct/forget (the buttons render disabled) and is
 * never auto-superseded by extraction. Corrections don't need the lock —
 * their `corrected` tier already shields them from extraction.
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  escapeMarkdown,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { formatDateTimeCompact } from '@tzurot/common-types/utils/dateFormatting';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { CUSTOM_ID_DELIMITER } from '../../utils/customIds.js';
import { buildEntityDetailCard } from '../../utils/detailCard.js';
import { buildToolkitModal } from '../../utils/modal/toolkit.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { showModalWithTimeoutCatch } from '../../utils/dashboard/showModalWithTimeoutCatch.js';
import { ackWithTimeoutCatch } from '../../utils/dashboard/ackWithTimeoutCatch.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { followUpSpec } from '../../ux/render/reply.js';
import { fetchFact, correctFact, forgetFact, setFactLock, type FactItem } from './factsApi.js';

const logger = createLogger('memory-facts-detail');

/** Custom ID prefix for fact detail actions */
export const FACT_DETAIL_PREFIX = 'memory-fact';

/**
 * Statement cap for the correct modal — matches the API's
 * CorrectFactRequestSchema max (Discord requires prefill ≤ max_length).
 */
export const MAX_FACT_STATEMENT_LENGTH = 1000;

/** Human labels for the fact tier (how the fact came to exist). */
const TIER_LABELS: Record<string, string> = {
  observed: '🔍 Learned from conversation',
  inferred: '🔮 Inferred',
  corrected: '✏️ Corrected by you',
};

type FactAction = 'select' | 'correct' | 'lock' | 'back' | 'forget' | 'confirm-forget';

/** Build a fact-action custom ID: memory-fact::{action}[::factId[::extra]] */
export function buildFactActionId(action: FactAction, factId?: string, extra?: string): string {
  const parts: string[] = [FACT_DETAIL_PREFIX, action];
  if (factId !== undefined) {
    parts.push(factId);
  }
  if (extra !== undefined) {
    parts.push(extra);
  }
  return parts.join(CUSTOM_ID_DELIMITER);
}

/** Parse a fact-action custom ID (null if it isn't one). */
export function parseFactActionId(
  customId: string
): { action: string; factId?: string; extra?: string } | null {
  if (!customId.startsWith(`${FACT_DETAIL_PREFIX}${CUSTOM_ID_DELIMITER}`)) {
    return null;
  }
  const parts = customId.split(CUSTOM_ID_DELIMITER);
  return { action: parts[1], factId: parts[2], extra: parts[3] };
}

/** Build the detail embed for a single fact. */
export function buildFactDetailEmbed(fact: FactItem): EmbedBuilder {
  return buildEntityDetailCard({
    title: `${fact.isLocked ? '🔒 ' : ''}Fact Details`,
    color: fact.isLocked ? DISCORD_COLORS.WARNING : DISCORD_COLORS.BLURPLE,
    description: escapeMarkdown(fact.statement),
    fields: [
      { name: 'Origin', value: TIER_LABELS[fact.tier] ?? fact.tier, inline: true },
      { name: 'Status', value: fact.isLocked ? '🔒 Locked' : '🔓 Unlocked', inline: true },
      { name: 'Learned', value: formatDateTimeCompact(fact.validFrom), inline: true },
      fact.sourceMemoryIds.length > 0 && {
        name: 'Sources',
        value: `${fact.sourceMemoryIds.length} conversation ${fact.sourceMemoryIds.length === 1 ? 'memory' : 'memories'}`,
        inline: true,
      },
    ],
    footer: `Fact ID: ${fact.id.substring(0, 8)}...`,
  }).embed;
}

/**
 * Build the action buttons. Correct and Forget render DISABLED on a locked
 * fact — the lock is a hard freeze (same contract as episode locks), so the
 * UI communicates "unlock first" visually instead of letting the click 403.
 */
export function buildFactDetailButtons(fact: FactItem): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildFactActionId('correct', fact.id))
      .setLabel('Correct')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(fact.isLocked),
    new ButtonBuilder()
      // Encode desired final state so a retried request can't flip the wrong way.
      .setCustomId(buildFactActionId('lock', fact.id, fact.isLocked ? '0' : '1'))
      .setLabel(fact.isLocked ? 'Unlock' : 'Lock')
      .setEmoji(fact.isLocked ? '🔓' : '🔒')
      .setStyle(fact.isLocked ? ButtonStyle.Secondary : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildFactActionId('back'))
      .setLabel('Back to List')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildFactActionId('forget', fact.id))
      .setLabel('Forget')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(fact.isLocked)
  );
}

/** Render the detail view onto the (already-acked) interaction's message. */
async function showDetailView(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  fact: FactItem
): Promise<void> {
  await interaction.editReply({
    embeds: [buildFactDetailEmbed(fact)],
    components: [buildFactDetailButtons(fact)],
  });
}

/** Select-menu handler — user picked a fact from the browse list. */
export async function handleFactSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const factId = interaction.values[0];
  await interaction.deferUpdate();

  const { userClient } = clientsFor(interaction);
  let fact: FactItem | null;
  try {
    fact = await fetchFact(userClient, factId, interaction.user.id);
  } catch (error) {
    await followUpSpec(interaction, classifyGatewayFailure(error, 'fact', { operation: 'read' }));
    return;
  }
  if (fact === null) {
    await followUpSpec(interaction, CATALOG.error.notFound('Fact'));
    return;
  }
  await showDetailView(interaction, fact);
}

/**
 * Correct button — fetch the fact (prefill) then show the modal. The fetch
 * happens BEFORE the ack (showModal must be the first response), so both the
 * error ack and the modal route through timeout-catch wrappers per the
 * 3-second-budget rule.
 */
export async function handleCorrectButton(
  interaction: ButtonInteraction,
  factId: string
): Promise<void> {
  const { userClient } = clientsFor(interaction);
  let fact: FactItem | null;
  let errorContent: string | null = null;
  try {
    fact = await fetchFact(userClient, factId, interaction.user.id);
    if (fact === null) {
      errorContent = renderSpec(CATALOG.error.notFound('Fact'));
    }
  } catch (error) {
    fact = null;
    errorContent = renderSpec(classifyGatewayFailure(error, 'fact', { operation: 'read' }));
  }

  if (fact === null) {
    const content = errorContent ?? renderSpec(CATALOG.error.notFound('Fact'));
    await ackWithTimeoutCatch(
      interaction,
      () => interaction.reply({ content, flags: MessageFlags.Ephemeral }),
      {
        source: 'handleCorrectButton',
        userId: interaction.user.id,
        entityId: factId,
        sectionId: 'correct',
      },
      content
    );
    return;
  }

  const modal = buildToolkitModal({
    customId: buildFactActionId('correct', fact.id),
    title: 'Correct Fact',
    items: [
      {
        kind: 'text',
        id: 'statement',
        label: 'What should this fact say?',
        style: 'paragraph',
        maxLength: MAX_FACT_STATEMENT_LENGTH,
        required: true,
        initialValue: fact.statement,
      },
    ],
  });

  await showModalWithTimeoutCatch(
    interaction,
    modal,
    {
      source: 'handleCorrectButton',
      userId: interaction.user.id,
      entityId: factId,
      sectionId: 'correct',
    },
    '⏰ Took too long to open the editor. Please click Correct again.'
  );
}

/** Correct modal submit — supersede via the gateway, show the surviving fact. */
export async function handleCorrectModalSubmit(
  interaction: ModalSubmitInteraction,
  factId: string
): Promise<void> {
  const userId = interaction.user.id;
  const statement = interaction.fields.getTextInputValue('statement');

  await interaction.deferUpdate();

  const { userClient } = clientsFor(interaction);
  let survivor: FactItem | null;
  try {
    survivor = await correctFact(userClient, factId, statement, userId);
  } catch (error) {
    // Includes the identical-statement 400 and (stale-view) locked 403 —
    // classified rather than swallowed; a timeout is outcome-uncertain.
    await followUpSpec(interaction, classifyGatewayFailure(error, 'fact'));
    return;
  }
  if (survivor === null) {
    await followUpSpec(interaction, CATALOG.error.notFound('Fact'));
    return;
  }

  await showDetailView(interaction, survivor);
  logger.info({ userId, factId, survivorId: survivor.id }, 'Fact corrected');
}

/** Lock toggle — target state encoded in the customId. */
export async function handleFactLockButton(
  interaction: ButtonInteraction,
  factId: string,
  desiredState: boolean
): Promise<void> {
  await interaction.deferUpdate();

  const { userClient } = clientsFor(interaction);
  let updated: FactItem | null;
  try {
    updated = await setFactLock(userClient, factId, desiredState, interaction.user.id);
  } catch (error) {
    await followUpSpec(interaction, classifyGatewayFailure(error, 'fact lock'));
    return;
  }
  if (updated === null) {
    await followUpSpec(interaction, CATALOG.error.notFound('Fact'));
    return;
  }

  await showDetailView(interaction, updated);
  logger.info(
    { userId: interaction.user.id, factId, action: updated.isLocked ? 'locked' : 'unlocked' },
    'Fact lock set'
  );
}

/** Forget button — show the confirmation view. */
export async function handleForgetButton(
  interaction: ButtonInteraction,
  factId: string
): Promise<void> {
  await interaction.deferUpdate();

  const { userClient } = clientsFor(interaction);
  let fact: FactItem | null;
  try {
    fact = await fetchFact(userClient, factId, interaction.user.id);
  } catch (error) {
    await followUpSpec(interaction, classifyGatewayFailure(error, 'fact', { operation: 'read' }));
    return;
  }
  if (fact === null) {
    await followUpSpec(interaction, CATALOG.error.notFound('Fact'));
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('⚠️ Forget This Fact?')
    .setColor(DISCORD_COLORS.ERROR)
    .setDescription(
      `> ${escapeMarkdown(fact.statement)}\n\n` +
        `The character will permanently forget this, and it will **never be re-learned** ` +
        `from past conversations.\n\n**This cannot be undone.**`
    );

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildFactActionId('back'))
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildFactActionId('confirm-forget', factId))
      .setLabel('Yes, Forget')
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.editReply({ embeds: [embed], components: [buttons] });
}

/**
 * Forget confirmation — terminal removal, then the caller refreshes the list.
 * Guards the defer so it stays safe both standalone and pre-deferred.
 * @returns true when the fact was forgotten (caller should refresh the list)
 */
export async function handleForgetConfirm(
  interaction: ButtonInteraction,
  factId: string
): Promise<boolean> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }

  const { userClient } = clientsFor(interaction);
  let success: boolean;
  try {
    success = await forgetFact(userClient, factId, interaction.user.id);
  } catch (error) {
    await followUpSpec(
      interaction,
      classifyGatewayFailure(error, 'fact', { failedAction: 'forget the fact' })
    );
    return false;
  }
  if (!success) {
    await followUpSpec(interaction, CATALOG.error.notFound('Fact'));
    return false;
  }

  logger.info({ userId: interaction.user.id, factId }, 'Fact forgotten');
  return true;
}
