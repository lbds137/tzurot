/**
 * User Context Resolver
 *
 * Handles resolving user identity, persona lookup, and context epoch.
 */

import {
  createLogger,
  type UserService,
  type PersonaResolver,
  type PrismaClient,
  type LoadedPersonality,
  type ConversationMessage,
} from '@tzurot/common-types';

const logger = createLogger('UserContextResolver');

/** Result of resolving user, persona, and history */
export interface UserContextResult {
  internalUserId: string;
  discordUserId: string;
  personaId: string;
  personaName: string | null;
  userTimezone: string | undefined;
  contextEpoch: Date | undefined;
  history: ConversationMessage[];
}

/** User info for context resolution */
export interface UserInfo {
  id: string;
  username: string;
  bot?: boolean;
}

/** Dependencies for user context resolution */
export interface UserContextDeps {
  userService: UserService;
  personaResolver: PersonaResolver;
  prisma: PrismaClient;
}

/**
 * Look up the context epoch for STM clear feature.
 * Returns undefined if no epoch is set.
 *
 * @param prisma - Prisma client
 * @param internalUserId - Internal user UUID
 * @param personalityId - Personality ID
 * @param personaId - Persona ID
 * @returns Context epoch date or undefined
 */
export async function lookupContextEpoch(
  prisma: PrismaClient,
  internalUserId: string,
  personalityId: string,
  personaId: string
): Promise<Date | undefined> {
  const historyConfig = await prisma.userPersonaHistoryConfig.findUnique({
    where: {
      userId_personalityId_personaId: {
        userId: internalUserId,
        personalityId,
        personaId,
      },
    },
    select: { lastContextReset: true },
  });
  return historyConfig?.lastContextReset ?? undefined;
}

/**
 * Resolve user identity, persona, and fetch context epoch.
 *
 * @param user - User info (from overrideUser or message.author)
 * @param personality - Target AI personality
 * @param displayName - Display name for persona creation
 * @param deps - Dependencies (userService, personaResolver, prisma)
 * @returns Resolved user context info
 */
export async function resolveUserContext(
  user: UserInfo,
  personality: LoadedPersonality,
  displayName: string,
  deps: UserContextDeps
): Promise<UserContextResult> {
  const { userService, personaResolver, prisma } = deps;

  // Get internal user ID for database operations
  const internalUserId = await userService.getOrCreateUser(
    user.id,
    user.username,
    displayName,
    undefined,
    user.bot ?? false
  );

  if (internalUserId === null) {
    throw new Error('Cannot process messages from bots');
  }

  const discordUserId = user.id;
  const personaResult = await personaResolver.resolve(discordUserId, personality.id);
  const personaId = personaResult.config.personaId;
  const personaName = personaResult.config.preferredName;
  const userTimezone = await userService.getUserTimezone(internalUserId);

  logger.debug(
    { personaId, personaName, internalUserId, discordUserId, personalityId: personality.id },
    '[UserContextResolver] User persona lookup complete'
  );

  // Look up context epoch (STM clear feature)
  const contextEpoch = await lookupContextEpoch(prisma, internalUserId, personality.id, personaId);
  if (contextEpoch !== undefined) {
    logger.debug(
      { personaId, contextEpoch: contextEpoch.toISOString() },
      '[UserContextResolver] Applying context epoch filter (STM clear)'
    );
  }

  // Note: History fetching is deferred to buildContext which has access to options
  // This allows choosing between personality-filtered or full channel history
  // based on whether extended context is enabled.
  const history: ConversationMessage[] = [];

  return {
    internalUserId,
    discordUserId,
    personaId,
    personaName,
    userTimezone,
    contextEpoch,
    history,
  };
}
