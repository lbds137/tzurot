/**
 * Purge Handler
 * Handles /memory purge command - delete ALL memories for a character.
 * Requires typed confirmation modal for safety.
 *
 * Routing model (per `.claude/rules/04-discord.md` "Component Interaction Routing"):
 * The slash command renders a warning + proceed/cancel buttons, then returns.
 * Button + modal interactions are routed via CommandHandler → memory's
 * `handleButton` / `handleModal` → the exports below. No `awaitMessageComponent`
 * or `awaitModalSubmit` (those race with CommandHandler and produce 10062
 * "Unknown interaction" errors).
 *
 * State is encoded in custom IDs (personalityId) and the warning embed's
 * footer (personality display name) — restart-safe, multi-replica-safe.
 */

import {
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  escapeMarkdown,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { memoryPurgeOptions } from '@tzurot/common-types/generated/commandOptions';
import { type PurgeMemoriesResponse } from '@tzurot/common-types/schemas/api/memory';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type UserClient } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { createDangerEmbed, createSuccessEmbed } from '../../utils/commandHelpers.js';
import { resolveRequiredPersonality } from './resolveHelpers.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

const logger = createLogger('memory-purge');

/**
 * Custom ID prefix used by CommandHandler to route purge component interactions
 * to memory's handleButton / handleModal. Must be registered in
 * memory/index.ts `componentPrefixes`.
 */
export const MEMORY_PURGE_PREFIX = 'memory-purge';

/** Footer marker that encodes the character display name on the warning embed. */
const FOOTER_PREFIX = 'Character: ';

/** Buffer for confirmation phrase input to allow minor whitespace. */
const CONFIRMATION_PHRASE_LENGTH_BUFFER = 5;

/** Build the confirmation phrase the user must type to confirm the purge. */
function getConfirmationPhrase(personalityName: string): string {
  return `DELETE ${personalityName.toUpperCase()} MEMORIES`;
}

/** Read the personality display name from the warning embed's footer. */
function readPersonalityNameFromMessage(
  interaction: ButtonInteraction | ModalSubmitInteraction
): string | null {
  const footerText = interaction.message?.embeds[0]?.footer?.text;
  if (footerText?.startsWith(FOOTER_PREFIX) !== true) {
    return null;
  }
  return footerText.slice(FOOTER_PREFIX.length);
}

/**
 * Reject the interaction with an ephemeral message if the clicker isn't the
 * original command invoker. Defense-in-depth: the API also rejects cross-user
 * purge attempts at the data layer, but this surfaces the right UX message
 * instead of an opaque "Failed to purge memories: ..." error.
 *
 * Returns true when the check passed (interaction may proceed); false when
 * the check failed and an error reply was already sent.
 */
