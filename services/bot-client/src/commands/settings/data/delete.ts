/**
 * /settings data delete — full-account erasure (data-rights).
 *
 * Purge-pattern confirmation flow (mirrors /memory purge): warning embed
 * with the deletion impact → Proceed/Cancel buttons → typed-phrase modal →
 * token handshake → synchronous erasure. Routing goes through
 * CommandHandler via settings' handleButton/handleModal (no collectors).
 *
 * State is encoded in custom IDs (invoker id only — the deletion target is
 * always the invoker's own account, so no other state needs to survive the
 * round trip).
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
import { ACCOUNT_DELETE_CONFIRMATION_PHRASE } from '@tzurot/common-types/schemas/api/account';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type UserClient } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { createDangerEmbed, createSuccessEmbed } from '../../../utils/commandHelpers.js';
import { CATALOG } from '../../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../../ux/catalog/classify.js';
import { renderSpec } from '../../../ux/render/render.js';

const logger = createLogger('settings-data-delete');

/** Registered in settings/index.ts componentPrefixes. */
export const SETTINGS_DATA_DELETE_PREFIX = 'settings-data-delete';

/** Buffer for confirmation phrase input to allow minor whitespace. */
const CONFIRMATION_PHRASE_LENGTH_BUFFER = 5;

/** Cap the per-character warning list so the embed stays under limits. */
const MAX_LISTED_CHARACTERS = 12;

export function isDataDeleteInteraction(customId: string): boolean {
  return customId.startsWith(`${SETTINGS_DATA_DELETE_PREFIX}::`);
}

