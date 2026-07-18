/**
 * /settings data delete — full-account erasure (data-rights).
 *
 * Uses the shared Tier-B destructive flow
 * (utils/confirmation/confirmDestructive.ts): warning embed with the
 * deletion impact → Cancel/Proceed buttons → typed-phrase modal → token
 * handshake → synchronous erasure. Routing goes through CommandHandler via
 * settings' handleButton/handleModal destructive branch (no collectors).
 * The deletion target is always the invoker's own account, so no entity
 * state needs to survive the round trip.
 */

import { escapeMarkdown, type ButtonInteraction, type ModalSubmitInteraction } from 'discord.js';
import { ACCOUNT_DELETE_CONFIRMATION_PHRASE } from '@tzurot/common-types/schemas/api/account';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type UserClient } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { createSuccessEmbed } from '../../../utils/commandHelpers.js';
import {
  buildDestructiveWarning,
  handleDestructiveCancel,
  handleDestructiveConfirmButton,
  handleDestructiveModalSubmit,
  hardDeleteModalDisplay,
  replyValidationError,
  type DestructiveModalDisplay,
  type DestructiveOperationResult,
} from '../../../utils/confirmation/confirmDestructive.js';
import { DestructiveCustomIds } from '../../../utils/customIds.js';
import { CATALOG } from '../../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../../ux/catalog/classify.js';
import { renderSpec } from '../../../ux/render/render.js';

const logger = createLogger('settings-data-delete');

/** Destructive-customId operation segment for /settings data delete. */
export const SETTINGS_ACCOUNT_DELETE_OPERATION = 'account-delete';

/** Cap the per-character warning list so the embed stays under limits. */
const MAX_LISTED_CHARACTERS = 12;

/**
 * Modal display for the account-delete flow — the phrase is the gateway-
 * validated wire contract, passed as an explicit override.
 */
function accountDeleteModalDisplay(): DestructiveModalDisplay {
  return hardDeleteModalDisplay('your account', ACCOUNT_DELETE_CONFIRMATION_PHRASE);
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

    const warning = buildDestructiveWarning({
      source: 'settings',
      operation: SETTINGS_ACCOUNT_DELETE_OPERATION,
      warningTitle: 'DANGER: Delete Your Account',
      warningDescription: buildWarningDescription(previewResult.data),
      buttonLabel: 'I Understand - Proceed',
      ...accountDeleteModalDisplay(),
    });
    await context.editReply(warning);
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
 * Handle proceed/cancel button clicks, routed from settings' destructive
 * branch. Invoker ownership, modal derivation, and ack discipline are owned
 * by the Tier-B factory.
 */
export async function handleDataDeleteButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = DestructiveCustomIds.parse(interaction.customId);
  if (parsed === null) {
    await replyValidationError(interaction, 'Malformed deletion interaction.');
    return;
  }

  if (parsed.action === 'cancel_button') {
    await handleDestructiveCancel(interaction, 'Deletion cancelled.');
    return;
  }

  if (parsed.action !== 'confirm_button') {
    logger.warn({ customId: interaction.customId }, 'Unknown delete button action');
    await replyValidationError(interaction, 'Unknown interaction.');
    return;
  }

  await handleDestructiveConfirmButton(interaction, accountDeleteModalDisplay());
}

/**
 * Two-step deletion handshake: exchange the typed phrase for a single-use
 * token, then redeem the token to erase the account.
 */
async function executeDeleteHandshake(
  userClient: UserClient,
  userId: string,
  enteredPhrase: string
): Promise<DestructiveOperationResult> {
  const tokenResult = await userClient.issueAccountDeleteToken({
    confirmationPhrase: enteredPhrase,
  });
  if (!tokenResult.ok) {
    return {
      success: false,
      errorMessage: renderSpec(
        classifyGatewayFailure(tokenResult, 'account deletion', {
          failedAction: 'confirm the deletion',
        })
      ),
    };
  }

  const deleteResult = await userClient.deleteAccount({
    deleteToken: tokenResult.data.deleteToken,
  });
  if (!deleteResult.ok) {
    return {
      success: false,
      errorMessage: renderSpec(
        classifyGatewayFailure(deleteResult, 'account', { failedAction: 'delete the account' })
      ),
    };
  }

  const summary = deleteResult.data.summary;
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

  logger.warn({ userId }, 'ACCOUNT DELETION completed via command');

  return {
    success: true,
    successEmbed: createSuccessEmbed('Account Deleted', description),
  };
}

/** Handle the typed-phrase modal submission, routed from settings' destructive branch. */
export async function handleDataDeleteModal(interaction: ModalSubmitInteraction): Promise<void> {
  const { userClient } = clientsFor(interaction);

  await handleDestructiveModalSubmit(
    interaction,
    ACCOUNT_DELETE_CONFIRMATION_PHRASE,
    enteredPhrase => executeDeleteHandshake(userClient, interaction.user.id, enteredPhrase),
    { progressContent: 'Deleting your account…' }
  );
}
