/**
 * Memory Detail Modal Handlers
 * Modal builders and handlers for memory editing
 */

import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { type MemoryItem } from '@tzurot/common-types/schemas/api/memory';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { buildMemoryActionId, buildDetailEmbed, buildDetailButtons } from './detail.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { showModalWithTimeoutCatch } from '../../utils/dashboard/showModalWithTimeoutCatch.js';
import { ackWithTimeoutCatch } from '../../utils/dashboard/ackWithTimeoutCatch.js';
import { fetchMemory, updateMemory } from './detailApi.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { followUpSpec } from '../../ux/render/reply.js';

const logger = createLogger('memory-detail-modals');

/**
 * Maximum content length for memory editing.
 * This must match the max_length we set on the TextInput component.
 * Discord requires that pre-filled value ≤ max_length.
 *
 * We use 2000 for consistency with API validation (memorySingle.ts MAX_CONTENT_LENGTH).
 */
export const MAX_MODAL_CONTENT_LENGTH = 2000;

/** Shared copy for the memory-gone branches (initial ack + 10062 fallback) */
const MEMORY_NOT_FOUND = renderSpec(CATALOG.error.notFound('Memory'));

/**
 * Fetch for the pre-ack modal paths. Returns the memory, or the rendered
 * content to deliver through the caller's ack wrapper — a genuine 404 renders
 * absence, an infra failure renders its classified (outcome-honest) shape.
 * Collapsed to content HERE because these handlers haven't acked yet and own
 * delicate timeout-catch ack wrappers the delivery must flow through.
 */
async function fetchMemoryOrErrorContent(
  userClient: Parameters<typeof fetchMemory>[0],
  memoryId: string,
  userId: string
): Promise<{ memory: MemoryItem } | { errorContent: string }> {
  try {
    const memory = await fetchMemory(userClient, memoryId, userId);
    return memory === null ? { errorContent: MEMORY_NOT_FOUND } : { memory };
  } catch (error) {
    return {
      errorContent: renderSpec(classifyGatewayFailure(error, 'memory', { operation: 'read' })),
    };
  }
}

/** Diagnostic source for handleEditButton's ack wrappers */
const EDIT_BUTTON_SOURCE = 'handleEditButton';

/** Diagnostic source for handleEditTruncatedButton's ack wrappers */
const EDIT_TRUNCATED_SOURCE = 'handleEditTruncatedButton';

/** Action id for the truncated-edit flow — used in the button customId and diag contexts */
const EDIT_TRUNCATED_ACTION = 'edit-truncated';

/**
 * Build the edit modal for memory content
 * @param memory The memory to edit
 * @param contentOverride Optional content to use instead of memory.content (for truncated content)
 */
export function buildEditModal(memory: MemoryItem, contentOverride?: string): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildMemoryActionId('edit', memory.id, 'modal'))
    .setTitle('Edit Memory');

  const content = contentOverride ?? memory.content;

  const contentInput = new TextInputBuilder()
    .setCustomId('content')
    .setLabel('Memory Content')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(content)
    .setMaxLength(MAX_MODAL_CONTENT_LENGTH)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput));

  return modal;
}

/**
 * Build confirmation embed for truncation warning
 */
function buildTruncationWarningEmbed(memory: MemoryItem): EmbedBuilder {
  const charCount = memory.content.length;
  const truncatedPreview = memory.content.substring(0, 200) + '...';

  return new EmbedBuilder()
    .setTitle('⚠️ Memory Too Long to Edit')
    .setColor(DISCORD_COLORS.WARNING)
    .setDescription(
      `This memory contains **${charCount.toLocaleString()} characters**, which exceeds the edit limit of ${MAX_MODAL_CONTENT_LENGTH.toLocaleString()} characters.\n\n` +
        `**To edit this memory, it must be truncated to ${MAX_MODAL_CONTENT_LENGTH.toLocaleString()} characters.**\n\n` +
        `⚠️ **This is a destructive action** - the truncated content will be lost permanently when you save.\n\n` +
        `**Preview of content:**\n\`\`\`\n${truncatedPreview}\n\`\`\``
    )
    .setFooter({ text: `${charCount - MAX_MODAL_CONTENT_LENGTH} characters will be removed` });
}

/**
 * Build confirmation buttons for truncation
 */
function buildTruncationButtons(memoryId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildMemoryActionId(EDIT_TRUNCATED_ACTION, memoryId))
      .setLabel('Edit with Truncation')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('✂️'),
    new ButtonBuilder()
      .setCustomId(buildMemoryActionId('cancel-edit', memoryId))
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * Handle edit button click - show modal or truncation warning
 */
