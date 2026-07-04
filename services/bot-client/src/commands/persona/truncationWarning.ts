/**
 * Persona Truncation Warning
 *
 * Mirrors `commands/character/truncationWarning.ts` but for persona.
 * Same two-click flow, same 10062 catch on Open Editor, same View Full
 * `.txt` attachment shape. Imports detection + display primitives from
 * `utils/dashboard/truncationGate/`; the persona-specific bits are the
 * data resolver (`resolvePersonaSectionContext`) and the entityType
 * passed into the shared button builders.
 *
 * Defense-in-depth: detects when stored persona content exceeds the
 * modal `maxLength` and warns the user before any silent truncation
 * happens. The cap-mismatch class of bug (UI < API) is what made this
 * gate necessary on the persona side.
 */

import {
  AttachmentBuilder,
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type SectionDefinition } from '../../utils/dashboard/types.js';
import { buildSectionModal } from '../../utils/dashboard/ModalFactory.js';
import { showModalWithTimeoutCatch } from '../../utils/dashboard/showModalWithTimeoutCatch.js';
import {
  detectOverLengthFields,
  buildTruncationWarningEmbed,
  buildTruncationButtons,
  buildOpenEditorButtonRow,
  buildReadyToEditEmbed,
  stripLeadingEmoji,
  toSafeFilename,
  type OverLengthField,
} from '../../utils/dashboard/truncationGate/index.js';
import type { FlattenedPersonaData } from './config.js';
import {
  findPersonaSection,
  loadPersonaSectionData,
  resolvePersonaSectionContext,
} from './sectionContext.js';

const logger = createLogger('persona-truncation-warning');
const ENTITY_TYPE = 'persona';

/**
 * Show the truncation warning as an ephemeral reply to the select-menu
 * interaction.
 */
export async function showTruncationWarning(
  interaction: StringSelectMenuInteraction,
  section: SectionDefinition<FlattenedPersonaData>,
  entityId: string,
  overLength: OverLengthField[]
): Promise<void> {
  await interaction.reply({
    embeds: [buildTruncationWarningEmbed(overLength, section.label)],
    components: [buildTruncationButtons(ENTITY_TYPE, entityId, section.id)],
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * "Edit with Truncation" handler — step 1 of a two-click flow. See
 * `commands/character/truncationWarning.ts` `handleEditTruncatedButton`
 * for the full rationale on why two clicks are required (Discord
 * `showModal` must be the first response and can't be deferred).
 *
 * Order is load-bearing: `interaction.update` MUST run before any async
 * work, so the 3-second budget is never blown by the subsequent session
 * warm. The session warm is best-effort — its failure doesn't propagate
 * because step 2 (`handleOpenEditorButton`) does its own resolveContext
 * with the same fallback.
 */
export async function handleEditTruncatedButton(
  interaction: ButtonInteraction,
  entityId: string,
  sectionId: string
): Promise<void> {
  const sync = findPersonaSection(sectionId);
  const sectionLabel = sync?.section.label ?? sectionId;

  // Step 1 — ack within the 3-sec budget via `update`. No async before this.
  await interaction.update({
    embeds: [buildReadyToEditEmbed(sectionLabel)],
    components: [buildOpenEditorButtonRow(ENTITY_TYPE, entityId, sectionId)],
  });

  // Step 2 — warm the session so the Open Editor click gets a hot cache hit.
  if (sync === null) {
    logger.warn(
      { userId: interaction.user.id, entityId, sectionId },
      'Unknown sectionId in edit_truncated opt-in; open_editor click will surface the error'
    );
    return;
  }

  try {
    const warmResult = await loadPersonaSectionData(interaction, entityId, sync);
    if (warmResult === null) {
      logger.warn(
        { userId: interaction.user.id, entityId, sectionId },
        'Session warm returned null after edit_truncated opt-in (likely persona-deleted race); user saw Ready-to-Edit + followUp error'
      );
    }
  } catch (error) {
    logger.warn(
      { err: error, userId: interaction.user.id, entityId, sectionId },
      'Session warm failed after edit_truncated opt-in; open_editor will retry'
    );
  }
}

/**
 * "Open Editor" handler — step 2 of the two-click flow. Shows the section
 * edit modal. See character handler comments for the residual 10062
 * 3-sec-window risk and rationale for the catch-and-followUp path.
 */
export async function handleOpenEditorButton(
  interaction: ButtonInteraction,
  entityId: string,
  sectionId: string
): Promise<void> {
  const ctx = await resolvePersonaSectionContext(interaction, entityId, sectionId);
  if (ctx === null) {
    return;
  }

  const modal = buildSectionModal(ctx.dashboardConfig, ctx.section, entityId, ctx.data);
  await showModalWithTimeoutCatch(
    interaction,
    modal,
    { source: 'handleOpenEditorButton', userId: interaction.user.id, entityId, sectionId },
    '⏰ Took too long to open the editor. Please click **Open Editor** again, ' +
      'or re-open the dashboard if the button is gone.'
  );
}

/**
 * "View Full" handler — render the over-length field values as attached
 * `.txt` files so the user can inspect their content without triggering
 * the destructive edit path.
 */
export async function handleViewFullButton(
  interaction: ButtonInteraction,
  entityId: string,
  sectionId: string
): Promise<void> {
  // Ack within 3 seconds before any async work — resolvePersonaSectionContext
  // hits Redis (and may fall through to a gateway API call on session miss),
  // which could blow the 3-second window under load.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ctx = await resolvePersonaSectionContext(interaction, entityId, sectionId);
  if (ctx === null) {
    return;
  }

  const overLength = detectOverLengthFields(ctx.section, ctx.data);
  if (overLength.length === 0) {
    // Edge case: data changed between warning and View Full click (e.g.,
    // a concurrent save trimmed fields). Let the user know.
    await interaction.editReply({
      content: '✅ No fields in this section exceed the edit limit. Nothing to display.',
    });
    return;
  }

  const attachments = overLength.map(f => {
    const content = (ctx.data as Record<string, unknown>)[f.fieldId];
    const textContent = typeof content === 'string' ? content : '';
    return new AttachmentBuilder(Buffer.from(textContent, 'utf-8'), {
      name: `${toSafeFilename(f.label)}.txt`,
    });
  });

  const plainLabel = stripLeadingEmoji(ctx.section.label);
  const summary = overLength
    .map(f => `• \`${toSafeFilename(f.label)}.txt\` — ${f.current.toLocaleString()} chars`)
    .join('\n');

  await interaction.editReply({
    content:
      `**Full content for "${plainLabel}"** (read-only):\n${summary}\n\n` +
      `These files hold the current, untruncated values. Editing this section ` +
      `via the dashboard would cut each field to its modal cap.`,
    files: attachments,
  });
  logger.info(
    { userId: interaction.user.id, entityId, sectionId, fields: overLength.length },
    'View Full served over-length field content'
  );
}

/**
 * "Cancel" handler — dismiss the warning and leave the dashboard as-is.
 */
export async function handleCancelEditButton(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    content: '✅ Edit cancelled.',
    embeds: [],
    components: [],
  });
}
