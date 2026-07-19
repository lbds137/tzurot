/**
 * Persona Override Set Handler
 *
 * Allows users to set different personas for specific characters.
 * This enables per-character customization while keeping a default persona.
 *
 * Flow:
 * - /persona override set <personality> <persona> - Set existing persona or create new
 * - If user selects "Create new persona..." option, shows a modal
 * - Otherwise, directly assigns the selected persona
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import {
  escapeMarkdown,
  MessageFlags,
  type ModalBuilder,
  type ModalSubmitInteraction,
} from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';
import { personaOverrideSetOptions } from '@tzurot/common-types/generated/commandOptions';
import { truncateText } from '@tzurot/common-types/utils/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ModalCommandContext } from '../../../utils/commandContext/types.js';
import { CREATE_NEW_PERSONA_VALUE } from '../autocomplete.js';
import { buildPersonaModalFields } from '../utils/modalBuilder.js';
import { buildToolkitModal } from '../../../utils/modal/toolkit.js';
import { replyWithModalRetry } from '../../../utils/modal/retry.js';
import { PersonaCustomIds } from '../../../utils/customIds.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../../utils/apiCheck.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { showModalWithTimeoutCatch } from '../../../utils/dashboard/showModalWithTimeoutCatch.js';
import { ackWithTimeoutCatch } from '../../../utils/dashboard/ackWithTimeoutCatch.js';
import { CATALOG } from '../../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../../ux/catalog/classify.js';
import { renderSpec } from '../../../ux/render/render.js';

const logger = createLogger('persona-override-set');

/** Map API error to user-friendly message, or null if no specific mapping */
function mapOverrideError(error: string | undefined, personalitySlug: string): string | null {
  if (error === undefined) {
    return null;
  }
  // Check specific errors first before generic 'not found'
  if (error.includes('Persona not found')) {
    return renderSpec(
      CATALOG.error.notFound('Persona', { hint: 'Use `/persona browse` to see your personas.' })
    );
  }
  if (error.includes('Personality not found') || error.includes('personality not found')) {
    return renderSpec(
      CATALOG.error.notFound('Character', { name: escapeMarkdown(personalitySlug) })
    );
  }
  if (error.includes('no account') || error.includes('User not found')) {
    return renderSpec(
      CATALOG.error.validation(
        "You don't have an account yet. Send a message to any character to create one!"
      )
    );
  }
  return null;
}

/**
 * Build the create-for-override modal. `personalityName === null` is the
 * retry-rebuild path: the submit handler only has the personality UUID (from
 * the modal customId), so the reopen uses the default labels and a generic
 * title — the preserved field values are the affordance's point, and filled
 * fields never show their placeholders anyway.
 */
export function buildOverrideCreateModal(
  personalityId: string,
  personalityName: string | null,
  initialValues?: Record<string, string>
): ModalBuilder {
  return buildToolkitModal({
    customId: PersonaCustomIds.overrideCreate(personalityId),
    title:
      personalityName === null
        ? 'New Persona (Override)'
        : `New Persona for ${truncateText(personalityName, DISCORD_LIMITS.MODAL_TITLE_DYNAMIC_CONTENT)}`,
    items:
      personalityName === null
        ? buildPersonaModalFields(null)
        : buildPersonaModalFields(null, {
            namePlaceholder: `e.g., "My ${personalityName} Persona"`,
            preferredNameLabel: `Preferred Name (what ${personalityName} calls you)`,
            preferredNamePlaceholder: `What should ${personalityName} call you?`,
            contentLabel: `About You (for ${personalityName})`,
            contentPlaceholder: `Tell ${personalityName} specific things about yourself...`,
          }),
    initialValues,
  });
}

