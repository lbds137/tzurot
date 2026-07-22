/**
 * Memory Incognito Mode Handlers
 * Handles /memory incognito enable|disable|status|forget commands
 *
 * Incognito Mode disables LTM writing without affecting retrieval.
 * Memories won't be saved, but existing memories can still be retrieved.
 *
 * This is the opposite of Fresh Mode:
 * - Fresh Mode: Disable READING (memories still saved)
 * - Incognito Mode: Disable WRITING (memories still retrieved)
 */

import { escapeMarkdown } from 'discord.js';
import {
  memoryIncognitoEnableOptions,
  memoryIncognitoDisableOptions,
  memoryIncognitoStatusOptions,
  memoryIncognitoForgetOptions,
} from '@tzurot/common-types/generated/commandOptions';
import { type MemoryModeSessionWithRemaining } from '@tzurot/common-types/schemas/api/memoryModes';
import {
  getDurationLabel,
  IncognitoForgetRequestSchema,
  type MemoryModeDuration,
} from '@tzurot/common-types/types/memory-modes';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../utils/apiCheck.js';
import type { UserClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import {
  createSuccessEmbed,
  createInfoEmbed,
  createWarningEmbed,
} from '../../utils/commandHelpers.js';
import { resolvePersonalityId, getPersonalityName } from './autocomplete.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

const logger = createLogger('memory-incognito');

/** Shared message for catch-all error logs in this module's four handlers. */
const UNEXPECTED_ERROR_LOG_MESSAGE = 'Unexpected error';
/** Shared resource noun for the incognito classify paths. */
const INCOGNITO_RESOURCE = 'incognito mode';

export const ALL_PERSONALITIES_LABEL = 'all characters';

/** Local alias for the schema-derived session-with-time-remaining shape. */
type SessionWithTime = MemoryModeSessionWithRemaining;

/**
 * Format session info for display (shared with the fresh-mode sibling)
 */
export function formatSessionInfo(session: SessionWithTime, personalityName?: string): string {
  const target =
    session.personalityId === 'all' ? ALL_PERSONALITIES_LABEL : (personalityName ?? 'Unknown');
  return `• **${escapeMarkdown(target)}** (${session.timeRemaining})`;
}

/**
 * Resolve a memory-mode `character` option (a slug/ID, or the literal "all") to
 * a target, replying with the right error and returning `null` on the failure
 * shapes. Shared by incognito enable / disable / forget and the fresh-mode
 * sibling handlers, which all accept the same
 * "or all" input. Distinguishes a genuine miss ("not found") from an infra
 * failure fetching the personality list ("try again") — collapsing both to a
 * false "not found" was the infra-vs-negative bug.
 *
 * @returns the resolved `{ id, name }` (id is a UUID or the literal `'all'`), or
 *   `null` after having ALREADY replied (sentinel / not-found / unavailable).
 *   Callers MUST return early on `null` to avoid a double Discord reply.
 */
export async function resolveMemoryModeTargetOrReply(
  context: DeferredCommandContext,
  userClient: UserClient,
  personalityInput: string
): Promise<{ id: string; name: string | null } | null> {
  if (isAutocompleteErrorSentinel(personalityInput)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return null;
  }

  if (personalityInput.toLowerCase() === 'all') {
    return { id: 'all', name: ALL_PERSONALITIES_LABEL };
  }

  const resolved = await resolvePersonalityId(userClient, personalityInput);
  switch (resolved.kind) {
    case 'found': {
      const name = await getPersonalityName(userClient, resolved.id);
      return { id: resolved.id, name };
    }
    case 'unavailable':
      // Infra failure fetching the personality list — "try again", not "not found".
      await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
      return null;
    case 'not-found':
      await context.editReply({
        content: renderSpec(
          CATALOG.error.notFound('Character', {
            name: escapeMarkdown(personalityInput),
            hint: 'Use autocomplete to select a valid character, or type "all" for all characters.',
          })
        ),
      });
      return null;
    default: {
      // Exhaustiveness guard: a new ResolvedPersonality kind fails to compile here.
      const _exhaustive: never = resolved;
      return _exhaustive;
    }
  }
}

/**
 * Handle /memory incognito enable
 */
export async function handleIncognitoEnable(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const { userClient } = clientsFor(context.interaction);
  const options = memoryIncognitoEnableOptions(context.interaction);
  const personalityInput = options.character();
  const duration = options.timeframe() as MemoryModeDuration;

  try {
    const resolved = await resolveMemoryModeTargetOrReply(context, userClient, personalityInput);
    if (resolved === null) {
      return;
    }

    const result = await userClient.enableIncognito({ personalityId: resolved.id, duration });

    if (!result.ok) {
      logger.warn({ userId, personalityInput, duration, status: result.status }, 'Enable failed');
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, INCOGNITO_RESOURCE, {
            failedAction: 'enable incognito mode',
          })
        ),
      });
      return;
    }

    const data = result.data;

    const embed = data.wasAlreadyActive
      ? createInfoEmbed(
          '👻 Incognito Already Active',
          `Incognito mode is already active for **${escapeMarkdown(resolved.name ?? personalityInput)}**.\n\n**Time remaining:** ${data.timeRemaining}\n\nDisable it first if you want to change the duration.`
        )
      : createSuccessEmbed(
          '👻 Incognito Mode Enabled',
          `Incognito mode is now **enabled** for **${escapeMarkdown(resolved.name ?? personalityInput)}** (${getDurationLabel(duration)}).\n\n**New memories will NOT be saved.** Existing memories can still be retrieved.\n\nUse \`/memory incognito disable\` to turn it off.`
        );

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, personalityId: resolved.id, duration, wasAlreadyActive: data.wasAlreadyActive },
      'Mode enabled'
    );
  } catch (error) {
    logger.error({ err: error, userId }, UNEXPECTED_ERROR_LOG_MESSAGE);
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, INCOGNITO_RESOURCE, { failedAction: 'enable incognito mode' })
      ),
    });
  }
}

