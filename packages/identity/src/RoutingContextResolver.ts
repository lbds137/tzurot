/**
 * Routing-context resolver
 *
 * The server-side orchestration behind `POST /api/internal/v1/routing-context`.
 * Resolves the per-(user, personality) routing facts a Discord message needs
 * before the AI job is dispatched: internal user UUID (provisioning the user +
 * default persona on first contact), the active persona via the override →
 * default cascade, the persona display name, the user timezone, and the STM
 * context-epoch.
 *
 * This is the relocation of bot-client's former `resolveUserContext` — the
 * cascade now runs where Prisma is legal (the gateway) instead of being
 * reimplemented behind a `PrismaClient` injected into bot-client. The reads are
 * sequentially dependent (UUID → cascade → epoch), so consolidating them here
 * collapses ~4 serialized HTTP hops on the hot path into one round-trip.
 */

import {
  type RoutingContextRequest,
  type RoutingContextResponse,
} from '@tzurot/common-types/schemas/api/internal';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { UserService } from './UserService.js';
import type { PersonaResolver } from './resolvers/PersonaResolver.js';

const logger = createLogger('RoutingContextResolver');

/** Collaborators for {@link resolveRoutingContext}. */
export interface RoutingContextDeps {
  userService: UserService;
  personaResolver: PersonaResolver;
  prisma: PrismaClient;
}

/**
 * Look up the STM context-epoch (last-reset timestamp) for a
 * (user, personality, persona) triple. Returns `undefined` when no reset has
 * been recorded — the common case. A system-default persona (`personaId === ''`)
 * is short-circuited before the query: `persona_id` is a `@db.Uuid` column, so
 * Postgres rejects `''` with `invalid input syntax for type uuid` (a thrown
 * error, not a graceful miss). The empty sentinel can never own a
 * history-config row anyway, so returning `undefined` is the correct no-op.
 */
async function lookupContextEpoch(
  prisma: PrismaClient,
  userId: string,
  personalityId: string,
  personaId: string
): Promise<Date | undefined> {
  if (personaId.length === 0) {
    return undefined;
  }
  const historyConfig = await prisma.userPersonaHistoryConfig.findUnique({
    where: {
      userId_personalityId_personaId: { userId, personalityId, personaId },
    },
    select: { lastContextReset: true },
  });
  return historyConfig?.lastContextReset ?? undefined;
}

/**
 * Resolve the routing context for a message author + target personality.
 *
 * Returns `null` when the author is a bot — `getOrCreateUser` refuses to
 * provision bots, and the caller returns 400. Otherwise provisioning is
 * idempotent (upsert keyed on `discordId`), so retries and concurrent
 * first-messages are safe.
 */
export async function resolveRoutingContext(
  deps: RoutingContextDeps,
  request: RoutingContextRequest
): Promise<RoutingContextResponse | null> {
  const { userService, personaResolver, prisma } = deps;
  const { discordId, username, displayName, isBot, personalityId } = request;

  const provisioned = await userService.getOrCreateUser(
    discordId,
    username,
    displayName,
    undefined,
    isBot ?? false
  );
  if (provisioned === null) {
    return null; // bot author — caller returns 400
  }
  const userId = provisioned.userId;

  const personaResult = await personaResolver.resolve(discordId, personalityId);
  const personaId = personaResult.config.personaId;
  const personaName = personaResult.config.preferredName;

  // Independent reads — neither depends on the other, so parallelize to save a
  // serial round-trip on the hot path.
  const [timezone, contextEpoch] = await Promise.all([
    userService.getUserTimezone(userId),
    lookupContextEpoch(prisma, userId, personalityId, personaId),
  ]);

  logger.debug(
    { userId, personaId, personalityId, hasEpoch: contextEpoch !== undefined },
    'Resolved routing context'
  );

  return {
    userId,
    personaId,
    personaName,
    timezone,
    contextEpoch: contextEpoch?.toISOString() ?? null,
  };
}
