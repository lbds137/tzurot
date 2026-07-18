/**
 * Tier-B destructive confirmation — typed-phrase confirm for irreversible
 * operations (design-system spec §3.5; machinery §4.4 Tier B).
 *
 * Flow: warning embed + Cancel→Danger buttons → typed-phrase modal →
 * executeOperation. Routing goes through CommandHandler via the source
 * command's handleButton/handleModal (no collectors — restart-safe).
 *
 * Invariants the factory owns (call sites kept getting these wrong):
 * - Button order is ALWAYS Cancel (Secondary) → Confirm (Danger).
 * - Invoker ownership: the clicker must be the user Discord stamped on the
 *   parent message's `interactionMetadata` (the original slash invoker);
 *   other users' clicks are rejected with an ephemeral notice. The id is NOT
 *   carried in the customId — a snowflake would eat the 100-char budget that
 *   entityId needs (hard-delete carries `slug|channelId`).
 * - The modal's customId is DERIVED from the confirm button's own customId —
 *   a re-built config can never route the modal to a different command than
 *   the button it came from (the voice-clear drift class).
 * - Phrase compare is case-insensitive on trimmed input, matching the
 *   gateway-side validation semantics.
 * - Phrase mismatch: ephemeral reply showing entered vs expected, plus a
 *   best-effort parent-message cleanup.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ModalActionRowComponentBuilder,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type InteractionEditReplyOptions,
} from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { DestructiveCustomIds, type DestructiveParseResult } from '../customIds.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';

const logger = createLogger('confirm-destructive');

/** Field id of the typed-phrase input inside the confirmation modal. */
const CONFIRMATION_FIELD_ID = 'confirmation_phrase';

/** Buffer above the phrase length so minor whitespace doesn't hard-fail input. */
const CONFIRMATION_PHRASE_LENGTH_BUFFER = 5;

/**
 * Dynamic phrases longer than this fall back to the fixed 'DELETE'. Two
 * ceilings meet here: a phrase the user can't comfortably type stops being
 * friction and becomes a wall, and the modal label renders `Type: {phrase}`
 * within Discord's 45-char text-input-label limit — 39 keeps the label,
 * placeholder, and required input showing the SAME untruncated phrase.
 */
const MAX_DYNAMIC_PHRASE_LENGTH = 39;

/** Fixed fallback phrase (also the parameterized default for short flows). */
export const FIXED_DELETE_PHRASE = 'DELETE';

/**
 * Configuration for a destructive confirmation flow.
 */
export interface DestructiveConfirmationConfig {
  /** Source command name — the customId's routing segment (e.g., 'history'). */
  source: string;
  /** Operation identifier (e.g., 'hard-delete'). */
  operation: string;
  /** Optional entity identifier carried through the round trip. */
  entityId?: string;
  /** Warning title shown in the embed. */
  warningTitle: string;
  /** Warning description shown in the embed. */
  warningDescription: string;
  /** Text shown on the danger button. */
  buttonLabel: string;
  /** Modal title. */
  modalTitle: string;
  /** Label for the confirmation input field. */
  confirmationLabel: string;
  /** The exact phrase the user must type to confirm. */
  confirmationPhrase: string;
  /** Placeholder text for the input field. */
  confirmationPlaceholder: string;
}

/** The display-only subset needed to build the modal from a parsed button id. */
export type DestructiveModalDisplay = Pick<
  DestructiveConfirmationConfig,
  'modalTitle' | 'confirmationLabel' | 'confirmationPhrase' | 'confirmationPlaceholder'
>;

/**
 * Build the warning embed and buttons for a destructive operation.
 * Row order is Cancel → Confirm(Danger); the factory does not accept an order.
 */
