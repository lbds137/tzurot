/**
 * Seam test: subscribePersonaInvalidation evicts the SAME shared
 * `PersonaResolver` instance the gateway's routing-context/history-context
 * call sites obtain via `getOrCreatePersonaResolver` — not a private
 * instance of its own. `@tzurot/identity` is deliberately NOT mocked: the
 * whole point of this fix is that the eviction reaches the real registry.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { getOrCreatePersonaResolver } from '@tzurot/identity';
import type { PersonaCacheInvalidationService } from '@tzurot/cache-invalidation';
import { subscribePersonaInvalidation } from './personaInvalidationSubscription.js';

/** The real service's `subscribe` handler-parameter type — not exported standalone. */
type PersonaCacheInvalidationEvent = Parameters<
  PersonaCacheInvalidationService['subscribe']
>[0] extends (event: infer E) => void
  ? E
  : never;

describe('subscribePersonaInvalidation', () => {
  it('invalidates the shared per-PrismaClient resolver for a user event', async () => {
    const prisma = {} as unknown as PrismaClient;
    const personaResolver = getOrCreatePersonaResolver(prisma);
    const invalidateUserCacheSpy = vi.spyOn(personaResolver, 'invalidateUserCache');
    const clearCacheSpy = vi.spyOn(personaResolver, 'clearCache');

    let capturedHandler: ((event: PersonaCacheInvalidationEvent) => void) | undefined;
    const fakeInvalidationService = {
      subscribe: vi.fn(async (handler: (event: PersonaCacheInvalidationEvent) => void) => {
        capturedHandler = handler;
      }),
    };

    await subscribePersonaInvalidation({
      prisma,
      personaCacheInvalidation:
        fakeInvalidationService as unknown as PersonaCacheInvalidationService,
    });

    expect(capturedHandler).toBeDefined();
    capturedHandler?.({ type: 'user', discordId: '123456789012345678' });

    expect(invalidateUserCacheSpy).toHaveBeenCalledWith('123456789012345678');
    expect(clearCacheSpy).not.toHaveBeenCalled();
  });

  it('clears the shared resolver cache for an "all" event', async () => {
    const prisma = {} as unknown as PrismaClient;
    const personaResolver = getOrCreatePersonaResolver(prisma);
    const invalidateUserCacheSpy = vi.spyOn(personaResolver, 'invalidateUserCache');
    const clearCacheSpy = vi.spyOn(personaResolver, 'clearCache');

    let capturedHandler: ((event: PersonaCacheInvalidationEvent) => void) | undefined;
    const fakeInvalidationService = {
      subscribe: vi.fn(async (handler: (event: PersonaCacheInvalidationEvent) => void) => {
        capturedHandler = handler;
      }),
    };

    await subscribePersonaInvalidation({
      prisma,
      personaCacheInvalidation:
        fakeInvalidationService as unknown as PersonaCacheInvalidationService,
    });

    expect(capturedHandler).toBeDefined();
    capturedHandler?.({ type: 'all' });

    expect(clearCacheSpy).toHaveBeenCalledTimes(1);
    expect(invalidateUserCacheSpy).not.toHaveBeenCalled();
  });
});
