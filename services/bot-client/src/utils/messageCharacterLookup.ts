/**
 * Message → Character Lookup
 *
 * Shared resolution for message context-menu actions ("Chime In" and "Edit
 * Character"). Resolves the character slug and incognito state for a clicked
 * assistant Discord message from `conversation_history` via the gateway lookup
 * route. For legacy rows that predate `messageMetadata.incognito`, infers
 * incognito in order: rendered incognito footer present → incognito; live
 * long-term memory exists for the triggering user message → not incognito;
 * otherwise → incognito (fails toward privacy).
 */

import type {
  ChatInputCommandInteraction,
  Message,
  MessageContextMenuCommandInteraction,
} from 'discord.js';
import { BOT_FOOTER_PATTERNS } from '@tzurot/common-types/constants/discord';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { CATALOG } from '../ux/catalog/catalog.js';
import { renderSpec } from '../ux/render/render.js';
import { createDeferredContext, type DeferredCommandContext } from './commandContext/index.js';
import { lookupPersonalityFromMessage } from './gatewayServiceCalls.js';

/** Error detail rendered when a clicked message does not resolve to a character turn. */
export const NOT_A_CHARACTER_MESSAGE = "That message isn't from a character.";

export interface ResolvedMessageCharacter {
  personalityId: string;
  personalityName?: string;
  personalitySlug: string;
  incognito: boolean;
}

/**
 * Check whether a Discord message's rendered content carries the incognito
 * footer line. Uses a fresh non-global `RegExp` built from
 * `BOT_FOOTER_PATTERNS.INCOGNITO_MODE.source` so the shared `/g` regex's
 * `lastIndex` state is neither read nor mutated.
 */
export function footerIsIncognito(content: string): boolean {
  return new RegExp(BOT_FOOTER_PATTERNS.INCOGNITO_MODE.source).test(content);
}

/**
 * Resolve the character and incognito state for a right-clicked Discord
 * message. Returns `null` when the message is not found in conversation
 * history, is not an assistant-role reply, or its row carries no personality
 * slug.
 *
 * Incognito precedence:
 * 1. The DB row's `messageMetadata.incognito` (true/false) wins when present.
 * 2. When `null`/`undefined` (rows predating the field): if the message's
 *    rendered content carries the incognito footer → `true`; else if a live
 *    long-term memory exists for the triggering user message
 *    (`triggerMemoryExists === true`) → `false`; else → `true` (fails toward
 *    privacy).
 */
export async function resolveMessageCharacter(
  targetMessage: Pick<Message, 'id' | 'content'>,
  opts?: { needIncognito?: boolean }
): Promise<ResolvedMessageCharacter | null> {
  const row =
    opts?.needIncognito === true
      ? await lookupPersonalityFromMessage(targetMessage.id, {
          includeIncognitoEvidence: true,
        })
      : await lookupPersonalityFromMessage(targetMessage.id);
  if (row?.role !== MessageRole.Assistant) {
    return null;
  }
  const slug = row.personalitySlug;
  if (slug === undefined || slug.length === 0) {
    return null;
  }

  // The stored flag reflects the original turn's incognito state, which
  // includes the original requester's `/memory incognito` session
  // (`ConversationalRAGService.ts` `incognitoModeActive`), so a Chime In on
  // such a reply runs incognito for the clicker too — intended (sticky, fails
  // toward privacy); and a clicker's own `/memory incognito` still forces
  // incognito in ai-worker, so privacy only widens.
  // Semantically the legacy fallback order is footer first, then memory; in
  // execution the gateway's triggerMemoryExists query runs first on every
  // legacy lookup that sends `includeIncognitoEvidence` (before bot-client
  // sees the footer). That is by design — do not make the gateway skip it, or
  // the memory fallback is lost when no footer is present.
  const incognito =
    row.incognito ??
    (footerIsIncognito(targetMessage.content) ? true : row.triggerMemoryExists !== true);

  return {
    personalityId: row.personalityId,
    personalityName: row.personalityName,
    personalitySlug: slug,
    incognito,
  };
}

/**
 * Resolve the character for a message context-menu interaction, or edit the
 * deferred ephemeral reply with the validation error and return `null`.
 */
export async function resolveMessageCharacterOrReply(
  interaction: MessageContextMenuCommandInteraction,
  opts?: { needIncognito?: boolean }
): Promise<ResolvedMessageCharacter | null> {
  const resolved = await resolveMessageCharacter(interaction.targetMessage, opts);
  if (resolved === null) {
    await interaction.editReply({
      content: renderSpec(CATALOG.error.validation(NOT_A_CHARACTER_MESSAGE)),
    });
    return null;
  }
  return resolved;
}

/**
 * Build a `DeferredCommandContext` from a message context-menu interaction.
 * `CommandHandler.handleContextMenuCommand` has already deferred the
 * interaction ephemerally before invoking `execute`, and neither
 * `runCharacterTurn` (with an explicit `characterArg`) nor
 * `openCharacterEditDashboard` reads slash command options.
 */
export function createContextMenuDeferredContext(
  interaction: MessageContextMenuCommandInteraction
): DeferredCommandContext {
  return createDeferredContext(interaction as unknown as ChatInputCommandInteraction, true);
}