export function buildDestructiveWarning(config: DestructiveConfirmationConfig): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle(config.warningTitle)
    .setDescription(config.warningDescription)
    .setColor(DISCORD_COLORS.ERROR);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        DestructiveCustomIds.cancelButton(config.source, config.operation, config.entityId)
      )
      .setLabel('Cancel')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        DestructiveCustomIds.confirmButton(config.source, config.operation, config.entityId)
      )
      .setLabel(config.buttonLabel)
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
  );

  return {
    embeds: [embed],
    components: [buttons],
  };
}

/**
 * Build the confirmation modal for a PARSED confirm-button customId. The modal
 * customId is derived from the button's own segments (never from a re-built
 * config), so button→modal routing continuity is structural.
 */
export function buildConfirmationModal(
  parsed: DestructiveParseResult,
  display: DestructiveModalDisplay
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(DestructiveCustomIds.modalSubmitFromParsed(parsed))
    .setTitle(display.modalTitle);

  const phrase = display.confirmationPhrase;
  const confirmationInput = new TextInputBuilder()
    .setCustomId(CONFIRMATION_FIELD_ID)
    .setLabel(display.confirmationLabel)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder(display.confirmationPlaceholder)
    .setMinLength(phrase.length)
    .setMaxLength(phrase.length + CONFIRMATION_PHRASE_LENGTH_BUFFER);

  const row = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
    confirmationInput
  );

  modal.addComponents(row);

  return modal;
}

/**
 * Reject the interaction with an ephemeral notice if the clicker isn't the
 * user Discord stamped on the parent message's `interactionMetadata` (the
 * original slash invoker). Defense-in-depth: Tier-B surfaces are ephemeral
 * today (only the invoker sees them), but the guard keeps a future public
 * surface from silently widening who can confirm a destructive act. When the
 * metadata is unavailable, the check fails OPEN with a warn — the ephemeral
 * surface is the primary gate, and blocking the invoker on missing metadata
 * would be worse than admitting a click the surface already restricts.
 *
 * Returns true when the check passed; false when it failed (an error reply
 * has already been sent). The success path performs no awaits, so callers may
 * treat this as ack-neutral (showModal/update can still be the first response).
 */
