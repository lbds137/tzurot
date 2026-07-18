/**
 * Purge Handler
 * Handles /memory purge command - delete ALL memories for a character.
 * Requires typed confirmation via the shared Tier-B destructive flow
 * (utils/confirmation/confirmDestructive.ts): warning + Cancel/Proceed →
 * typed-phrase modal → token handshake → purge.
 *
 * Routing model (per `.claude/rules/04-discord.md` "Component Interaction
 * Routing"): the slash command renders the warning and returns; button +
 * modal interactions route via CommandHandler → memory's component router →
 * the exports below. State is restart-safe: personalityId rides the
 * destructive customId's entity segment, and the personality display name
 * (needed for the gateway-validated dynamic phrase) rides the warning
 * embed's footer.
 */

import { escapeMarkdown, type ButtonInteraction, type ModalSubmitInteraction } from 'discord.js';
import { memoryPurgeOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type UserClient } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { createSuccessEmbed } from '../../utils/commandHelpers.js';
import { resolveRequiredPersonality } from './resolveHelpers.js';
import {
  buildDestructiveWarning,
  handleDestructiveCancel,
  handleDestructiveConfirmButton,
  handleDestructiveModalSubmit,
  hardDeleteModalDisplay,
  replyValidationError,
  type DestructiveModalDisplay,
  type DestructiveOperationResult,
} from '../../utils/confirmation/confirmDestructive.js';
import { DestructiveCustomIds } from '../../utils/customIds.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

const logger = createLogger('memory-purge');

/** Destructive-customId operation segment for /memory purge. */
export const MEMORY_PURGE_OPERATION = 'purge';

/** Footer marker that encodes the character display name on the warning embed. */
const FOOTER_PREFIX = 'Character: ';

/**
 * Build the confirmation phrase the user must type. The GATEWAY validates
 * this exact form server-side (issuePurgeToken) — a wire contract; never
 * derive it any other way.
 */
function getConfirmationPhrase(personalityName: string): string {
  return `DELETE ${personalityName.toUpperCase()} MEMORIES`;
}

/** Modal display for the purge flow — phrase is the wire-contract override. */
function purgeModalDisplay(personalityName: string): DestructiveModalDisplay {
  return hardDeleteModalDisplay(personalityName, getConfirmationPhrase(personalityName));
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

    const warning = buildDestructiveWarning({
      source: 'memory',
      operation: MEMORY_PURGE_OPERATION,
      entityId: personalityId,
      warningTitle: 'DANGER: Purge All Memories',
      warningDescription: description,
      footerText: `${FOOTER_PREFIX}${stats.personalityName}`,
      buttonLabel: 'I Understand - Proceed',
      ...purgeModalDisplay(stats.personalityName),
    });

    await context.editReply(warning);
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
 * Handle proceed/cancel button clicks for /memory purge, routed from the
 * memory component router's destructive branch. Invoker ownership, modal
 * derivation, and ack discipline are owned by the Tier-B factory.
 */
export async function handlePurgeButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = DestructiveCustomIds.parse(interaction.customId);
  if (parsed === null) {
    await replyValidationError(interaction, 'Malformed purge interaction.');
    return;
  }

  if (parsed.action === 'cancel_button') {
    await handleDestructiveCancel(interaction, 'Purge cancelled.');
    return;
  }

  if (parsed.action !== 'confirm_button') {
    logger.warn({ customId: interaction.customId }, 'Unknown purge button action');
    await replyValidationError(interaction, 'Unknown interaction.');
    return;
  }

  if (parsed.entityId === undefined || parsed.entityId === '') {
    logger.warn({ customId: interaction.customId }, 'Purge proceed button missing personalityId');
    await replyValidationError(interaction, 'Malformed purge button (missing character ID).');
    return;
  }

  const personalityName = readPersonalityNameFromMessage(interaction);
  if (personalityName === null) {
    logger.warn({ customId: interaction.customId }, 'Purge proceed button missing footer name');
    await replyValidationError(
      interaction,
      'This confirmation prompt is missing required state. Please run `/memory purge` again.'
    );
    return;
  }

  await handleDestructiveConfirmButton(interaction, purgeModalDisplay(personalityName));
}

/**
 * Two-step purge handshake: exchange the confirmation phrase for a short-
 * lived purge token, then redeem the token to actually purge. The execute
 * call sees only the token — `personalityId` lives server-side under the
 * token key, eliminating phrase-vs-personality drift across the round trip.
 */
async function executePurgeHandshake(
  userClient: UserClient,
  userId: string,
  personalityId: string,
  enteredPhrase: string
): Promise<DestructiveOperationResult> {
  const tokenResult = await userClient.issuePurgeToken({
    personalityId,
    confirmationPhrase: enteredPhrase,
  });

  if (!tokenResult.ok) {
    return {
      success: false,
      errorMessage: renderSpec(
        classifyGatewayFailure(tokenResult, 'purge', { failedAction: 'confirm the purge' })
      ),
    };
  }

  const purgeResult = await userClient.purge({ purgeToken: tokenResult.data.purgeToken });

  if (!purgeResult.ok) {
    return {
      success: false,
      errorMessage: renderSpec(
        classifyGatewayFailure(purgeResult, 'memories', { failedAction: 'purge the memories' })
      ),
    };
  }

  const result = purgeResult.data;
  let successDescription = `Purged **${result.deletedCount}** memories for **${escapeMarkdown(result.personalityName)}**.`;
  if (result.lockedPreserved > 0) {
    successDescription += `\n\n**${result.lockedPreserved}** locked (core) memories were preserved.`;
  }

  logger.warn(
    {
      userId,
      personalityId,
      deletedCount: result.deletedCount,
      lockedPreserved: result.lockedPreserved,
    },
    'PURGE completed'
  );

  return {
    success: true,
    successEmbed: createSuccessEmbed('Memories Purged', successDescription),
  };
}

/**
 * Handle the "type the phrase" modal submission for /memory purge, routed
 * from the memory component router's destructive branch.
 */
export async function handlePurgeModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parsed = DestructiveCustomIds.parse(interaction.customId);
  const personalityId = parsed?.entityId;
  if (personalityId === undefined || personalityId === '') {
    logger.warn({ customId: interaction.customId }, 'Purge modal missing personalityId');
    await replyValidationError(interaction, 'Malformed purge modal (missing character ID).');
    return;
  }

  const personalityName = readPersonalityNameFromMessage(interaction);
  if (personalityName === null) {
    logger.warn({ customId: interaction.customId }, 'Purge modal missing footer name');
    await replyValidationError(
      interaction,
      'Confirmation state lost. Please run `/memory purge` again.'
    );
    return;
  }

  const expectedPhrase = getConfirmationPhrase(personalityName);
  const { userClient } = clientsFor(interaction);

  await handleDestructiveModalSubmit(
    interaction,
    expectedPhrase,
    enteredPhrase =>
      executePurgeHandshake(userClient, interaction.user.id, personalityId, enteredPhrase),
    { progressContent: 'Purging memories…' }
  );
}