/** Show modal to create a new persona for override */
async function showCreateOverrideModal(
  context: ModalCommandContext,
  discordId: string,
  personalitySlug: string
): Promise<void> {
  const { userClient } = clientsFor(context.interaction);
  const infoResult = await userClient.getPersonaOverride(personalitySlug);

  if (!infoResult.ok) {
    const errorMsg = mapOverrideError(infoResult.error, personalitySlug);
    const content =
      errorMsg ?? renderSpec(CATALOG.error.operationFailed('prepare persona creation'));
    // getPersonaOverride already ate into the budget before this ack — same
    // 10062 risk as the showModal success path below, so wrap it too.
    await ackWithTimeoutCatch(
      context.interaction,
      () => context.reply({ content, flags: MessageFlags.Ephemeral }),
      {
        source: 'handleOverrideSet/showCreateOverrideModal',
        userId: discordId,
        entityId: personalitySlug,
        sectionId: 'override-create-error',
      },
      content
    );
    return;
  }

  const { personality } = infoResult.data;
  const personalityName = personality.displayName ?? personality.name;

  const modal = buildOverrideCreateModal(personality.id, personalityName);

  // The getPersonaOverride fetch above already ate into the 3-second budget, and
  // this modal can't ack-first — its customId needs the fetched personality UUID.
  // Wrap showModal so a budget-blown 10062 degrades to a followUp instead of a
  // silent "Interaction Failed".
  await showModalWithTimeoutCatch(
    context.interaction,
    modal,
    {
      source: 'handleOverrideSet/showCreateOverrideModal',
      userId: discordId,
      entityId: personality.id,
      sectionId: 'override-create',
    },
    '⏳ That took too long — please run `/persona override set` again.'
  );
  logger.info(
    { userId: discordId, personalityId: personality.id },
    'Showed create-for-override modal'
  );
}

/** Set an existing persona as override for a character */
async function setExistingOverride(
  context: ModalCommandContext,
  discordId: string,
  personalitySlug: string,
  personaId: string
): Promise<void> {
  // Ack first (3-second rule): deferReply before the setPersonaOverride gateway
  // write, so a slow write can't blow the budget before the ack. Ephemeral — a
  // private confirmation. Every response below is editReply.
  await context.deferReply({ ephemeral: true });

  const { userClient } = clientsFor(context.interaction);
  const result = await userClient.setPersonaOverride(personalitySlug, { personaId });

  if (!result.ok) {
    const errorMsg = mapOverrideError(result.error, personalitySlug);
    if (errorMsg !== null) {
      await context.interaction.editReply({ content: errorMsg });
      return;
    }
    logger.warn(
      { userId: discordId, personalitySlug, personaId, error: result.error },
      'Failed to set override'
    );
    await context.interaction.editReply({
      content: renderSpec(classifyGatewayFailure(result, 'persona override')),
    });
    return;
  }

  const { personality, persona } = result.data;
  const personalityName = personality.displayName ?? personality.name;
  const displayName = persona.preferredName ?? persona.name;

  logger.info(
    { userId: discordId, personalityId: personality.id, personaId: persona.id },
    'Set override persona'
  );

  await context.interaction.editReply({
    content: `✅ **Persona override set for ${personalityName}!**\n\n📋 Using: **${displayName}**\n\nThis persona will be used when talking to ${personalityName} instead of your default persona.`,
  });
}

/**
 * Handle /persona override set <personality> <persona> command
 */