/**
 * Handle /memory incognito disable
 */
export async function handleIncognitoDisable(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const { userClient } = clientsFor(context.interaction);
  const options = memoryIncognitoDisableOptions(context.interaction);
  const personalityInput = options.character();

  try {
    const resolved = await resolveMemoryModeTargetOrReply(context, userClient, personalityInput);
    if (resolved === null) {
      return;
    }

    const result = await userClient.disableIncognito({ personalityId: resolved.id });

    if (!result.ok) {
      logger.warn({ userId, personalityInput, status: result.status }, 'Disable failed');
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, INCOGNITO_RESOURCE, {
            failedAction: 'disable incognito mode',
          })
        ),
      });
      return;
    }

    const data = result.data;

    const embed = data.disabled
      ? createSuccessEmbed(
          '👻 Incognito Mode Disabled',
          `Incognito mode is now **disabled** for **${escapeMarkdown(resolved.name ?? personalityInput)}**.\n\nMemories will be saved normally during conversations.`
        )
      : createInfoEmbed(
          '👻 Incognito Not Active',
          `Incognito mode was not active for **${escapeMarkdown(resolved.name ?? personalityInput)}**.`
        );

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, personalityId: resolved.id, wasActive: data.disabled }, 'Mode disabled');
  } catch (error) {
    logger.error({ err: error, userId }, UNEXPECTED_ERROR_LOG_MESSAGE);
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, INCOGNITO_RESOURCE, {
          failedAction: 'disable incognito mode',
        })
      ),
    });
  }
}

/**
 * Handle /memory incognito status
 */