/** Same invoker-assert shape as memory purge: reject other users' clicks. */
async function assertInvokerOwnership(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  invokerIdFromCustomId: string | undefined
): Promise<boolean> {
  if (invokerIdFromCustomId === undefined || invokerIdFromCustomId === '') {
    logger.warn({ customId: interaction.customId }, 'Delete interaction missing invoker ID');
    await interaction.reply({
      content: renderSpec(
        CATALOG.error.validation('Malformed deletion interaction (missing invoker ID).')
      ),
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  if (interaction.user.id !== invokerIdFromCustomId) {
    await interaction.reply({
      content: renderSpec(
        CATALOG.error.permissionDenied(
          'confirm or cancel this deletion — only the original command invoker can'
        )
      ),
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}

function characterImpactLines(
  ownedCharacters: { name: string; otherUsersWithMemories: number }[]
): string[] {
  const listed = ownedCharacters.slice(0, MAX_LISTED_CHARACTERS).map(character => {
    const reach =
      character.otherUsersWithMemories > 0
        ? ` — **${character.otherUsersWithMemories}** other user(s) have memories with them`
        : '';
    return `- **${escapeMarkdown(character.name)}**${reach}`;
  });
  if (ownedCharacters.length > MAX_LISTED_CHARACTERS) {
    listed.push(`- …and ${ownedCharacters.length - MAX_LISTED_CHARACTERS} more`);
  }
  return listed;
}

function buildWarningDescription(preview: {
  ownedCharacters: { name: string; otherUsersWithMemories: number }[];
  counts: {
    personas: number;
    characters: number;
    conversationMessages: number;
    memories: number;
    facts: number;
  };
  hasActiveExport: boolean;
}): string {
  const { counts } = preview;
  const lines = [
    'You are about to **permanently delete your entire account**:',
    '',
    `- **${counts.personas}** persona(s)`,
    `- **${counts.characters}** owned character(s)`,
    `- **${counts.conversationMessages}** conversation message(s)`,
    `- **${counts.memories}** memories and **${counts.facts}** facts`,
    '- All settings, configs, API-key registrations, and feedback',
  ];

  if (preview.ownedCharacters.length > 0) {
    lines.push(
      '',
      '⚠️ **Your owned characters are deleted for EVERYONE**, along with every',
      "other user's memories of them:",
      ...characterImpactLines(preview.ownedCharacters)
    );
  }

  lines.push(
    '',
    '💾 Consider `/settings data export` first — **export downloads stop',
    'working the moment your account is deleted.**'
  );
  if (preview.hasActiveExport) {
    lines.push('⏳ You have an export currently running; deleting now will kill it.');
  }

  lines.push(
    '',
    '**This action cannot be undone.**',
    '',
    'To confirm, you will need to type:',
    `\`${ACCOUNT_DELETE_CONFIRMATION_PHRASE}\``
  );
  return lines.join('\n');
}

/**
 * Handle /settings data delete — show the impact warning + buttons, then
 * return. Button + modal handling continues via handleDataDeleteButton /
 * handleDataDeleteModal.
 */
export async function handleDataDelete(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const { userClient } = clientsFor(context.interaction);

  try {
    const previewResult = await userClient.previewAccountDelete();
    if (!previewResult.ok) {
      await context.editReply({
        content:
          previewResult.status === 403
            ? renderSpec(
                CATALOG.error.permissionDenied(
                  'delete this account — it is the bot-owner (superuser) account'
                )
              )
            : renderSpec(
                classifyGatewayFailure(previewResult, 'account deletion preview', {
                  operation: 'read',
                })
              ),
      });
      return;
    }

    const embed = createDangerEmbed(
      'DANGER: Delete Your Account',
      buildWarningDescription(previewResult.data)
    );

    const proceedButton = new ButtonBuilder()
      .setCustomId(`${SETTINGS_DATA_DELETE_PREFIX}::proceed::${userId}`)
      .setLabel('I Understand - Proceed')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️');

    const cancelButton = new ButtonBuilder()
      .setCustomId(`${SETTINGS_DATA_DELETE_PREFIX}::cancel::${userId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    // Cancel → Danger order (design-system button rule: Danger is always last).
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(cancelButton, proceedButton);
    await context.editReply({ embeds: [embed], components: [row] });
  } catch (error) {
    logger.error({ err: error, userId }, 'Unexpected error building deletion preview');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'account deletion preview', { operation: 'read' })
      ),
    });
  }
}

/**
 * Handle proceed/cancel button clicks. The proceed branch MUST call
 * `showModal()` as its first response (no deferUpdate first) — same
 * constraint as memory purge.
 */
export async function handleDataDeleteButton(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split('::');
  // parts[0] = 'settings-data-delete', parts[1] = action, parts[2] = invokerId
  const action = parts[1];

  if (action === 'cancel') {
    if (!(await assertInvokerOwnership(interaction, parts[2]))) {
      return;
    }
    await interaction.update({ content: 'Deletion cancelled.', embeds: [], components: [] });
    return;
  }

  if (action !== 'proceed') {
    logger.warn({ customId: interaction.customId }, 'Unknown delete button action');
    await interaction.reply({
      content: renderSpec(CATALOG.error.validation('Unknown interaction.')),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!(await assertInvokerOwnership(interaction, parts[2]))) {
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${SETTINGS_DATA_DELETE_PREFIX}::confirm::${interaction.user.id}`)
    .setTitle('Confirm Account Deletion');

  const confirmInput = new TextInputBuilder()
    .setCustomId('confirmation_phrase')
    .setLabel(`Type: ${ACCOUNT_DELETE_CONFIRMATION_PHRASE}`)
    .setPlaceholder(ACCOUNT_DELETE_CONFIRMATION_PHRASE)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(ACCOUNT_DELETE_CONFIRMATION_PHRASE.length)
    .setMaxLength(ACCOUNT_DELETE_CONFIRMATION_PHRASE.length + CONFIRMATION_PHRASE_LENGTH_BUFFER);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(confirmInput));

  // First (and only) response to the button interaction; no async work above
  // this line so the 3-second budget stays indivisible.
  await interaction.showModal(modal);
}

/**
 * Two-step deletion handshake: exchange the typed phrase for a single-use
 * token, then redeem the token to erase the account. Returns the summary on
 * success, or null when either step failed (user-facing error already sent).
 */
async function executeDeleteHandshake(
  userClient: UserClient,
  enteredPhrase: string,
  interaction: ModalSubmitInteraction
): Promise<{
  personas: number;
  characters: number;
  conversationMessages: number;
  memories: number;
  facts: number;
  characterNames: string[];
} | null> {
  const tokenResult = await userClient.issueAccountDeleteToken({
    confirmationPhrase: enteredPhrase,
  });
  if (!tokenResult.ok) {
    await interaction.editReply({
      content: renderSpec(
        classifyGatewayFailure(tokenResult, 'account deletion', {
          failedAction: 'confirm the deletion',
        })
      ),
      embeds: [],
      components: [],
    });
    return null;
  }

  const deleteResult = await userClient.deleteAccount({
    deleteToken: tokenResult.data.deleteToken,
  });
  if (!deleteResult.ok) {
    await interaction.editReply({
      content: renderSpec(
        classifyGatewayFailure(deleteResult, 'account', { failedAction: 'delete the account' })
      ),
      embeds: [],
      components: [],
    });
    return null;
  }

  return deleteResult.data.summary;
}

/** Handle the typed-phrase modal submission. */
export async function handleDataDeleteModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parts = interaction.customId.split('::');
  // parts[0] = 'settings-data-delete', parts[1] = 'confirm', parts[2] = invokerId
  if (!(await assertInvokerOwnership(interaction, parts[2]))) {
    return;
  }

  const enteredPhrase = interaction.fields.getTextInputValue('confirmation_phrase').trim();

  // Case-insensitive compare matches the api-gateway's own validation.
  if (enteredPhrase.toUpperCase() !== ACCOUNT_DELETE_CONFIRMATION_PHRASE) {
    await interaction.reply({
      content:
        `Deletion cancelled - confirmation phrase did not match.\n\n` +
        `You entered: \`${enteredPhrase}\`\nExpected: \`${ACCOUNT_DELETE_CONFIRMATION_PHRASE}\``,
      flags: MessageFlags.Ephemeral,
    });
    if (interaction.message !== null) {
      // Best-effort cleanup; the ephemeral mismatch reply above already
      // reached the user, so a failed edit here must not crash the handler.
      try {
        await interaction.message.edit({
          content: 'Deletion cancelled - confirmation phrase did not match.',
          embeds: [],
          components: [],
        });
      } catch (err) {
        logger.warn({ err, customId: interaction.customId }, 'Failed to clear delete warning');
      }
    }
    return;
  }

  // Phrase validated. Ack the modal, clear the warning, then delete.
  if (!interaction.isFromMessage()) {
    logger.warn({ customId: interaction.customId }, 'Delete modal submitted without parent');
    // eslint-disable-next-line @tzurot/component-handler-ack-first -- Branch-leak FP: on the phrase-matched path no real async precedes this ack (assertInvokerOwnership is exempt); sawRealAsync leaked from the mismatch branch's message.edit above, which returns before this point.
    await interaction.reply({
      content: renderSpec(CATALOG.error.validation('Internal error: malformed modal context.')),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // eslint-disable-next-line @tzurot/component-handler-ack-first -- Branch-leak FP: this IS the ack-first update() for the phrase-matched path (the handshake runs after it); sawRealAsync leaked from the mismatch branch's message.edit, which returns.
  await interaction.update({
    content: 'Deleting your account…',
    embeds: [],
    components: [],
  });

  const { userClient } = clientsFor(interaction);
  const summary = await executeDeleteHandshake(userClient, enteredPhrase, interaction);
  if (summary === null) {
    return;
  }

  const description = [
    'Your account and all associated data have been deleted:',
    '',
    `- **${summary.personas}** persona(s)`,
    `- **${summary.characters}** character(s)${
      summary.characterNames.length > 0
        ? ` (${summary.characterNames
            .slice(0, MAX_LISTED_CHARACTERS)
            .map(name => escapeMarkdown(name))
            .join(', ')}${summary.characterNames.length > MAX_LISTED_CHARACTERS ? ', …' : ''})`
        : ''
    }`,
    `- **${summary.conversationMessages}** conversation message(s)`,
    `- **${summary.memories}** memories and **${summary.facts}** facts`,
    '',
    'If you message the bot again, a fresh empty account is created automatically.',
  ].join('\n');

  await interaction.editReply({
    content: '',
    embeds: [createSuccessEmbed('Account Deleted', description)],
    components: [],
  });

  logger.warn({ userId: interaction.user.id }, 'ACCOUNT DELETION completed via command');
}
