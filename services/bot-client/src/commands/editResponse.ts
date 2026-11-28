/**
 * "Edit Response" — message context-menu command to rewrite a character reply.
 *
 * Right-click a character's reply → Apps → Edit Response opens a modal prefilled
 * with the stored reply text. On submit the Discord message(s), the
 * conversation-history row and the exchange's long-term memory all carry the
 * edited text.
 *
 * Access control is server-side: the gateway answers the editable-message lookup
 * only for the persona owner (or the bot owner), and a non-owner's lookup 404s
 * exactly like a missing message. The submit path repeats that lookup BEFORE any
 * Discord mutation, so a forged modal submit cannot edit anything.
 *
 * Deferral: opening the modal is the first ack and must carry the prefill, so
 * this command opts out of the dispatcher's deferral (`deferralMode: 'modal'`)
 * and acks through `showModalWithTimeoutCatch`. The submit defers first.
 */

import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  MessageFlags,
  type ModalBuilder,
  type ModalSubmitInteraction,
} from 'discord.js';
import { EDIT_RESPONSE_MAX_CONTENT_LENGTH } from '@tzurot/common-types/constants/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { defineContextMenuCommand } from '../utils/defineCommand.js';
import { clientsFor } from '../utils/gatewayClients.js';
import { EditResponseCustomIds } from '../utils/customIds.js';
import { buildToolkitModal } from '../utils/modal/toolkit.js';
import { showModalWithTimeoutCatch } from '../utils/dashboard/showModalWithTimeoutCatch.js';
import { NOT_A_CHARACTER_MESSAGE } from '../utils/messageCharacterLookup.js';
import { buildEditedChunks } from '../utils/editResponse/chunkPlan.js';
import { applyEditedChunks } from '../utils/editResponse/discordEdit.js';
import { extractTrailingFooter } from '../utils/editResponse/footer.js';
import { fetchLiveChunks, resolveTarget } from '../utils/editResponse/liveTarget.js';
import { memoryPreflightMessage } from '../utils/editResponse/memoryPreflight.js';
import { CATALOG } from '../ux/catalog/catalog.js';
import type { MessageSpec } from '../ux/catalog/types.js';
import { classifyGatewayFailure } from '../ux/catalog/classify.js';
import { replySpec, replySpecSafe } from '../ux/render/reply.js';

const logger = createLogger('edit-response');

const MODAL_PREFIX = 'edit-response';
const CONTENT_INPUT_ID = 'content';

const NOT_YOURS_MESSAGE = "This isn't one of your character replies.";
const TOO_LONG_MESSAGE = 'This response is too long to edit here.';
const CANT_EDIT_MESSAGE = "I can't edit this message anymore.";
const EMPTY_MESSAGE = 'The response cannot be empty.';
const NO_CHANGES_MESSAGE = 'No changes to save.';
const DONE_MESSAGE = 'Response edited.';
const PARTIAL_DONE_MESSAGE = "Response edited, but part of it couldn't be updated on Discord.";
const GENERIC_FAILURE_MESSAGE = 'Something went wrong editing the response.';
const SAVE_FAILED_MESSAGE =
  "The message was edited on Discord, but the change couldn't be saved, so the character may not remember it.";
const MEMORY_FAILED_MESSAGE =
  "The message was edited, but the character's memory couldn't be updated to match.";
const PARTIAL_MEMORY_FAILED_MESSAGE =
  "The message was edited, but part of it couldn't be updated on Discord, and the character's memory couldn't be updated to match.";

/** Failure arm of a gateway result, rendered as the honest user-facing spec. */
function readFailureSpec(result: { status?: number }): MessageSpec {
  if (result.status === 404) {
    return CATALOG.error.validation(NOT_YOURS_MESSAGE);
  }
  return classifyGatewayFailure(result, 'response', { operation: 'read' });
}

function buildEditModal(channelId: string, messageId: string, content: string): ModalBuilder {
  return buildToolkitModal({
    customId: EditResponseCustomIds.submit(channelId, messageId),
    title: 'Edit Response',
    items: [
      {
        kind: 'text',
        id: CONTENT_INPUT_ID,
        label: 'Response',
        style: 'paragraph',
        required: true,
        maxLength: EDIT_RESPONSE_MAX_CONTENT_LENGTH,
        initialValue: content,
      },
    ],
  });
}