export async function handleIncognitoStatus(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const { userClient } = clientsFor(context.interaction);
  const options = memoryIncognitoStatusOptions(context.interaction);
  const characterInput = options.character();

  try {
    // Optional filter: a specific character narrows the overview to sessions
    // that apply to it (its own + any global 'all' session). "all" or omitted
    // shows everything.
    let personalityId: string | undefined;
    if (characterInput !== null && characterInput.toLowerCase() !== 'all') {
      const resolved = await resolveMemoryModeTargetOrReply(context, userClient, characterInput);
      if (resolved === null) {
        return;
      }
      personalityId = resolved.id;
    }

    const result = await userClient.getIncognitoStatus({ personalityId });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, 'Status check failed');
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, 'incognito status', { operation: 'read' })
        ),
      });
      return;
    }

    const data = result.data;

    if (!data.active || data.sessions.length === 0) {
      const embed = createInfoEmbed(
        '👻 Incognito Status',
        'Incognito mode is **not active**.\n\nMemories are being saved normally during conversations.'
      );
      await context.editReply({ embeds: [embed] });
      return;
    }

    // Get personality names for each session
    const sessionLines = await Promise.all(
      data.sessions.map(async session => {
        if (session.personalityId === 'all') {
          return formatSessionInfo(session, ALL_PERSONALITIES_LABEL);
        }
        const name = await getPersonalityName(userClient, session.personalityId);
        return formatSessionInfo(session, name ?? session.personalityId);
      })
    );

    const embed = createWarningEmbed(
      '👻 Incognito Active',
      `Incognito mode is currently **active**.\n\n**Active sessions:**\n${sessionLines.join('\n')}\n\nNew memories will NOT be saved for these characters.`
    );

    await context.editReply({ embeds: [embed] });

    logger.info({ userId, sessionCount: data.sessions.length }, 'Status checked');
  } catch (error) {
    logger.error({ err: error, userId }, UNEXPECTED_ERROR_LOG_MESSAGE);
    // handleIncognitoStatus only READS — never claim a write.
    await context.editReply({
      content: renderSpec(classifyGatewayFailure(error, 'incognito status', { operation: 'read' })),
    });
  }
}

/**
 * Handle /memory incognito forget
 */
export async function handleIncognitoForget(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const { userClient } = clientsFor(context.interaction);
  const options = memoryIncognitoForgetOptions(context.interaction);
  const personalityInput = options.character();
  const timeframe = options.timeframe();

  try {
    const resolved = await resolveMemoryModeTargetOrReply(context, userClient, personalityInput);
    if (resolved === null) {
      return;
    }

    // Discord slash-command `choices` constrains the runtime value, but the
    // generated `commandOptions` typing is plain `string`. Narrow via the API
    // schema itself (the single source of truth) rather than an unchecked cast:
    // if Discord's choices ever drift from the enum, this fails closed with a
    // clear error instead of forwarding an invalid value to a 400.
    const timeframeParse = IncognitoForgetRequestSchema.shape.timeframe.safeParse(timeframe);
    if (!timeframeParse.success) {
      logger.warn({ userId, personalityInput, timeframe }, 'Invalid incognito timeframe');
      await context.editReply({
        content: renderSpec(
          CATALOG.error.validation('Invalid timeframe. Please pick one of the provided choices.')
        ),
      });
      return;
    }

    const result = await userClient.incognitoForget({
      personalityId: resolved.id,
      timeframe: timeframeParse.data,
    });

    if (!result.ok) {
      logger.warn({ userId, personalityInput, timeframe, status: result.status }, 'Forget failed');
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, 'memories', { failedAction: 'delete recent memories' })
        ),
      });
      return;
    }

    const data = result.data;

    const embed =
      data.deletedCount > 0
        ? createSuccessEmbed(
            '🗑️ Memories Deleted',
            `**${data.deletedCount} memories** from the last ${timeframe} have been deleted.\n\n${data.personalities.length > 0 ? `**Affected characters:** ${data.personalities.map(p => escapeMarkdown(p)).join(', ')}` : ''}\n\n*Note: Locked memories are preserved.*`
          )
        : createInfoEmbed(
            '🗑️ No Memories Found',
            `No unlocked memories found in the last ${timeframe} for **${escapeMarkdown(resolved.name ?? personalityInput)}**.`
          );

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, personalityId: resolved.id, timeframe, deletedCount: data.deletedCount },
      'Forget executed'
    );
  } catch (error) {
    logger.error({ err: error, userId }, UNEXPECTED_ERROR_LOG_MESSAGE);
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'memories', { failedAction: 'delete recent memories' })
      ),
    });
  }
}
