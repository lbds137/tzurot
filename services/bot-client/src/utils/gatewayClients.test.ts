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
import { OwnerClient, ServiceClient, UserClient } from '@tzurot/common-types';
import type { ChatInputCommandInteraction, User as DiscordUser } from 'discord.js';

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

import { clientsFor } from './gatewayClients.js';

function makeUser(overrides: Record<string, unknown> = {}): DiscordUser {
  // Cast through unknown — DiscordUser has a template-literal `toString()`
  // type (`<@${string}>`) that a plain object literal can't structurally
  // satisfy. The factory exists only to feed the few fields clientsFor reads.
  return {
    id: '123456789012345678',
    username: 'alice',
    globalName: 'Alice',
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
    });
  });

  it('falls back to username when globalName is null', () => {
    const user = makeUser({ id: 'u2', username: 'bob', globalName: null });
    const result = clientsFor(makeInteraction(user));

    expect(result.user.displayName).toBe('bob');
  });

  it('throws when GATEWAY_URL is missing', async () => {
    vi.resetModules();
    vi.doMock('@tzurot/common-types', async () => {
      const actual = await vi.importActual('@tzurot/common-types');
      return { ...actual, getConfig: () => ({ GATEWAY_URL: '' }) };
    });
    vi.doMock('../startup.js', () => ({
      getValidatedServiceSecret: () => 'test-service-secret',
    }));
    const mod = await import('./gatewayClients.js');
    expect(() => mod.clientsFor(makeInteraction(makeUser()))).toThrow('GATEWAY_URL');
    vi.doUnmock('@tzurot/common-types');
    vi.doUnmock('../startup.js');
  });
});
