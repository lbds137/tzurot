/**
 * The unified truncation edit flow — the per-entity glue that remained
 * duplicated after the truncationGate primitives (detection/embeds/buttons)
 * were extracted. Character and persona each ran the same two-click flow
 * with the same 10062 catch and the same View Full `.txt` shape; what
 * genuinely diverges is HOW each entity resolves its section data — and
 * that lives behind {@link EntitySectionAdapter}, a cohesive three-method
 * seam (the TtsProvider pattern): remove any one method and the others stop
 * making sense, which is what distinguishes an adapter interface from three
 * loose callbacks under the 2-callback ceiling.
 *
 * Adapter IMPLEMENTATIONS stay entity-local (`commands/character/`,
 * `commands/persona/`) — this module owns only the interface and the flow.
 *
 * Why two clicks instead of one showModal:
 * Discord requires `showModal` to be the first response to an interaction
 * (you can't `deferReply`/`deferUpdate` then `showModal`). That made the
 * single-click flow vulnerable to 10062 Unknown interaction if any async
 * work (session resolution, gateway fallback) ate the 3-second response
 * budget. The flow:
 * - Step 1 (`handleEditTruncatedButton`): `interaction.update` immediately
 *   to morph the warning embed into a "Ready to edit" state with a single
 *   Open Editor button. No async work runs before the update, so the
 *   3-second budget is never at risk. After the update the session is
 *   warmed in the background so the Open Editor click hits a hot cache.
 * - Step 2 (`handleOpenEditorButton`): shows the modal with no pre-work
 *   beyond a (usually Redis-hot) session read. Residual risk is logged +
 *   surfaced via followUp if 10062 still fires.
 */

