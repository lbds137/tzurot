/**
 * Tests for clientsFor(interaction) factory.
 *
 * The factory is a thin boundary helper — its real value is being the
 * ONE place per interaction where `asActor` + `toGatewayUser` are
 * called, so downstream handlers receive already-branded inputs. These
 * tests pin that contract: brand minted from `interaction.user.id`,
 * GatewayUser shape derived correctly, and the three client classes
 * are instantiated with consistent inputs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnerClient, ServiceClient, UserClient } from '@tzurot/clients';
import type { ChatInputCommandInteraction, User as DiscordUser } from 'discord.js';

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => ({
      GATEWAY_URL: 'http://localhost:3000',
      INTERNAL_SERVICE_SECRET: 'test-service-secret',
    }),
  };
});

vi.mock('../startup.js', () => ({
  getValidatedServiceSecret: () => 'test-service-secret',
}));

import {
  clientsFor,
  clientsForUser,
  getServiceClient,
  toGatewayUser,
  isGatewayConfigured,
} from './gatewayClients.js';

function makeUser(overrides: Record<string, unknown> = {}): DiscordUser {
  // Cast through unknown — DiscordUser has a template-literal `toString()`
  // type (`<@${string}>`) that a plain object literal can't structurally
  // satisfy. The factory exists only to feed the few fields clientsFor reads.
  return {
    id: '123456789012345678',
    username: 'alice',
    globalName: 'Alice',
    bot: false,
    ...overrides,
  } as unknown as DiscordUser;
}

function makeInteraction(user: DiscordUser): ChatInputCommandInteraction {
  return { user } as unknown as ChatInputCommandInteraction;
}

describe('clientsFor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns ServiceClient / OwnerClient / UserClient instances', () => {
    const result = clientsFor(makeInteraction(makeUser()));

    expect(result.serviceClient).toBeInstanceOf(ServiceClient);
    expect(result.ownerClient).toBeInstanceOf(OwnerClient);
    expect(result.userClient).toBeInstanceOf(UserClient);
  });

  it('mints actor from interaction.user.id', () => {
    const user = makeUser({ id: 'discord-id-42' });
    const result = clientsFor(makeInteraction(user));

    // `actor` is a branded string — at runtime it's just the id, the brand
    // lives only in the type system.
    expect(result.actor).toBe('discord-id-42');
  });

  it('builds GatewayUser using globalName when present', () => {
    const user = makeUser({
      id: 'u1',
      username: 'alice',
      globalName: 'Alice Display',
    });
    const result = clientsFor(makeInteraction(user));

    expect(result.user).toEqual({
      discordId: 'u1',
      username: 'alice',
      displayName: 'Alice Display',
      isBot: false,
    });
  });

  it('falls back to username when globalName is null', () => {
    const user = makeUser({ id: 'u2', username: 'bob', globalName: null });
    const result = clientsFor(makeInteraction(user));

    expect(result.user.displayName).toBe('bob');
  });

  it('throws when GATEWAY_URL is missing', async () => {
    vi.resetModules();
    vi.doMock('@tzurot/common-types/config/config', async () => {
      const actual = await vi.importActual('@tzurot/common-types/config/config');
      return { ...actual, getConfig: () => ({ GATEWAY_URL: '' }) };
    });
    vi.doMock('../startup.js', () => ({
      getValidatedServiceSecret: () => 'test-service-secret',
    }));
    const mod = await import('./gatewayClients.js');
    expect(() => mod.clientsFor(makeInteraction(makeUser()))).toThrow('GATEWAY_URL');
    vi.doUnmock('@tzurot/common-types/config/config');
    vi.doUnmock('../startup.js');
  });
});

describe('clientsForUser', () => {
  // Used by message-handler / startup contexts where there's no interaction
  // to read `.user` from — caller passes the DiscordUser directly.
  it('builds the same shape as clientsFor when given the same user', () => {
    const user = makeUser({ id: 'u-direct', username: 'direct', globalName: 'Direct' });

    const fromInteraction = clientsFor(makeInteraction(user));
    const direct = clientsForUser(user);

    expect(direct.actor).toBe(fromInteraction.actor);
    expect(direct.user).toEqual(fromInteraction.user);
    expect(direct.serviceClient).toBeInstanceOf(ServiceClient);
    expect(direct.ownerClient).toBeInstanceOf(OwnerClient);
    expect(direct.userClient).toBeInstanceOf(UserClient);
  });
});

describe('getServiceClient', () => {
  // No-actor factory for startup services (e.g., DM prewarmer) that hit
  // `/api/internal/*` before any Discord interaction exists.
  it('returns a ServiceClient without requiring a Discord user', () => {
    expect(getServiceClient()).toBeInstanceOf(ServiceClient);
  });

  it('throws when GATEWAY_URL is missing (same defense as clientsFor)', async () => {
    vi.resetModules();
    vi.doMock('@tzurot/common-types/config/config', async () => {
      const actual = await vi.importActual('@tzurot/common-types/config/config');
      return { ...actual, getConfig: () => ({ GATEWAY_URL: '' }) };
    });
    vi.doMock('../startup.js', () => ({
      getValidatedServiceSecret: () => 'test-service-secret',
    }));
    const mod = await import('./gatewayClients.js');
    expect(() => mod.getServiceClient()).toThrow('GATEWAY_URL');
    vi.doUnmock('@tzurot/common-types/config/config');
    vi.doUnmock('../startup.js');
  });
});

describe('toGatewayUser', () => {
  // Centralizes the globalName ?? username fallback. Relocated here from the
  // deleted userGatewayClient module — this is the only consumer's home.
  it('uses globalName as displayName when present', () => {
    expect(toGatewayUser(makeUser({ id: 'u1', username: 'alice', globalName: 'Alice' }))).toEqual({
      discordId: 'u1',
      username: 'alice',
      displayName: 'Alice',
      isBot: false,
    });
  });

  it('falls back to username when globalName is null', () => {
    expect(toGatewayUser(makeUser({ id: 'u2', username: 'bob', globalName: null }))).toEqual({
      discordId: 'u2',
      username: 'bob',
      displayName: 'bob',
      isBot: false,
    });
  });

  it('carries the bot flag through — the gateway rejects declared bots at auth', () => {
    expect(toGatewayUser(makeUser({ id: 'u3', username: 'botty', bot: true }))).toEqual(
      expect.objectContaining({ isBot: true })
    );
  });
});

describe('isGatewayConfigured', () => {
  // Non-throwing preflight check used by commandHelpers.
  it('returns true when GATEWAY_URL is configured', () => {
    expect(isGatewayConfigured()).toBe(true);
  });

  it('returns false when GATEWAY_URL is missing', async () => {
    vi.resetModules();
    vi.doMock('@tzurot/common-types/config/config', async () => {
      const actual = await vi.importActual('@tzurot/common-types/config/config');
      return { ...actual, getConfig: () => ({ GATEWAY_URL: '' }) };
    });
    vi.doMock('../startup.js', () => ({
      getValidatedServiceSecret: () => 'test-service-secret',
    }));
    const mod = await import('./gatewayClients.js');
    expect(mod.isGatewayConfigured()).toBe(false);
    vi.doUnmock('@tzurot/common-types/config/config');
    vi.doUnmock('../startup.js');
  });
});
