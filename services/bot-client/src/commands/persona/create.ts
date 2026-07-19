/**
 * Persona Create Handler
 *
 * Allows users to create new named personas via a Discord modal.
 * Each persona can have:
 * - Name (required) - identifier for the persona
 * - Preferred Name - what AI should call the user
 * - Pronouns
 * - Content/description - what AI should know about this persona
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import { MessageFlags, type ModalBuilder, type ModalSubmitInteraction } from 'discord.js';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ModalCommandContext } from '../../utils/commandContext/types.js';
import { buildPersonaModalFields } from './utils/modalBuilder.js';
import { buildToolkitModal } from '../../utils/modal/toolkit.js';
import { replyWithModalRetry } from '../../utils/modal/retry.js';
import { PersonaCustomIds } from '../../utils/customIds.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

const logger = createLogger('persona-create');

/** Create modal builder — shared by create and the retry affordance. */
export function buildPersonaCreateModal(initialValues?: Record<string, string>): ModalBuilder {
  return buildToolkitModal({
    customId: PersonaCustomIds.create(),
    title: 'Create New Persona',
    items: buildPersonaModalFields(null, {
      namePlaceholder: 'e.g., Work Mode, Casual, Creative Writing',
      contentPlaceholder: 'Describe this persona: context, interests, how AI should interact...',
    }),
    initialValues,
  });
}

/**
 * Handle /persona create command - shows modal
 */
export async function handleCreatePersona(context: ModalCommandContext): Promise<void> {
  try {
    await context.showModal(buildPersonaCreateModal());
    logger.info({ userId: context.user.id }, 'Showed create modal');
  } catch (error) {
    logger.error({ err: error, userId: context.user.id }, 'Failed to show create modal');
    await context.reply({
      content: renderSpec(CATALOG.error.operationFailed('open the create dialog')),
      flags: MessageFlags.Ephemeral,
    });
  }
}

/** Validation-failure reply + prefill stash (shared D15 helper). */
async function replyWithRetry(
  interaction: ModalSubmitInteraction,
  content: string,
  values: Record<string, string>
): Promise<void> {
  await replyWithModalRetry(interaction, {
    commandPrefix: 'persona',
    kind: 'create',
    content,
    values,
  });
}

/**
 * Handle modal submission for persona creation
 */
export async function handleCreateModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const discordId = interaction.user.id;

  // Ack first (3-second rule): deferReply BEFORE the try — per the codebase
  // convention — so a failure of the ack itself propagates to CommandHandler
  // (which branches on replied/deferred) rather than into the catch below, which
  // assumes the interaction is already acked. Ephemeral: the create result is a
  // private confirmation. Everything inside the try is post-defer → editReply.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Raw (untrimmed) values, captured up front so every failure path can
  // stash them for the Try-again prefill.
  const values = {
    personaName: interaction.fields.getTextInputValue('personaName'),
    description: interaction.fields.getTextInputValue('description'),
    preferredName: interaction.fields.getTextInputValue('preferredName'),
    pronouns: interaction.fields.getTextInputValue('pronouns'),
    content: interaction.fields.getTextInputValue('content'),
  };

  try {
    const personaName = values.personaName.trim();
    const description = values.description.trim() || null;
    const preferredName = values.preferredName.trim() || null;
    const pronouns = values.pronouns.trim() || null;
    // Modal sets `required: true` on content, so Discord guarantees a
    // non-empty value here. Whitespace-only edge cases fall through to the
    // gateway's PersonaCreateSchema.content.min(1) validator.
    const content = values.content.trim();

    // Persona name is required
    if (personaName.length === 0) {
      await replyWithRetry(
        interaction,
        renderSpec(CATALOG.error.validation('Persona name is required.')),
        values
      );
      return;
    }

    const { userClient } = clientsFor(interaction);
    const result = await userClient.createPersona({
      name: personaName,
      description,
      preferredName,
      pronouns,
      content,
    });

    if (!result.ok) {
      if (result.code === API_ERROR_SUBCODE.NAME_COLLISION) {
        await replyWithRetry(
          interaction,
          renderSpec(
            CATALOG.error.validation(
              `You already have a persona named "${personaName}". Pick a different name, or edit the existing one with \`/persona edit\`.`
            )
          ),
          values
        );
        return;
      }
      logger.warn(
        { userId: discordId, error: result.error },
        'Failed to create persona via gateway'
      );
      // Transient failures also lose typed input through no fault of the
      // user's — carry the retry affordance. A resubmit either succeeds or
      // lands on the NAME_COLLISION path, so a blind retry is write-safe.
      await replyWithRetry(
        interaction,
        renderSpec(
          classifyGatewayFailure(result, 'persona', { failedAction: 'create the persona' })
        ),
        values
      );
      return;
    }

    const { persona } = result.data;

    logger.info({ userId: discordId, personaId: persona.id, personaName }, 'Created new persona');

    // Build response
    const details: string[] = [];
    if (persona.description !== null) {
      details.push(`📋 Description: ${persona.description}`);
    }
    if (persona.preferredName !== null) {
      details.push(`📛 Name: ${persona.preferredName}`);
    }
    if (persona.pronouns !== null) {
      details.push(`🏷️ Pronouns: ${persona.pronouns}`);
    }
    if (persona.content !== null && persona.content.length > 0) {
      details.push(
        `📝 Content: ${persona.content.substring(0, 100)}${persona.content.length > 100 ? '...' : ''}`
      );
    }

    let response = `✅ **Persona "${personaName}" created!**`;
    if (details.length > 0) {
      response += `\n\n${details.join('\n')}`;
    }
    response += '\n\nUse `/persona browse` to see all your personas.';

    await interaction.editReply({ content: response });
  } catch (error) {
    logger.error({ err: error, userId: discordId }, 'Failed to create persona');
    // Post-defer: deferReply ran (and succeeded) before the try, so the
    // interaction is acked by the time any error reaches here. Retry rides
    // along — see the !result.ok fallthrough above for the write-safety note.
    await replyWithRetry(
      interaction,
      renderSpec(classifyGatewayFailure(error, 'persona', { failedAction: 'create the persona' })),
      values
    );
  }
}