async function assertInvokerOwnership(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  invokerIdFromCustomId: string | undefined
): Promise<boolean> {
  if (invokerIdFromCustomId === undefined || invokerIdFromCustomId === '') {
    logger.warn({ customId: interaction.customId }, 'Purge interaction missing invoker ID');
    await interaction.reply({
      content: renderSpec(
        CATALOG.error.validation('Malformed purge interaction (missing invoker ID).')
      ),
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  if (interaction.user.id !== invokerIdFromCustomId) {
    await interaction.reply({
      content: renderSpec(
        CATALOG.error.permissionDenied(
          'confirm or cancel this purge — only the original command invoker can'
        )
      ),
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}

/**
 * Handle /memory purge — show warning + confirmation buttons, then return.
 * Button + modal handling continues via handlePurgeButton / handlePurgeModal.
 */
export async function handlePurge(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const { userClient } = clientsFor(context.interaction);
  const options = memoryPurgeOptions(context.interaction);
  const personalityInput = options.character();

  try {
    const personalityId = await resolveRequiredPersonality(context, userClient, personalityInput);
    if (personalityId === null) {
      return;
    }

    const statsResult = await userClient.getStats({ personalityId });

    if (!statsResult.ok) {
      logger.warn({ userId, personalityInput, status: statsResult.status }, 'Purge stats failed');
      await context.editReply({
        content:
          statsResult.status === 404
            ? renderSpec(
                CATALOG.error.notFound('Character', { name: escapeMarkdown(personalityInput) })
              )
            : renderSpec(
                classifyGatewayFailure(statsResult, 'memory stats', { operation: 'read' })
              ),
      });
      return;
    }

    const stats = statsResult.data;

    if (stats.totalCount === 0) {
      await context.editReply({
        content: `No memories found for **${escapeMarkdown(stats.personalityName)}**.`,
      });
      return;
    }

    const confirmPhrase = getConfirmationPhrase(stats.personalityName);
    const deletableCount = stats.totalCount - stats.lockedCount;

    let description = `You are about to **permanently delete ALL ${deletableCount} memories** for **${escapeMarkdown(stats.personalityName)}**.`;
    if (stats.lockedCount > 0) {
      description += `\n\n**${stats.lockedCount}** locked (core) memories will be preserved.`;
    }
    description += '\n\n**This action cannot be undone.**';
    description += '\n\nTo confirm, you will need to type:';
    description += `\n\`${confirmPhrase}\``;

    const embed = createDangerEmbed('DANGER: Purge All Memories', description).setFooter({
      text: `${FOOTER_PREFIX}${stats.personalityName}`,
    });

    // Embed the invoker's user ID in the customId so the button/modal handlers
    // can reject cross-user clicks before any work runs (defense-in-depth on
    // top of the API's data-layer enforcement).
    const proceedButton = new ButtonBuilder()
      .setCustomId(`${MEMORY_PURGE_PREFIX}::proceed::${personalityId}::${userId}`)
      .setLabel('I Understand - Proceed')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️');

    const cancelButton = new ButtonBuilder()
      .setCustomId(`${MEMORY_PURGE_PREFIX}::cancel::${userId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    // Cancel → Danger order (design-system button rule: Danger is always last).
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(cancelButton, proceedButton);

    await context.editReply({ embeds: [embed], components: [row] });
  } catch (error) {
    logger.error({ err: error, userId }, 'Unexpected error');
    await context.editReply({
      content: renderSpec(
        // handlePurge's catch only wraps the READ phase (resolve + getStats);
        // the purge WRITE has its own error path in the handshake.
        classifyGatewayFailure(error, 'memories', { operation: 'read' })
      ),
    });
  }
}

/**
 * Handle proceed/cancel button clicks for /memory purge.
 * Routed from CommandHandler → memory's handleButton.
 *
 * The proceed branch MUST call `showModal()` as its first action — Discord
 * requires the modal to be the first response to a button interaction
 * (no `deferUpdate` first), and the 3-second budget for that response is
 * indivisible. State needed for the modal (personalityId, personalityName)
 * comes from the customId and the parent message's embed footer respectively.
 */
export async function handlePurgeButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split('::');
  // parts[0] = 'memory-purge'
  // proceed: parts[1] = 'proceed', parts[2] = personalityId, parts[3] = invokerId
  // cancel:  parts[1] = 'cancel', parts[2] = invokerId
  const action = parts[1];

  if (action === 'cancel') {
    if (!(await assertInvokerOwnership(interaction, parts[2]))) {
      return;
    }
    await interaction.update({ content: 'Purge cancelled.', embeds: [], components: [] });
    return;
  }

  if (action !== 'proceed') {
    logger.warn({ customId: interaction.customId }, 'Unknown purge button action');
    await interaction.reply({
      content: renderSpec(CATALOG.error.validation('Unknown interaction.')),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const personalityId = parts[2];
  if (personalityId === undefined || personalityId === '') {
    logger.warn({ customId: interaction.customId }, 'Purge proceed button missing personalityId');
    await interaction.reply({
      content: renderSpec(
        CATALOG.error.validation('Malformed purge button (missing character ID).')
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!(await assertInvokerOwnership(interaction, parts[3]))) {
    return;
  }

  const personalityName = readPersonalityNameFromMessage(interaction);
  if (personalityName === null) {
    logger.warn({ customId: interaction.customId }, 'Purge proceed button missing footer name');
    await interaction.reply({
      content: renderSpec(
        CATALOG.error.validation(
          'This confirmation prompt is missing required state. Please run `/memory purge` again.'
        )
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const confirmPhrase = getConfirmationPhrase(personalityName);

  const modal = new ModalBuilder()
    .setCustomId(`${MEMORY_PURGE_PREFIX}::confirm::${personalityId}::${interaction.user.id}`)
    .setTitle('Confirm Memory Purge');

  const confirmInput = new TextInputBuilder()
    .setCustomId('confirmation_phrase')
    .setLabel(`Type: ${confirmPhrase}`)
    .setPlaceholder(confirmPhrase)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(confirmPhrase.length)
    .setMaxLength(confirmPhrase.length + CONFIRMATION_PHRASE_LENGTH_BUFFER);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(confirmInput));

  // First (and only) response to the button interaction; no async work above
  // this line so the 3-second budget stays indivisible.
  await interaction.showModal(modal);
}

/**
 * Two-step purge handshake: exchange the confirmation phrase for a short-
 * lived purge token, then redeem the token to actually purge. The execute
 * call sees only the token — `personalityId` lives server-side under the
 * token key, eliminating phrase-vs-personality drift across the round trip.
 *
 * Returns the purge result on success, or null when either step failed
 * (in which case the user-facing error has already been written via
 * `interaction.editReply`).
 */
async function executePurgeHandshake(
  userClient: UserClient,
  personalityId: string,
  enteredPhrase: string,
  interaction: ModalSubmitInteraction
): Promise<PurgeMemoriesResponse | null> {
  const tokenResult = await userClient.issuePurgeToken({
    personalityId,
    confirmationPhrase: enteredPhrase,
  });

  if (!tokenResult.ok) {
    await interaction.editReply({
      content: renderSpec(
        classifyGatewayFailure(tokenResult, 'purge', { failedAction: 'confirm the purge' })
      ),
      embeds: [],
      components: [],
    });
    return null;
  }

  const purgeResult = await userClient.purge({ purgeToken: tokenResult.data.purgeToken });

  if (!purgeResult.ok) {
    await interaction.editReply({
      content: renderSpec(
        classifyGatewayFailure(purgeResult, 'memories', { failedAction: 'purge the memories' })
      ),
      embeds: [],
      components: [],
    });
    return null;
  }

  return purgeResult.data;
}

/**
 * Handle the "type the phrase" modal submission for /memory purge.
 * Routed from CommandHandler → memory's handleModal.
 */
export async function handlePurgeModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parts = interaction.customId.split('::');
  // parts[0] = 'memory-purge', parts[1] = 'confirm', parts[2] = personalityId, parts[3] = invokerId
  const personalityId = parts[2];
  if (personalityId === undefined || personalityId === '') {
    logger.warn({ customId: interaction.customId }, 'Purge modal missing personalityId');
    await interaction.reply({
      content: renderSpec(
        CATALOG.error.validation('Malformed purge modal (missing character ID).')
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!(await assertInvokerOwnership(interaction, parts[3]))) {
    return;
  }

  const personalityName = readPersonalityNameFromMessage(interaction);
  if (personalityName === null) {
    logger.warn({ customId: interaction.customId }, 'Purge modal missing footer name');
    await interaction.reply({
      content: renderSpec(
        CATALOG.error.validation('Confirmation state lost. Please run `/memory purge` again.')
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const expectedPhrase = getConfirmationPhrase(personalityName);
  const enteredPhrase = interaction.fields.getTextInputValue('confirmation_phrase').trim();

  // Case-insensitive compare matches the api-gateway's own validation —
  // a user typing 'delete lilith memories' lowercase shouldn't fail at
  // the client gate when the server would have accepted it.
  if (enteredPhrase.toUpperCase() !== expectedPhrase.toUpperCase()) {
    await interaction.reply({
      content: `Purge cancelled - confirmation phrase did not match.\n\nYou entered: \`${enteredPhrase}\`\nExpected: \`${expectedPhrase}\``,
      flags: MessageFlags.Ephemeral,
    });
    if (interaction.message !== null) {
      // Best-effort cleanup. If the parent message was deleted, perms changed,
      // or the bot was restarted between modal-submit and now, the edit can
      // throw — but the user already saw the ephemeral mismatch reply, so the
      // failure isn't user-visible and shouldn't crash the handler.
      try {
        await interaction.message.edit({
          content: 'Purge cancelled - confirmation phrase did not match.',
          embeds: [],
          components: [],
        });
      } catch (err) {
        logger.warn({ err, customId: interaction.customId }, 'Failed to clear purge warning');
      }
    }
    return;
  }

  // Phrase validated. Ack the modal, clear the warning, then perform the purge.
  // `update()` is only available on modal submits that originated from a
  // message component — for our flow that's always true (the modal is shown
  // by the proceed button), but we narrow to satisfy the type checker.
  if (!interaction.isFromMessage()) {
    logger.warn({ customId: interaction.customId }, 'Purge modal submitted without parent message');
    // eslint-disable-next-line @tzurot/component-handler-ack-first -- Branch-leak FP: on the phrase-matched path that reaches here, no real async precedes this ack (assertInvokerOwnership is exempt; the rest is sync). The rule's source-order sawRealAsync leaked from the phrase-MISMATCH branch's interaction.message.edit above, which returns before this point.
    await interaction.reply({
      content: renderSpec(CATALOG.error.validation('Internal error: malformed modal context.')),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // eslint-disable-next-line @tzurot/component-handler-ack-first -- Branch-leak FP: this is the ack-first update() for the phrase-matched path (executePurgeHandshake runs after it). sawRealAsync leaked from the phrase-mismatch branch's message.edit above (which returns).
  await interaction.update({
    content: 'Purging memories…',
    embeds: [],
    components: [],
  });

  const { userClient } = clientsFor(interaction);
  const purgeResult = await executePurgeHandshake(
    userClient,
    personalityId,
    enteredPhrase,
    interaction
  );
  if (purgeResult === null) {
    return;
  }

  const result = purgeResult;
  let successDescription = `Purged **${result.deletedCount}** memories for **${escapeMarkdown(result.personalityName)}**.`;
  if (result.lockedPreserved > 0) {
    successDescription += `\n\n**${result.lockedPreserved}** locked (core) memories were preserved.`;
  }

  await interaction.editReply({
    content: '',
    embeds: [createSuccessEmbed('Memories Purged', successDescription)],
    components: [],
  });

  logger.warn(
    {
      userId: interaction.user.id,
      personalityId,
      deletedCount: result.deletedCount,
      lockedPreserved: result.lockedPreserved,
    },
    'PURGE completed'
  );
}
