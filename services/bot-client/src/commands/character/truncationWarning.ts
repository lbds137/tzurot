/**
 * Character Truncation Warning
 *
 * Detects over-length legacy field values in a character section before a
 * user opens the edit modal, and shows a destructive-action warning with
 * explicit opt-in. Ports the pattern from `memory/detailModals.ts`
 * (buildTruncationWarningEmbed / handleEditTruncatedButton) to the
 * character dashboard's many-field modals.
 *
 * The silent-truncate site in `utils/dashboard/ModalFactory.ts:108`
 * still runs after user consent — this module's job is gating the
 * modal on an informed decision, plus offering a View Full read path
 * so users can see the content they'd be about to truncate before
 * committing.
 */

import {
  AttachmentBuilder,
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { getConfig, type EnvConfig } from '@tzurot/common-types/config/config';
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
import type { CharacterData } from './characterTypes.js';
import {
  findCharacterSection,
  loadCharacterSectionData,
  resolveCharacterSectionContext,
} from './sectionContext.js';

const logger = createLogger('character-truncation-warning');
const ENTITY_TYPE = 'character';

/**
 * Show the truncation warning as an ephemeral reply to the select-menu
 * interaction. Extracted so the dashboard handler stays compact.
 */
export async function showTruncationWarning(
  interaction: StringSelectMenuInteraction,
  section: SectionDefinition<CharacterData>,
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
 * "Edit with Truncation" handler — step 1 of a two-click flow.
 *
 * Why two clicks instead of one showModal:
 * Discord requires `showModal` to be the first response to an interaction
 * (you can't `deferReply`/`deferUpdate` then `showModal`). That made the
 * single-click flow vulnerable to 10062 Unknown interaction if any async
 * work (session resolution, gateway fallback) ate the 3-second response
 * budget. See PR #825 R4 — the reviewer's option (b).
 *
 * New flow:
 * - Step 1 (this handler): `interaction.update` immediately to morph the
 *   warning embed into a "Ready to edit" state with a single Open Editor
 *   button. The update call has no async work before it, so the 3-second
 *   budget is never at risk. After the update we warm the session in the
 *   background so the Open Editor click hits a hot cache.
 * - Step 2 (`handleOpenEditorButton`): shows the modal with no pre-work
 *   beyond a Redis-hot session read. Residual risk is logged + surfaced
 *   if 10062 still fires.
 */
export async function handleEditTruncatedButton(
  interaction: ButtonInteraction,
  entityId: string,
  sectionId: string,
  config: EnvConfig = getConfig()
): Promise<void> {
  // Sync-resolve the section ONCE — label for the embed copy plus the
  // dashboard bundle we reuse in step 2's warm. This avoids the double
  // getCharacterDashboardConfig call that the naive shape (label-sync +
  // full resolveCharacterSectionContext) would perform. Surfaced in PR
  // #825 R9 review.
  const sync = findCharacterSection(sectionId, interaction.user.id);
  const sectionLabel = sync?.section.label ?? sectionId;

  // Step 1 — ack within the 3-sec budget via `update`. No async before this.
  await interaction.update({
    embeds: [buildReadyToEditEmbed(sectionLabel)],
    components: [buildOpenEditorButtonRow(ENTITY_TYPE, entityId, sectionId)],
  });

  // Step 2 — warm the session so the Open Editor click gets a hot cache
  // hit. If the sync section lookup failed (unknown sectionId), we
  // can't warm and there's nothing to do — the open_editor click will
  // hit its own resolveContext + error path. Swallow quietly.
  if (sync === null) {
    logger.warn(
      { userId: interaction.user.id, entityId, sectionId },
      'Unknown sectionId in edit_truncated opt-in; open_editor click will surface the error'
    );
    return;
  }

  // If the data fetch fails (character-deleted race between warning and
  // opt-in click), loadCharacterSectionData already sent a followUp via
  // replyError. The user now sees "Ready to edit" + error followUp —
  // strictly better than pre-option-(b) silent 10062; log so the
  // frequency is trackable.
  try {
    const warmResult = await loadCharacterSectionData(interaction, entityId, config, sync);
    if (warmResult === null) {
      logger.warn(
        { userId: interaction.user.id, entityId, sectionId },
        'Session warm returned null after edit_truncated opt-in (likely character-deleted race); user saw Ready-to-Edit + followUp error'
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
 * edit modal.
 *
 * Discord requires `showModal` as the first response — we call it with
 * minimum pre-work: one `resolveCharacterSectionContext` call. In the
 * common case (session warmed by step 1), that's a Redis hit in the low
 * single-digit ms. But `fetchOrCreateSession` has a gateway API fallback
 * for the cold-cache case (Redis eviction, pod cold start, TTL past the
 * step-1 warm window). That fallback routes through the gateway's
 * fetchCharacter — typically 100-300ms locally, potentially multi-second
 * under load. This is the residual 3-second-budget risk that option (b)
 * narrowed but did not eliminate.
 *
 * On the narrow residual failure where the 3-sec window still blows
 * (cold cache + slow gateway), we catch `10062 Unknown interaction` and
 * surface an explicit retry message via `followUp` instead of silently
 * dying in the CommandHandler catch chain. The residual is tracked in
 * BACKLOG ("Character Open Editor can still blow the 3-second window")
 * for future UX improvement — the retry message is user-actionable but
 * mid-flow retries are confusing, and the eventual fix is stashing
 * either the resolved context or pre-built modal during step 1.
 */
export async function handleOpenEditorButton(
  interaction: ButtonInteraction,
  entityId: string,
  sectionId: string,
  config: EnvConfig = getConfig()
): Promise<void> {
  const ctx = await resolveCharacterSectionContext(interaction, entityId, sectionId, config);
  if (ctx === null) {
    return;
  }

  const modal = buildSectionModal(
    ctx.dashboardConfig,
    ctx.section,
    entityId,
    ctx.data,
    ctx.context
  );
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
 * the destructive edit path. Attachments handle arbitrary sizes uniformly
 * (no Discord embed-limit gymnastics) and let users save/search the
 * content locally.
 */
export async function handleViewFullButton(
  interaction: ButtonInteraction,
  entityId: string,
  sectionId: string,
  config: EnvConfig = getConfig()
): Promise<void> {
  // Ack within 3 seconds before any async work — `resolveCharacterSectionContext`
  // hits Redis (and may fall through to a gateway API call on session miss),
  // which could blow the 3-second window under load. `deferReply({ ephemeral })`
  // establishes the response now; `editReply` / `followUp` fill it in later.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ctx = await resolveCharacterSectionContext(interaction, entityId, sectionId, config);
  if (ctx === null) {
    // sectionContext already `followUp`-ed the error (it detects the defer).
    return;
  }

  const overLength = detectOverLengthFields(ctx.section, ctx.data);
  if (overLength.length === 0) {
    // Edge case: data changed between warning and View Full click (e.g.,
    // a concurrent save trimmed fields). Let the user know there's
    // nothing to view specially.
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