async function assertInvokerOwnership(
  interaction: ButtonInteraction | ModalSubmitInteraction
): Promise<boolean> {
  const invokerId = interaction.message?.interactionMetadata?.user.id;
  if (invokerId === undefined) {
    logger.warn(
      { customId: interaction.customId },
      'Destructive interaction has no interactionMetadata — skipping invoker check'
    );
    return true;
  }
  if (interaction.user.id !== invokerId) {
    await interaction.reply({
      content: renderSpec(
        CATALOG.error.permissionDenied(
          'confirm or cancel this operation — only the original command invoker can'
        )
      ),
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}

/** Parse a destructive customId, replying with a validation notice on failure. */
async function parseOrReject(
  interaction: ButtonInteraction | ModalSubmitInteraction
): Promise<DestructiveParseResult | null> {
  const parsed = DestructiveCustomIds.parse(interaction.customId);
  if (parsed === null) {
    logger.warn({ customId: interaction.customId }, 'Malformed destructive customId');
    await interaction.reply({
      content: renderSpec(CATALOG.error.validation('Malformed confirmation interaction.')),
      flags: MessageFlags.Ephemeral,
    });
  }
  return parsed;
}

/**
 * Handle cancel button click — assert invoker ownership, then update the
 * message to show cancellation.
 */
export async function handleDestructiveCancel(
  interaction: ButtonInteraction,
  cancelMessage = 'Operation cancelled.'
): Promise<void> {
  const parsed = await parseOrReject(interaction);
  if (parsed === null) {
    return;
  }
  if (!(await assertInvokerOwnership(interaction))) {
    return;
  }
  await interaction.update({
    content: cancelMessage,
    embeds: [],
    components: [],
  });
}

/**
 * Handle confirm button click — assert invoker ownership, then show the
 * typed-phrase modal. The modal's customId is derived from THIS button's
 * customId, so the display config cannot redirect routing.
 *
 * showModal must be the first response to the button interaction (Discord
 * requires it — no deferUpdate first); the guards above it await only on
 * their failure-return paths.
 */
export async function handleDestructiveConfirmButton(
  interaction: ButtonInteraction,
  display: DestructiveModalDisplay
): Promise<void> {
  const parsed = await parseOrReject(interaction);
  if (parsed === null) {
    return;
  }
  if (!(await assertInvokerOwnership(interaction))) {
    return;
  }
  const modal = buildConfirmationModal(parsed, display);
  await interaction.showModal(modal);
}

/**
 * Validate the typed confirmation phrase. Case-insensitive on trimmed input —
 * matching gateway-side phrase validation, so a lowercase-typing user isn't
 * rejected at the client gate when the server would have accepted the phrase.
 */
export function validateConfirmationPhrase(
  interaction: ModalSubmitInteraction,
  expectedPhrase: string
): boolean {
  const typedPhrase = interaction.fields.getTextInputValue(CONFIRMATION_FIELD_ID);
  return typedPhrase.trim().toUpperCase() === expectedPhrase.trim().toUpperCase();
}

/**
 * Result type for the destructive operation callback.
 */
export interface DestructiveOperationResult {
  /** Whether the operation succeeded. */
  success: boolean;
  /** Message to show on success. */
  successMessage?: string;
  /** Embed to show on success (alternative to successMessage). */
  successEmbed?: EmbedBuilder;
  /** Message to show on failure. */
  errorMessage?: string;
}

/** Data-only options for the modal-submit flow. */
export interface DestructiveSubmitOptions {
  /** Progress text shown while executeOperation runs (pending-states rule). */
  progressContent?: string;
}

/**
 * Baked phrase-mismatch handling: ephemeral reply showing entered vs expected,
 * plus best-effort parent-message cleanup (the parent may be deleted, perms
 * may have changed, or the bot restarted — the user already saw the ephemeral
 * notice, so a failed edit must not crash the handler).
 */
async function handlePhraseMismatch(
  interaction: ModalSubmitInteraction,
  expectedPhrase: string,
  enteredPhrase: string
): Promise<void> {
  await interaction.reply({
    content:
      `Cancelled — confirmation phrase did not match.\n\n` +
      `You entered: \`${escapeMarkdown(enteredPhrase)}\`\nExpected: \`${expectedPhrase}\``,
    flags: MessageFlags.Ephemeral,
  });
  if (interaction.message !== null) {
    try {
      await interaction.message.edit({
        content: 'Cancelled — confirmation phrase did not match.',
        embeds: [],
        components: [],
      });
    } catch (err) {
      logger.warn({ err, customId: interaction.customId }, 'Failed to clear destructive warning');
    }
  }
}

/**
 * Handle the typed-phrase modal submission: assert invoker ownership, validate
 * the phrase (baked mismatch handling), ack with a progress update, run the
 * operation, and render its result. Exactly ONE callback — the operation —
 * which receives the normalized entered phrase (token-handshake flows forward
 * it to the gateway for server-side validation).
 */
export async function handleDestructiveModalSubmit(
  interaction: ModalSubmitInteraction,
  expectedPhrase: string,
  executeOperation: (enteredPhrase: string) => Promise<DestructiveOperationResult>,
  options: DestructiveSubmitOptions = {}
): Promise<void> {
  const parsed = await parseOrReject(interaction);
  if (parsed === null) {
    return;
  }
  if (!(await assertInvokerOwnership(interaction))) {
    return;
  }

  const enteredPhrase = interaction.fields.getTextInputValue(CONFIRMATION_FIELD_ID).trim();

  if (!validateConfirmationPhrase(interaction, expectedPhrase)) {
    await handlePhraseMismatch(interaction, expectedPhrase, enteredPhrase);
    return;
  }

  // `update()` is only available on modal submits originating from a message
  // component — always true in this flow (the modal is shown by the confirm
  // button), but we narrow to satisfy the type checker.
  if (!interaction.isFromMessage()) {
    logger.warn({ customId: interaction.customId }, 'Destructive modal missing parent message');
    await interaction.reply({
      content: renderSpec(CATALOG.error.validation('Internal error: malformed modal context.')),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.update({
    content: options.progressContent ?? 'Working…',
    embeds: [],
    components: [],
  });

  const result = await executeOperation(enteredPhrase);

  if (result.success) {
    const reply: InteractionEditReplyOptions = {
      embeds: [],
      components: [],
    };

    if (result.successEmbed !== undefined) {
      reply.content = '';
      reply.embeds = [result.successEmbed];
    } else {
      reply.content = result.successMessage ?? 'Operation completed successfully.';
    }

    await interaction.editReply(reply);
  } else {
    await interaction.editReply({
      content: result.errorMessage ?? renderSpec(CATALOG.error.operationFailed('operation')),
      embeds: [],
      components: [],
    });
  }
}

/**
 * Options for creating a standard hard-delete config.
 */
interface HardDeleteConfigOptions {
  /** What's being deleted (e.g., 'conversation history'). */
  entityType: string;
  /** Name of the specific entity (e.g., personality name). */
  entityName: string;
  /** Additional warning text. */
  additionalWarning: string;
  /** Source command. */
  source: string;
  /** Operation name. */
  operation: string;
  /** Entity identifier. */
  entityId?: string;
  /**
   * Override the confirmation phrase. Wire-contract phrases (gateway-validated
   * handshakes) MUST pass their exact server-side phrase here. When omitted,
   * the phrase is the dynamic `DELETE {ENTITY NAME}` form (spec §3.5), falling
   * back to fixed 'DELETE' when the dynamic form would be too long to type.
   */
  confirmationPhrase?: string;
}

/** Compute the dynamic confirmation phrase for an entity name. */
export function dynamicDeletePhrase(entityName: string): string {
  const phrase = `DELETE ${entityName.toUpperCase()}`;
  return phrase.length > MAX_DYNAMIC_PHRASE_LENGTH ? FIXED_DELETE_PHRASE : phrase;
}

/**
 * Build the modal display for a delete flow from its entity name — the single
 * source both the warning config and the confirm-button handler use, so the
 * phrase shown in the modal always matches the phrase the submit validates.
 */
export function hardDeleteModalDisplay(
  entityName: string,
  confirmationPhrase?: string
): DestructiveModalDisplay {
  const phrase = confirmationPhrase ?? dynamicDeletePhrase(entityName);
  return {
    modalTitle: 'Confirm Deletion',
    // Discord caps text-input labels at 45 chars.
    confirmationLabel: `Type: ${phrase}`.slice(0, 45),
    confirmationPhrase: phrase,
    confirmationPlaceholder: phrase,
  };
}

/**
 * Convenience function to create a standard hard-delete config.
 */
export function createHardDeleteConfig(
  options: HardDeleteConfigOptions
): DestructiveConfirmationConfig {
  const { entityType, entityName, additionalWarning, source, operation, entityId } = options;
  const display = hardDeleteModalDisplay(entityName, options.confirmationPhrase);
  return {
    source,
    operation,
    entityId,
    warningTitle: `Delete ${entityType}`,
    warningDescription:
      `Are you sure you want to **permanently delete** ${entityType} for **${entityName}**?\n\n` +
      `${additionalWarning}\n\n` +
      `Type \`${display.confirmationPhrase}\` in the next prompt to confirm.`,
    buttonLabel: 'Delete Forever',
    modalTitle: display.modalTitle,
    confirmationLabel: display.confirmationLabel,
    confirmationPhrase: display.confirmationPhrase,
    confirmationPlaceholder: display.confirmationPlaceholder,
  };
}