export async function handleOverrideSet(context: ModalCommandContext): Promise<void> {
  const discordId = context.user.id;
  const options = personaOverrideSetOptions(context.interaction);
  const personalitySlug = options.character();
  const personaId = options.persona();

  if (isAutocompleteErrorSentinel(personalitySlug) || isAutocompleteErrorSentinel(personaId)) {
    await context.reply({
      content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    if (personaId === CREATE_NEW_PERSONA_VALUE) {
      await showCreateOverrideModal(context, discordId, personalitySlug);
    } else {
      await setExistingOverride(context, discordId, personalitySlug, personaId);
    }
  } catch (error) {
    logger.error({ err: error, userId: discordId }, 'Failed to set override');
    const content = renderSpec(
      classifyGatewayFailure(error, 'persona override', {
        failedAction: 'set the persona override',
      })
    );
    // setExistingOverride defers before its gateway write, so an error from that
    // branch arrives here already-acked → editReply. The showCreateOverrideModal
    // branch only throws before its showModal ack → reply.
    if (context.interaction.deferred || context.interaction.replied) {
      await context.interaction.editReply({ content });
    } else {
      await context.reply({ content, flags: MessageFlags.Ephemeral });
    }
  }
}

/**
 * Handle modal submission for creating a new persona during override
 * Modal customId format: persona::override-create::{personalityId}
 */
export async function handleOverrideCreateModalSubmit(
  interaction: ModalSubmitInteraction,
  personalityId: string
): Promise<void> {
  const discordId = interaction.user.id;

  // Ack first (3-second rule): deferReply BEFORE the try — per the codebase
  // convention — so a failure of the ack itself propagates to CommandHandler
  // (which branches on replied/deferred) rather than into the catch below, which
  // assumes the interaction is already acked. Ephemeral: the result is a private
  // confirmation. Everything inside the try is post-defer → editReply.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Raw (untrimmed) values, captured up front so retryable failure paths can
  // stash them for the Try-again prefill. The personality UUID rides in meta
  // so the rebuild can reconstruct the customId.
  const values = {
    personaName: interaction.fields.getTextInputValue('personaName'),
    description: interaction.fields.getTextInputValue('description'),
    preferredName: interaction.fields.getTextInputValue('preferredName'),
    pronouns: interaction.fields.getTextInputValue('pronouns'),
    content: interaction.fields.getTextInputValue('content'),
  };
  const replyWithRetry = async (content: string): Promise<void> => {
    await replyWithModalRetry(interaction, {
      commandPrefix: 'persona',
      kind: 'override-create',
      content,
      values,
      meta: { personalityId },
    });
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
      await replyWithRetry(renderSpec(CATALOG.error.validation('Persona name is required.')));
      return;
    }

    const { userClient } = clientsFor(interaction);
    const result = await userClient.createPersonaOverride(personalityId, {
      name: personaName,
      description,
      preferredName,
      pronouns,
      content,
    });

    if (!result.ok) {
      if (result.code === API_ERROR_SUBCODE.NAME_COLLISION) {
        await replyWithRetry(
          renderSpec(
            CATALOG.error.validation(
              `You already have a persona named "${personaName}". Pick a different name, or edit the existing one with \`/persona edit\`.`
            )
          )
        );
        return;
      }

      // Route through the shared mapper like the siblings (showCreateOverrideModal,
      // setExistingOverride) — a stale/deleted personality or a missing account
      // gets its specific message instead of degrading to the generic fallback.
      // Only the personality UUID is available here (the modal customId carries
      // the id, not the slug); it only surfaces in the rare deleted-mid-flow case.
      const mappedError = mapOverrideError(result.error, personalityId);
      if (mappedError !== null) {
        await interaction.editReply({ content: mappedError });
        return;
      }

      logger.warn(
        { userId: discordId, personalityId, error: result.error },
        'Failed to create override persona via gateway'
      );
      // Transient failures also lose typed input — carry the retry
      // affordance. A resubmit either succeeds or lands on NAME_COLLISION,
      // so a blind retry is write-safe. (The mapped errors above stay plain:
      // a deleted personality or missing account can't be retried into.)
      await replyWithRetry(
        renderSpec(
          classifyGatewayFailure(result, 'persona', { failedAction: 'create the persona' })
        )
      );
      return;
    }

    const { persona, personality } = result.data;
    const personalityName = personality.displayName ?? personality.name;

    logger.info(
      { userId: discordId, personalityId, personaId: persona.id, personaName },
      'Created new persona and set as override'
    );

    await interaction.editReply({
      content:
        `✅ **Persona "${personaName}" created and set as override for ${personalityName}!**\n\n` +
        `This persona will be used when talking to ${personalityName}.\n\n` +
        `Use \`/persona browse\` to see all your personas.`,
    });
  } catch (error) {
    logger.error(
      { err: error, userId: discordId, personalityId },
      'Failed to create override persona'
    );
    // Post-defer: deferReply ran (and succeeded) before the try, so the
    // interaction is acked by the time any error reaches here. Retry rides
    // along — see the !result.ok fallthrough above for the write-safety note.
    await replyWithRetry(
      renderSpec(classifyGatewayFailure(error, 'persona', { failedAction: 'create the persona' }))
    );
  }
}
