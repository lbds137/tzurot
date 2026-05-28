/**
 * Deny Detail Edit Handlers
 *
 * Handles the edit modal flow for denylist entries:
 * showing the modal with pre-filled values, validating
 * scope changes, and persisting edits via the gateway API.
 */

import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} from 'discord.js';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { getSessionManager } from '../../utils/dashboard/SessionManager.js';
import { showModalWithTimeoutCatch } from '../../utils/dashboard/showModalWithTimeoutCatch.js';
import { DASHBOARD_MESSAGES } from '../../utils/dashboard/messages.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import type { DenylistEntryResponse } from './browseTypes.js';
import type { DenylistScope } from '@tzurot/common-types';
import type { DenyDetailSession } from './detailTypes.js';
import { ENTITY_TYPE, VALID_SCOPES, buildDetailEmbed, buildDetailButtons } from './detailTypes.js';

const logger = createLogger('deny-detail-edit');

/** Handle edit button — show modal */
export async function handleEdit(interaction: ButtonInteraction, entryId: string): Promise<void> {
  const sessionManager = getSessionManager();
  const session = await sessionManager.get<DenyDetailSession>(
    interaction.user.id,
    ENTITY_TYPE,
    entryId
  );

  if (session === null) {
    // First response to an unacknowledged button click must be reply/deferUpdate.
    // followUp here would land via the webhook endpoint after Discord shows
    // "Application did not respond" — a confusing double-message UX.
    await interaction.reply({
      content: DASHBOARD_MESSAGES.SESSION_EXPIRED,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const data = session.data;
  const modal = new ModalBuilder()
    .setCustomId(`deny::modal::${entryId}::edit`)
    .setTitle('Edit Denylist Entry');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('scope')
        .setLabel('Scope')
        .setPlaceholder('BOT, GUILD, CHANNEL, or PERSONALITY')
        .setValue(data.scope)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('scopeId')
        .setLabel('Scope ID')
        .setPlaceholder('* for BOT, channel/personality ID for others')
        .setValue(data.scopeId)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason')
        .setPlaceholder('Reason for the denial (optional)')
        .setValue(data.reason ?? '')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
    )
  );

  // Wrap showModal so the 3-second budget can't blow silently after the
  // preceding sessionManager.get() Redis lookup — see showModalWithTimeoutCatch JSDoc.
  await showModalWithTimeoutCatch(
    interaction,
    modal,
    {
      source: 'handleEdit',
      userId: interaction.user.id,
      entityId: entryId,
      sectionId: 'edit',
    },
    '⏰ Took too long to open the editor. Please click the Edit button again.'
  );
}

const MAX_REASON_LENGTH = 500;

/** Validate edit modal inputs. Returns error message if invalid, null if OK. */
function validateEditInput(scope: string, scopeId: string, reason: string | null): string | null {
  if (!VALID_SCOPES.includes(scope as (typeof VALID_SCOPES)[number])) {
    return `\u274C Invalid scope "${scope}". Must be BOT, GUILD, CHANNEL, or PERSONALITY.`;
  }
  if (scope === 'BOT' && scopeId !== '*') {
    return '\u274C BOT scope requires scope ID to be `*`.';
  }
  if (reason !== null && reason.length > MAX_REASON_LENGTH) {
    return `\u274C Reason too long (${reason.length}/${MAX_REASON_LENGTH} characters).`;
  }
  return null;
}

/** Handle edit modal submission */
export async function handleEditModal(
  interaction: ModalSubmitInteraction,
  entryId: string
): Promise<void> {
  const sessionManager = getSessionManager();
  const session = await sessionManager.get<DenyDetailSession>(
    interaction.user.id,
    ENTITY_TYPE,
    entryId
  );

  if (session === null) {
    await interaction.reply({
      content: DASHBOARD_MESSAGES.SESSION_EXPIRED,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();

  const data = session.data;
  const newScopeRaw = interaction.fields.getTextInputValue('scope').trim().toUpperCase();
  const newScopeId = interaction.fields.getTextInputValue('scopeId').trim();
  const newReason = interaction.fields.getTextInputValue('reason').trim() || null;

  const validationError = validateEditInput(newScopeRaw, newScopeId, newReason);
  if (validationError !== null) {
    // intentionally-raw: deny uses manual re-render for back-to-browse (see
    // detail.ts file-top comment). Validation error is terminal; session
    // remains so user can re-edit.
    await interaction.editReply({ content: validationError, embeds: [], components: [] });
    return;
  }

  // Validation above narrowed `newScopeRaw` to a member of VALID_SCOPES,
  // which is the same set as the schema's DenylistScope literal union.
  const newScope = newScopeRaw as DenylistScope;

  try {
    const scopeChanged = newScope !== data.scope || newScopeId !== data.scopeId;
    const { ownerClient } = clientsFor(interaction);

    const upsertResult = await ownerClient.addDenylistEntry({
      type: data.type,
      discordId: data.discordId,
      scope: newScope,
      scopeId: newScopeId,
      mode: data.mode,
      reason: newReason ?? undefined,
    });

    if (!upsertResult.ok) {
      await interaction.editReply({
        content: `\u274C Failed to update: ${upsertResult.error}`,
        embeds: [],
        // intentionally-raw: deny uses manual re-render for back-to-browse
        // (see detail.ts file-top comment). Edit-API-failure terminal path.
        components: [],
      });
      return;
    }

    // If scope changed, delete the old entry (the upsert created a new one
    // at the new scope; this removes the stale entry at the prior scope).
    if (scopeChanged) {
      await ownerClient.removeDenylistEntry(data.type, data.discordId, data.scope, data.scopeId);
    }

    const responseBody = upsertResult.data as { entry?: DenylistEntryResponse };

    const updatedData: Partial<DenyDetailSession> = {
      scope: newScope,
      scopeId: newScopeId,
      reason: newReason,
    };
    if (responseBody.entry !== undefined) {
      updatedData.id = responseBody.entry.id;
    }

    await sessionManager.update<DenyDetailSession>(
      interaction.user.id,
      ENTITY_TYPE,
      entryId,
      updatedData
    );

    // `data.addedAt` is a string (session storage); `buildDetailEmbed`
    // accepts string | Date, so leave the type inferred rather than forcing
    // it through DenylistEntryResponse (which has addedAt: Date).
    const updatedEntry = {
      ...data,
      scope: newScope,
      scopeId: newScopeId,
      reason: newReason,
      ...(responseBody.entry !== undefined ? { id: responseBody.entry.id } : {}),
    };

    const embed = buildDetailEmbed(updatedEntry);
    const components = buildDetailButtons(
      updatedEntry.id,
      updatedEntry.mode,
      data.browseContext !== null
    );
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error }, 'Failed to edit entry');
    // Edit-exception terminal path; deny doesn't use the Back-to-Browse
    // button pattern (see detail.ts file-top comment).
    await interaction.editReply({
      content: DASHBOARD_MESSAGES.OPERATION_FAILED('update entry'),
      embeds: [],
      // intentionally-raw: see block comment above.
      components: [],
    });
  }
}
