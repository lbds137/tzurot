/**
 * Deny Detail Edit Handlers
 *
 * Handles the edit modal flow for denylist entries:
 * showing the modal with pre-filled values, validating
 * scope changes, and persisting edits via the gateway API.
 */

import { MessageFlags, type ButtonInteraction, type ModalSubmitInteraction } from 'discord.js';
import { type DenylistScope } from '@tzurot/common-types/schemas/api/denylist';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { buildToolkitModal } from '../../utils/modal/toolkit.js';
import { getSessionManager } from '../../utils/dashboard/SessionManager.js';
import { showModalWithTimeoutCatch } from '../../utils/dashboard/showModalWithTimeoutCatch.js';
import { ackWithTimeoutCatch } from '../../utils/dashboard/ackWithTimeoutCatch.js';
import { DASHBOARD_MESSAGES } from '../../utils/dashboard/messages.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import type { DenylistEntryResponse } from './browseTypes.js';
import type { OwnerClient } from '@tzurot/clients';
import {
  type DenyDetailSession,
  ENTITY_TYPE,
  VALID_SCOPES,
  buildDetailEmbed,
  buildDetailButtons,
} from './detailTypes.js';
import { ackUpdate } from '../../ux/render/reply.js';

const logger = createLogger('deny-detail-edit');

/** Longest valid scope is 'PERSONALITY' (11); anything longer is invalid anyway. */
const MAX_SCOPE_LENGTH = 20;

/** Snowflake (~20 chars) or personality UUID (36); '*' for BOT scope. */
const MAX_SCOPE_ID_LENGTH = 100;

/** Mirrors the post-submit validateEditInput cap so Discord enforces it natively. */
const MAX_REASON_LENGTH = 500;

/**
 * Session-expired first ack shared by handleEdit (button) and handleEditModal
 * (modal submit). The reply lands after the sessionManager.get() Redis
 * round-trip consumed part of the 3-second budget, so it's wrapped: a blown
 * window surfaces via the wrapper's followUp fallback instead of a silent
 * "Interaction Failed". (followUp as the PRIMARY response would be wrong —
 * it lands after Discord's "did not respond" banner; it's only the fallback.)
 */
async function replySessionExpired(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  source: string,
  entryId: string
): Promise<void> {
  await ackWithTimeoutCatch(
    interaction,
    () =>
      interaction.reply({
        content: DASHBOARD_MESSAGES.SESSION_EXPIRED,
        flags: MessageFlags.Ephemeral,
      }),
    { source, userId: interaction.user.id, entityId: entryId, sectionId: 'edit' },
    DASHBOARD_MESSAGES.SESSION_EXPIRED
  );
}

/** Handle edit button — show modal */
export async function handleEdit(interaction: ButtonInteraction, entryId: string): Promise<void> {
  const sessionManager = getSessionManager();
  const session = await sessionManager.get<DenyDetailSession>(
    interaction.user.id,
    ENTITY_TYPE,
    entryId
  );

  if (session === null) {
    await replySessionExpired(interaction, 'handleEdit', entryId);
    return;
  }

  const data = session.data;
  const modal = buildToolkitModal({
    customId: `deny::modal::${entryId}::edit`,
    title: 'Edit Denylist Entry',
    items: [
      {
        kind: 'text',
        id: 'scope',
        label: 'Scope',
        style: 'short',
        placeholder: 'BOT, GUILD, CHANNEL, or PERSONALITY',
        maxLength: MAX_SCOPE_LENGTH,
        required: true,
        initialValue: data.scope,
      },
      {
        kind: 'text',
        id: 'scopeId',
        label: 'Scope ID',
        style: 'short',
        placeholder: '* for BOT, channel/personality ID for others',
        maxLength: MAX_SCOPE_ID_LENGTH,
        required: true,
        initialValue: data.scopeId,
      },
      {
        kind: 'text',
        id: 'reason',
        label: 'Reason',
        style: 'paragraph',
        placeholder: 'Reason for the denial (optional)',
        maxLength: MAX_REASON_LENGTH,
        required: false,
        initialValue: data.reason ?? undefined,
      },
    ],
  });

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

/**
 * After a scope change, remove the old-scope entry — the upsert already created
 * the new-scope one. Returns a user-facing warning when removal fails: in that
 * case BOTH entries now exist (new-scope created, old-scope orphaned), so the
 * caller must surface it instead of reporting clean success.
 */
async function removeStaleEntryAfterScopeChange(
  ownerClient: OwnerClient,
  data: DenyDetailSession
): Promise<string | undefined> {
  const removeResult = await ownerClient.removeDenylistEntry(
    data.type,
    data.discordId,
    data.scope,
    data.scopeId
  );
  if (removeResult.ok) {
    return undefined;
  }
  logger.warn(
    { type: data.type, oldScope: data.scope, error: removeResult.error },
    'Scope change left a stale denylist entry (old-scope removal failed)'
  );
  return (
    '⚠️ Updated to the new scope, but the old entry could not be removed — ' +
    'both may now exist. Use `/deny browse` to verify and remove the stale one.'
  );
}

/** Handle edit modal submission */
export async function handleEditModal(
  interaction: ModalSubmitInteraction,
  entryId: string
): Promise<void> {
  // Ack first (3-second rule): deferUpdate before the Redis session read. On
  // expiry, followUp — reply would throw on the already-acked interaction. (The
  // modal-OPEN handler keeps showModalWithTimeoutCatch: showModal cannot be
  // preceded by a defer, so that path's getSession-before-ack is unavoidable.)
  await ackUpdate(interaction);

  const sessionManager = getSessionManager();
  const session = await sessionManager.get<DenyDetailSession>(
    interaction.user.id,
    ENTITY_TYPE,
    entryId
  );

  if (session === null) {
    await interaction.followUp({
      content: DASHBOARD_MESSAGES.SESSION_EXPIRED,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

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

    // If scope changed, delete the old entry (the upsert created a new one at
    // the new scope; this removes the stale entry at the prior scope). Returns a
    // warning when removal fails so we don't report clean success on a partial.
    const staleEntryWarning = scopeChanged
      ? await removeStaleEntryAfterScopeChange(ownerClient, data)
      : undefined;

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
    await interaction.editReply({
      // `?? null` rather than omitting: editReply leaves omitted fields
      // unchanged, so a clean edit must explicitly null the content to clear a
      // stale partial-failure warning left on the message by a prior edit.
      content: staleEntryWarning ?? null,
      embeds: [embed],
      components,
    });
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
