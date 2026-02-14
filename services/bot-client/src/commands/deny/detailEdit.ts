/**
 * Deny Detail Edit Handlers
 *
 * Handles the edit modal flow for denylist entries:
 * showing the modal with pre-filled values, validating
 * scope changes, and persisting edits via the gateway API.
 */

import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { getSessionManager } from '../../utils/dashboard/SessionManager.js';
import { DASHBOARD_MESSAGES } from '../../utils/dashboard/messages.js';
import { adminPostJson, adminFetch } from '../../utils/adminApiClient.js';
import type { DenylistEntryResponse } from './browse.js';
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
    await interaction.followUp({ content: DASHBOARD_MESSAGES.SESSION_EXPIRED, flags: 64 });
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

  await interaction.showModal(modal);
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
    await interaction.reply({ content: DASHBOARD_MESSAGES.SESSION_EXPIRED, flags: 64 });
    return;
  }

  await interaction.deferUpdate();

  const data = session.data;
  const newScope = interaction.fields.getTextInputValue('scope').trim().toUpperCase();
  const newScopeId = interaction.fields.getTextInputValue('scopeId').trim();
  const newReason = interaction.fields.getTextInputValue('reason').trim() || null;

  const validationError = validateEditInput(newScope, newScopeId, newReason);
  if (validationError !== null) {
    await interaction.editReply({ content: validationError, embeds: [], components: [] });
    return;
  }

  try {
    const scopeChanged = newScope !== data.scope || newScopeId !== data.scopeId;

    const upsertResponse = await adminPostJson(
      '/admin/denylist',
      {
        type: data.type,
        discordId: data.discordId,
        scope: newScope,
        scopeId: newScopeId,
        mode: data.mode,
        reason: newReason ?? undefined,
      },
      interaction.user.id
    );

    if (!upsertResponse.ok) {
      const body = (await upsertResponse.json()) as { message?: string };
      await interaction.editReply({
        content: `\u274C Failed to update: ${body.message ?? 'Unknown error'}`,
        embeds: [],
        components: [],
      });
      return;
    }

    // If scope changed, delete the old entry
    if (scopeChanged) {
      const segments = [data.type, data.discordId, data.scope, data.scopeId].map(
        encodeURIComponent
      );
      await adminFetch(`/admin/denylist/${segments.join('/')}`, {
        method: 'DELETE',
        userId: interaction.user.id,
      });
    }

    const responseBody = (await upsertResponse.json().catch(() => ({}))) as {
      entry?: DenylistEntryResponse;
    };

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

    const updatedEntry: DenylistEntryResponse = {
      ...data,
      scope: newScope,
      scopeId: newScopeId,
      reason: newReason,
      ...(responseBody.entry !== undefined ? { id: responseBody.entry.id } : {}),
    };

    const embed = buildDetailEmbed(updatedEntry);
    const components = buildDetailButtons(updatedEntry.id, updatedEntry.mode);
    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error }, '[Deny] Failed to edit entry');
    await interaction.editReply({
      content: DASHBOARD_MESSAGES.OPERATION_FAILED('update entry'),
      embeds: [],
      components: [],
    });
  }
}
