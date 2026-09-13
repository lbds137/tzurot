/**
 * Persona cache-invalidation SUBSCRIBER for the gateway.
 *
 * The gateway resolves personas in two places (the internal routing-context
 * route and the history-context helper), both through the shared
 * per-PrismaClient resolver. Nothing evicted that cache in this process, so a
 * persona change was only picked up when the resolver's own TTL expired. This
 * subscribes the gateway to the persona channel and evicts the SAME instance
 * those call sites obtain — `getOrCreatePersonaResolver` is keyed on the
 * PrismaClient, so a private resolver here would evict nothing they read.
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getOrCreatePersonaResolver } from '@tzurot/identity';
import type { PersonaCacheInvalidationService } from '@tzurot/cache-invalidation';

const logger = createLogger('api-gateway-persona-invalidation');

/** Subscribe the shared, per-PrismaClient `PersonaResolver` to persona cache invalidation. */
export async function subscribePersonaInvalidation(deps: {
  prisma: PrismaClient;
  personaCacheInvalidation: PersonaCacheInvalidationService;
}): Promise<void> {
  const personaResolver = getOrCreatePersonaResolver(deps.prisma);
  await deps.personaCacheInvalidation.subscribe(event => {
    if (event.type === 'all') {
      personaResolver.clearCache();
      logger.info('Cleared all persona cache entries');
    } else {
      personaResolver.invalidateUserCache(event.discordId);
      logger.info({ discordId: event.discordId }, 'Invalidated persona cache for user');
    }
  });
  logger.info('PersonaResolver subscribed to persona cache invalidation');
}