export async function handleEditButton(
  interaction: ButtonInteraction,
  memoryId: string
): Promise<void> {
  const { userClient } = clientsFor(interaction);
  const fetched = await fetchMemoryOrErrorContent(userClient, memoryId, interaction.user.id);
  if ('errorContent' in fetched) {
    // First ack lands AFTER the fetchMemory gateway call consumed part of
    // the 3-second budget — wrap so a blown window surfaces via followUp
    // instead of a silent "Interaction Failed".
    await ackWithTimeoutCatch(
      interaction,
      () =>
        interaction.reply({
          content: fetched.errorContent,
          flags: MessageFlags.Ephemeral,
        }),
      {
        source: EDIT_BUTTON_SOURCE,
        userId: interaction.user.id,
        entityId: memoryId,
        sectionId: 'edit',
      },
      fetched.errorContent
    );
    return;
  }
  const { memory } = fetched;

  // Check if content exceeds our modal's max_length setting
  // Must use MAX_MODAL_CONTENT_LENGTH (2000) because Discord requires value ≤ max_length
  if (memory.content.length > MAX_MODAL_CONTENT_LENGTH) {
    // Show truncation warning with confirmation buttons
    const embed = buildTruncationWarningEmbed(memory);
    const buttons = buildTruncationButtons(memoryId);

    await ackWithTimeoutCatch(
      interaction,
      () =>
        interaction.reply({
          embeds: [embed],
          components: [buttons],
          flags: MessageFlags.Ephemeral,
        }),
      {
        source: EDIT_BUTTON_SOURCE,
        userId: interaction.user.id,
        entityId: memoryId,
        // Distinct from the null-memory path's 'edit' so 10062 warns are
        // unambiguous in log queries.
        sectionId: 'edit-truncation-warning',
      },
      '⏰ Took too long to load the edit options. Please click the Edit button again.'
    );
    return;
  }

  // Wrap showModal so the 3-second budget can't blow silently after
  // fetchMemory's gateway call — see showModalWithTimeoutCatch JSDoc.
  const modal = buildEditModal(memory);
  await showModalWithTimeoutCatch(
    interaction,
    modal,
    {
      source: EDIT_BUTTON_SOURCE,
      userId: interaction.user.id,
      entityId: memoryId,
      sectionId: 'edit',
    },
    '⏰ Took too long to open the editor. Please click the Edit button again.'
  );
}

/**
 * Handle edit-truncated button - show modal with truncated content
 */
export async function handleEditTruncatedButton(
  interaction: ButtonInteraction,
  memoryId: string
): Promise<void> {
  const { userClient } = clientsFor(interaction);
  const fetched = await fetchMemoryOrErrorContent(userClient, memoryId, interaction.user.id);
  if ('errorContent' in fetched) {
    // Same async-before-ack exposure as handleEditButton — the update()
    // is this interaction's first ack and follows a gateway call.
    await ackWithTimeoutCatch(
      interaction,
      () =>
        interaction.update({
          content: fetched.errorContent,
          embeds: [],
          components: [],
        }),
      {
        source: EDIT_TRUNCATED_SOURCE,
        userId: interaction.user.id,
        entityId: memoryId,
        sectionId: EDIT_TRUNCATED_ACTION,
      },
      fetched.errorContent
    );
    return;
  }
  const { memory } = fetched;

  // Truncate content to our max_length setting
  const truncatedContent = memory.content.substring(0, MAX_MODAL_CONTENT_LENGTH);

  const modal = buildEditModal(memory, truncatedContent);
  await showModalWithTimeoutCatch(
    interaction,
    modal,
    {
      source: EDIT_TRUNCATED_SOURCE,
      userId: interaction.user.id,
      entityId: memoryId,
      sectionId: EDIT_TRUNCATED_ACTION,
    },
    '⏰ Took too long to open the editor. Please click **Edit with Truncation** again.'
  );
}

/**
 * Handle cancel-edit button - dismiss the truncation warning
 */
export async function handleCancelEditButton(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    content: '✅ Edit cancelled.',
    embeds: [],
    components: [],
  });
}

/**
 * Handle edit modal submission
 */
export async function handleEditModalSubmit(
  interaction: ModalSubmitInteraction,
  memoryId: string
): Promise<void> {
  const userId = interaction.user.id;
  const newContent = interaction.fields.getTextInputValue('content');

  try {
    await interaction.deferUpdate();
  } catch (deferError) {
    // Interaction may have expired or already been responded to
    logger.warn(
      { err: deferError, userId, memoryId },
      'Failed to defer modal update - interaction may have expired'
    );
    // Try to reply instead
    try {
      await interaction.reply({
        content: '⏰ This interaction has expired. Your changes were not saved.',
        flags: MessageFlags.Ephemeral,
      });
    } catch {
      // Ignore - interaction is completely dead
    }
    return;
  }

  const { userClient } = clientsFor(interaction);
  let updatedMemory: MemoryItem | null;
  try {
    updatedMemory = await updateMemory(userClient, memoryId, newContent, userId);
  } catch (error) {
    // A timeout here is outcome-UNCERTAIN (the edit may have applied) — the
    // classifier renders the honest verify-first shape, never "try again"
    // (a blind modal re-submit is the duplicate-write risk this exists for).
    await followUpSpec(interaction, classifyGatewayFailure(error, 'memory'));
    return;
  }
  if (updatedMemory === null) {
    await followUpSpec(interaction, CATALOG.error.notFound('Memory'));
    return;
  }

  const { embed, isTruncated } = buildDetailEmbed(updatedMemory);
  const buttons = buildDetailButtons(updatedMemory, isTruncated);

  try {
    await interaction.editReply({
      embeds: [embed],
      components: [buttons],
    });
  } catch (editError) {
    logger.warn({ err: editError, userId, memoryId }, 'Failed to edit reply after modal submit');
    // Try followUp as fallback
    try {
      await interaction.followUp({
        content: '✅ Memory updated successfully, but the display could not be refreshed.',
        flags: MessageFlags.Ephemeral,
      });
    } catch {
      // Ignore - best effort
    }
    return;
  }

  logger.info({ userId, memoryId }, 'Memory updated');
}