async function handleSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const parsed = EditResponseCustomIds.parse(interaction.customId);
  if (parsed?.action !== 'submit') {
    await replySpecSafe(interaction, CATALOG.error.validation(GENERIC_FAILURE_MESSAGE));
    return;
  }
  const { channelId, messageId } = parsed;

  const newText = interaction.fields.getTextInputValue(CONTENT_INPUT_ID);
  if (newText.trim().length === 0) {
    await replySpec(interaction, CATALOG.error.validation(EMPTY_MESSAGE));
    return;
  }

  const { userClient } = clientsFor(interaction);

  // Authoritative auth AND the memory check, in one gateway call before any
  // Discord mutation: the gateway plans against the real stored texts and the
  // new reply.
  const lookup = await userClient.checkEditAssistantMessage(messageId, { content: newText });
  if (!lookup.ok) {
    await replySpec(interaction, readFailureSpec(lookup));
    return;
  }
  const { discordMessageIds, personalityId, memorySync } = lookup.data;

  // Exact compare: text is stored as typed, so a whitespace-only change is an edit.
  // An unchanged submit is not an edit and must not rewrite the Discord message,
  // which would drop attachments such as the TTS audio.
  if (newText === lookup.data.content) {
    await replySpec(interaction, CATALOG.error.validation(NO_CHANGES_MESSAGE));
    return;
  }

  // Memory must be able to follow the edit; refuse before Discord is touched.
  const refusal = memoryPreflightMessage(memorySync);
  if (refusal !== null) {
    await replySpec(interaction, CATALOG.error.validation(refusal));
    return;
  }

  const live = await fetchLiveChunks(interaction.client, channelId, discordMessageIds);
  if (live === null) {
    await replySpec(interaction, CATALOG.error.validation(CANT_EDIT_MESSAGE));
    return;
  }

  const resolved = await resolveTarget(live.channel, live.chunks, personalityId, channelId);
  if (resolved === null) {
    await replySpec(interaction, CATALOG.error.validation(CANT_EDIT_MESSAGE));
    return;
  }

  const footer = extractTrailingFooter(live.chunks[live.chunks.length - 1].content);
  const newChunks = buildEditedChunks(newText, resolved.dmPrefix, footer);

  const applied = await applyEditedChunks(resolved.target, live.chunks, newChunks);
  if (!applied.ok) {
    const message = applied.reason === 'uneditable' ? CANT_EDIT_MESSAGE : GENERIC_FAILURE_MESSAGE;
    await replySpec(interaction, CATALOG.error.validation(message));
    return;
  }

  // The first stored chunk is never deleted, so it stays a valid route key.
  const saved = await userClient.editAssistantMessage(discordMessageIds[0], {
    content: newText,
    discordMessageIds: applied.messageIds,
  });
  if (!saved.ok) {
    logger.warn(
      { messageId, status: saved.status },
      'Discord edited but the history update failed'
    );
    await replySpec(interaction, CATALOG.error.validation(SAVE_FAILED_MESSAGE));
    return;
  }

  logger.info(
    {
      messageId,
      chunks: applied.messageIds.length,
      partial: applied.partial,
      memory: saved.data.memory.kind,
    },
    'Response edited'
  );
  // `blocked` here is the race: the memory changed after the preflight.
  const memoryOutOfSync =
    saved.data.memory.kind === 'failed' || saved.data.memory.kind === 'blocked';
  if (memoryOutOfSync) {
    await replySpec(
      interaction,
      CATALOG.info.warning(applied.partial ? PARTIAL_MEMORY_FAILED_MESSAGE : MEMORY_FAILED_MESSAGE)
    );
    return;
  }
  await replySpec(
    interaction,
    CATALOG.success.done(applied.partial ? PARTIAL_DONE_MESSAGE : DONE_MESSAGE)
  );
}

export default defineContextMenuCommand({
  data: new ContextMenuCommandBuilder()
    .setName('Edit Response')
    .setType(ApplicationCommandType.Message),
  deferralMode: 'modal',
  modalPrefix: MODAL_PREFIX,

  execute: async interaction => {
    const target = interaction.targetMessage;
    const botId = interaction.client.user.id;
    if (target.webhookId === null && target.author.id !== botId) {
      await replySpec(interaction, CATALOG.error.validation(NOT_A_CHARACTER_MESSAGE));
      return;
    }

    const { userClient } = clientsFor(interaction);
    try {
      const lookup = await userClient.getEditableMessage(target.id);
      if (!lookup.ok) {
        await replySpec(interaction, readFailureSpec(lookup));
        return;
      }
      const refusal = memoryPreflightMessage(lookup.data.memorySync);
      if (refusal !== null) {
        await replySpec(interaction, CATALOG.error.validation(refusal));
        return;
      }
      if (lookup.data.content.length > EDIT_RESPONSE_MAX_CONTENT_LENGTH) {
        await replySpec(interaction, CATALOG.error.validation(TOO_LONG_MESSAGE));
        return;
      }

      await showModalWithTimeoutCatch(
        interaction,
        buildEditModal(interaction.channelId, target.id, lookup.data.content),
        {
          source: 'editResponse',
          userId: interaction.user.id,
          entityId: target.id,
          sectionId: CONTENT_INPUT_ID,
        },
        '⏰ Took too long to open the editor. Please try again.'
      );
    } catch (error) {
      logger.error({ err: error, targetId: target.id }, 'Failed to open the edit modal');
      await replySpecSafe(
        interaction,
        classifyGatewayFailure(error, 'response', { operation: 'read' })
      );
    }
  },

  handleModal: async interaction => {
    try {
      await handleSubmit(interaction);
    } catch (error) {
      logger.error({ err: error, customId: interaction.customId }, 'Edit response submit failed');
      await replySpecSafe(
        interaction,
        classifyGatewayFailure(error, 'response', { operation: 'write' })
      );
    }
  },
});
