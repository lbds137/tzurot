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
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  AttachmentBuilder,
  DiscordAPIError,
  MessageFlags,
} from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS, getConfig, type EnvConfig } from '@tzurot/common-types';
import { buildDashboardCustomId, type SectionDefinition } from '../../utils/dashboard/types.js';
import { buildSectionModal } from '../../utils/dashboard/ModalFactory.js';
import { type CharacterData } from './config.js';
import {
  findCharacterSection,
  loadCharacterSectionData,
  resolveCharacterSectionContext,
} from './sectionContext.js';

const logger = createLogger('character-truncation-warning');

/**
 * Strip a leading emoji + whitespace from a section label so modal titles
 * / embed titles / attachment copy read cleanly. Mirrors the inline regex
 * in `ModalFactory.ts:51` (modal title derivation) — kept in sync by
 * convention until a section-label shortener becomes a third consumer
 * that warrants a shared helper.
 */
function stripLeadingEmoji(label: string): string {
  return label.replace(/^[^\w\s]+\s*/, '');
}

/**
 * Convert a user-facing field label into a safe filename slug. Lowercased,
 * whitespace collapsed to underscores, non-alphanumeric chars removed so
 * the resulting name works across OSes. Used for View Full attachments so
 * the user sees `age.txt` instead of the internal `personalityAge.txt`.
 */
function toSafeFilename(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * A field whose current value exceeds its modal maxLength.
 */
export interface OverLengthField {
  /** The field id (matches CharacterData key) */
  fieldId: string;
  /** The user-facing label */
  label: string;
  /** Current character count */
  current: number;
  /** Configured maxLength — what the edit modal will truncate down to */
  max: number;
}

/**
 * Scan a section's fields and report any whose current value exceeds
 * the modal's maxLength constraint.
 *
 * Fields with `field.maxLength === undefined` are treated as unconstrained —
 * the ModalFactory applies default caps only when showing the modal, but
 * for warning purposes we only flag explicit user-visible caps. If a
 * field intentionally uses the default cap without declaring it, the
 * silent-truncate path for that field remains unchanged by this module.
 */
export function detectOverLengthFields(
  section: SectionDefinition<CharacterData>,
  data: CharacterData
): OverLengthField[] {
  const over: OverLengthField[] = [];
  for (const field of section.fields) {
    if (field.maxLength === undefined) {
      continue;
    }
    const raw = (data as Record<string, unknown>)[field.id];
    if (typeof raw !== 'string') {
      continue;
    }
    if (raw.length > field.maxLength) {
      over.push({
        fieldId: field.id,
        label: field.label,
        current: raw.length,
        max: field.maxLength,
      });
    }
  }
  return over;
}

/**
 * Build the destructive-action warning embed listing the over-length
 * fields, their current lengths, and the per-field truncation amount.
 */
export function buildTruncationWarningEmbed(
  overLength: OverLengthField[],
  sectionLabel: string
): EmbedBuilder {
  const plainLabel = stripLeadingEmoji(sectionLabel);

  const fieldLines = overLength
    .map(f => {
      const loss = f.current - f.max;
      return (
        `• **${f.label}** — ${f.current.toLocaleString()} / ${f.max.toLocaleString()} chars ` +
        `(${loss.toLocaleString()} will be truncated)`
      );
    })
    .join('\n');

  const totalLoss = overLength.reduce((sum, f) => sum + (f.current - f.max), 0);

  return new EmbedBuilder()
    .setTitle(`⚠️ "${plainLabel}" contains content longer than Discord modals allow`)
    .setColor(DISCORD_COLORS.WARNING)
    .setDescription(
      `One or more fields in this section hold values that exceed the edit modal's limit:\n\n` +
        `${fieldLines}\n\n` +
        `⚠️ **Opening the edit modal will pre-fill the fields with truncated values.** ` +
        `If you save the modal, the trailing content will be lost permanently.\n\n` +
        `Choose **View Full** to inspect the current full content before deciding. ` +
        `Choose **Edit with Truncation** only if you're OK losing the trailing text.`
    )
    .setFooter({
      text: `${totalLoss.toLocaleString()} total characters would be truncated across ${overLength.length} field${overLength.length === 1 ? '' : 's'}`,
    });
}

/**
 * Build the three-button row for the warning, ordered per `04-discord.md`
 * Standard Button Order (Primary first, Destructive last):
 * - View Full (primary, safe read-only inspection)
 * - Cancel (secondary, dismiss)
 * - Edit with Truncation (danger, opt-in to destructive edit)
 *
 * The destructive-last convention matches the memory detail flow and the
 * delete-confirmation dialogs across the codebase; consistency outranks
 * the "lead with the warning" instinct for this UX.
 */
export function buildTruncationButtons(
  entityId: string,
  sectionId: string
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildDashboardCustomId('character', 'view_full', entityId, sectionId))
      .setLabel('View Full')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildDashboardCustomId('character', 'cancel_edit', entityId, sectionId))
      .setLabel('Cancel')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildDashboardCustomId('character', 'edit_truncated', entityId, sectionId))
      .setLabel('Edit with Truncation')
      .setEmoji('✂️')
      .setStyle(ButtonStyle.Danger)
  );
}

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
    components: [buildTruncationButtons(entityId, section.id)],
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Build the "Open Editor" button shown after the user opts into the
 * truncating edit. Splitting the opt-in confirmation from the modal-open
 * click lets us satisfy Discord's "showModal must be the first response"
 * constraint without doing any async work before the showModal call.
 */
export function buildOpenEditorButtonRow(
  entityId: string,
  sectionId: string
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildDashboardCustomId('character', 'open_editor', entityId, sectionId))
      .setLabel('Open Editor')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Primary)
  );
}

/**
 * Build the embed shown between the Edit-with-Truncation opt-in and the
 * actual modal. It reassures the user that their consent was recorded
 * and directs them to the single click that opens the modal.
 */
export function buildReadyToEditEmbed(sectionLabel: string): EmbedBuilder {
  const plainLabel = stripLeadingEmoji(sectionLabel);
  return new EmbedBuilder()
    .setTitle(`✅ Ready to edit "${plainLabel}"`)
    .setColor(DISCORD_COLORS.SUCCESS)
    .setDescription(
      `Your opt-in to truncate over-length fields has been recorded. ` +
        `Click **Open Editor** below to open the edit modal. ` +
        `The modal will open with the current values truncated to the edit limit.`
    );
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
    components: [buildOpenEditorButtonRow(entityId, sectionId)],
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
  try {
    await interaction.showModal(modal);
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === 10062) {
      // 3-sec window blew despite the session warm (e.g., Redis latency
      // spike). Log with enough context to track frequency. The interaction
      // token is dead so followUp also fails — we try once anyway for the
      // rare race where Discord still accepts it, and swallow the inner
      // failure so the outer CommandHandler catch doesn't log twice.
      logger.warn(
        { userId: interaction.user.id, entityId, sectionId },
        'Open Editor showModal exceeded 3-second window (10062)'
      );
      try {
        await interaction.followUp({
          content:
            '⏰ Took too long to open the editor. Please click **Open Editor** again, ' +
            'or re-open the dashboard if the button is gone.',
          flags: MessageFlags.Ephemeral,
        });
      } catch {
        // Expected on a fully-dead interaction token. Nothing else to do.
      }
      return;
    }
    throw error;
  }
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
