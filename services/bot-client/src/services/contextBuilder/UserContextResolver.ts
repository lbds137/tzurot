/**
 * User Context Resolver
 *
 * Resolves the message author's routing facts — internal user id, active
 * persona, persona name, timezone, and the STM context-epoch — via the
 * gateway's `routing-context` endpoint. The provisioning + persona cascade +
 * epoch reads run server-side (where Prisma is legal) in one round-trip; this
 * module is now a thin adapter that maps the response into the shape
 * `MessageContextBuilder` expects.
 */

import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ServiceClient } from '@tzurot/clients';

const logger = createLogger('UserContextResolver');

/** Result of resolving user, persona, and (deferred) history. */
interface UserContextResult {
  internalUserId: string;
  discordUserId: string;
  personaId: string;
  personaName: string | null;
  userTimezone: string | undefined;
  contextEpoch: Date | undefined;
  history: ConversationMessage[];
}

/** User info for context resolution. */
interface UserInfo {
  id: string;
  username: string;
  bot?: boolean;
}

/** Dependencies for user context resolution. */
interface UserContextDeps {
  serviceClient: ServiceClient;
}

/**
 * Resolve user identity, persona, timezone, and context epoch for the message
 * author against the target personality.
 *
 * @param user - User info (from overrideUser or message.author)
 * @param personality - Target AI personality
 * @param displayName - Display name for persona creation (provisioning seed)
 * @param deps - Dependencies (the internal-gateway ServiceClient)
 * @returns Resolved user context info
 */
export async function resolveUserContext(
  user: UserInfo,
  personality: LoadedPersonality,
  displayName: string,
  deps: UserContextDeps
): Promise<UserContextResult> {
  const { serviceClient } = deps;

  const result = await serviceClient.routingContextCreate({
    discordId: user.id,
    username: user.username,
    displayName,
    isBot: user.bot ?? false,
    personalityId: personality.id,
  });

  if (!result.ok) {
    // The bot-author rejection is the endpoint's 400; keep the original wording
    // ONLY for that exact case (a defensive backstop — bots are filtered
    // upstream). Any other failure for a bot author (network timeout, gateway
    // 5xx) must surface its real status, not a misleading bot-rejection.
    if (user.bot === true && result.status === 400) {
      throw new Error('Cannot process messages from bots');
    }
    throw new Error(`Failed to resolve routing context (status ${result.status}): ${result.error}`);
  }

  const { userId, personaId, personaName, timezone, contextEpoch } = result.data;
  // contextEpoch is the STM-reset timestamp; the gateway returns it as an ISO
  // string (or null). History filtering downstream still wants a Date.
  const resolvedEpoch = contextEpoch !== null ? new Date(contextEpoch) : undefined;

  logger.debug(
    {
      personaId,
      personaName,
      internalUserId: userId,
      discordUserId: user.id,
      personalityId: personality.id,
    },
    'User persona lookup complete (via routing-context)'
  );
  if (resolvedEpoch !== undefined) {
    // Grep anchor: the STM-clear epoch silently bounds the downstream history
    // window, which is non-obvious — an explicit trace of when one is applied is
    // worth keeping for operators debugging history truncation.
    logger.debug(
      { personaId, contextEpoch: resolvedEpoch.toISOString() },
      'Resolved STM context-epoch (history will be bounded by it)'
    );
  }

  return {
    internalUserId: userId,
    discordUserId: user.id,
    personaId,
    personaName,
    userTimezone: timezone,
    contextEpoch: resolvedEpoch,
    // History is fetched later in buildContext (it chooses personality-filtered
    // vs full channel history based on options), so this stays empty here.
    history: [],
  };
}