import {
  AttachmentBuilder,
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { createLogger } from '@tzurot/common-types/utils/logger';
import type {
  DashboardConfig,
  DashboardContext,
  SectionDefinition,
  TruncationGateEntityType,
} from '../types.js';
import { buildSectionModal } from '../ModalFactory.js';
import { showModalWithTimeoutCatch } from '../showModalWithTimeoutCatch.js';
import {
  detectOverLengthFields,
  buildTruncationWarningEmbed,
  buildTruncationButtons,
  buildOpenEditorButtonRow,
  buildReadyToEditEmbed,
  stripLeadingEmoji,
  toSafeFilename,
  type OverLengthField,
} from './index.js';

type Logger = ReturnType<typeof createLogger>;

/** The sync bundle every entity's pre-ack section lookup must produce. */
export interface EntitySectionSync<TData extends Record<string, unknown>> {
  dashboardConfig: DashboardConfig<TData>;
  section: SectionDefinition<TData>;
}

/** The full bundle after data resolution. */
export interface EntitySectionContext<
  TData extends Record<string, unknown>,
> extends EntitySectionSync<TData> {
  data: TData;
  /** Forwarded to buildSectionModal when the entity's modals need it. */
  context?: DashboardContext;
}

/**
 * The per-entity seam. All three methods are authored together per entity
 * (findSection's sync bundle is what loadSectionData warms; both are what
 * resolveSectionContext composes) — the cohesion that makes this one
 * adapter parameter rather than three callbacks.
 *
 * Error-reply contract: `loadSectionData` and `resolveSectionContext` send
 * their own user-facing error (followUp/reply) before returning null; the
 * flow treats null as "already handled, stop".
 */
export interface EntitySectionAdapter<
  TData extends Record<string, unknown>,
  TSync extends EntitySectionSync<TData> = EntitySectionSync<TData>,
> {
  /** Custom-id entity segment — the truncation-gate union keeps typos uncompilable. */
  readonly entityType: TruncationGateEntityType;
  /** Sync lookup — no I/O, safe to call before the interaction ack. */
  findSection(interaction: ButtonInteraction, sectionId: string): TSync | null;
  /** Best-effort session warm for step 2's hot-cache hit. */
  loadSectionData(
    interaction: ButtonInteraction,
    entityId: string,
    sync: TSync
  ): Promise<EntitySectionContext<TData> | null>;
  /** Full resolve for the modal / View Full paths. */
  resolveSectionContext(
    interaction: ButtonInteraction,
    entityId: string,
    sectionId: string
  ): Promise<EntitySectionContext<TData> | null>;
}

/**
 * Property-style (arrow) signatures so the handlers are freestanding
 * functions — callers re-export them individually, and a `this`-carrying
 * method signature would trip unbound-method lint at those sites.
 */
export interface TruncationEditFlow<TData extends Record<string, unknown>> {
  showTruncationWarning: (
    interaction: StringSelectMenuInteraction,
    section: SectionDefinition<TData>,
    entityId: string,
    overLength: OverLengthField[]
  ) => Promise<void>;
  handleEditTruncatedButton: (
    interaction: ButtonInteraction,
    entityId: string,
    sectionId: string
  ) => Promise<void>;
  handleOpenEditorButton: (
    interaction: ButtonInteraction,
    entityId: string,
    sectionId: string
  ) => Promise<void>;
  handleViewFullButton: (
    interaction: ButtonInteraction,
    entityId: string,
    sectionId: string
  ) => Promise<void>;
  handleCancelEditButton: (interaction: ButtonInteraction) => Promise<void>;
}

/**
 * "View Full" — render the over-length field values as attached `.txt`
 * files so the user can inspect content without triggering the destructive
 * edit path. Module-level so the factory stays within the function-size lint.
 */
async function runViewFull<
  TData extends Record<string, unknown>,
  TSync extends EntitySectionSync<TData>,
>(
  adapter: EntitySectionAdapter<TData, TSync>,
  logger: Logger,
  interaction: ButtonInteraction,
  entityId: string,
  sectionId: string
): Promise<void> {
  // Ack within 3 seconds before any async work — resolveSectionContext
  // hits Redis (and may fall through to a gateway API call on session
  // miss), which could blow the 3-second window under load.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ctx = await adapter.resolveSectionContext(interaction, entityId, sectionId);
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

/** Build the five flow handlers for one entity's adapter. */
export function createTruncationEditFlow<
  TData extends Record<string, unknown>,
  TSync extends EntitySectionSync<TData> = EntitySectionSync<TData>,
>(adapter: EntitySectionAdapter<TData, TSync>, logger: Logger): TruncationEditFlow<TData> {
  const { entityType } = adapter;

  return {
    async showTruncationWarning(interaction, section, entityId, overLength) {
      await interaction.reply({
        embeds: [buildTruncationWarningEmbed(overLength, section.label)],
        components: [buildTruncationButtons(entityType, entityId, section.id)],
        flags: MessageFlags.Ephemeral,
      });
    },

    async handleEditTruncatedButton(interaction, entityId, sectionId) {
      // Sync-resolve the section ONCE — label for the embed copy plus the
      // bundle reused in step 2's warm, avoiding a double config lookup.
      const sync = adapter.findSection(interaction, sectionId);
      const sectionLabel = sync?.section.label ?? sectionId;

      // Step 1 — ack within the 3-sec budget via `update`. No async before this.
      await interaction.update({
        embeds: [buildReadyToEditEmbed(sectionLabel)],
        components: [buildOpenEditorButtonRow(entityType, entityId, sectionId)],
      });

      // Step 2 — warm the session so the Open Editor click gets a hot cache
      // hit. If the sync lookup failed (unknown sectionId), there is nothing
      // to warm — the open_editor click will surface the error itself.
      if (sync === null) {
        logger.warn(
          { userId: interaction.user.id, entityId, sectionId },
          'Unknown sectionId in edit_truncated opt-in; open_editor click will surface the error'
        );
        return;
      }

      // If the data fetch fails (entity-deleted race between warning and
      // opt-in click), loadSectionData already sent a followUp error. The
      // user sees "Ready to edit" + the error followUp — strictly better
      // than a silent 10062; log so the frequency stays trackable.
      try {
        const warmResult = await adapter.loadSectionData(interaction, entityId, sync);
        if (warmResult === null) {
          logger.warn(
            { userId: interaction.user.id, entityId, sectionId },
            'Session warm returned null after edit_truncated opt-in (likely entity-deleted race); user saw Ready-to-Edit + followUp error'
          );
        }
      } catch (error) {
        logger.warn(
          { err: error, userId: interaction.user.id, entityId, sectionId },
          'Session warm failed after edit_truncated opt-in; open_editor will retry'
        );
      }
    },

    async handleOpenEditorButton(interaction, entityId, sectionId) {
      const ctx = await adapter.resolveSectionContext(interaction, entityId, sectionId);
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
    },

    handleViewFullButton: (interaction, entityId, sectionId) =>
      runViewFull(adapter, logger, interaction, entityId, sectionId),

    async handleCancelEditButton(interaction) {
      await interaction.update({
        content: '✅ Edit cancelled.',
        embeds: [],
        components: [],
      });
    },
  };
}
