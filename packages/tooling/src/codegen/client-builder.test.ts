/**
 * Tests for the client-class composition.
 *
 * Asserts the structural pieces of the generated class file. Snapshot
 * tests would be too brittle for whitespace tweaks; instead we look
 * for the structural anchors that matter.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { RouteDef } from '@tzurot/clients';
import { buildClientClass } from './client-builder.js';

const internalRoutes: Record<string, RouteDef> = {
  pingService: {
    audience: 'internal',
    method: 'get',
    path: '/ping',
    id: 'pingService',
    output: z.object({ ok: z.boolean() }),
    serviceOnly: true,
  },
  generate: {
    audience: 'internal',
    method: 'post',
    path: '/generate',
    id: 'generate',
    input: z.object({ prompt: z.string() }),
    output: z.object({ text: z.string() }),
    serviceOnly: true,
  },
};

const adminRoutes: Record<string, RouteDef> = {
  recentLogs: {
    audience: 'admin',
    method: 'get',
    path: '/diagnostic/recent',
    id: 'recentLogs',
    query: { since: z.string() },
    output: z.object({ logs: z.array(z.object({})) }),
    acceptsSubject: true,
  },
};

const userRoutes: Record<string, RouteDef> = {
  getMe: {
    audience: 'user',
    method: 'get',
    path: '/me',
    id: 'getMe',
    output: z.object({ id: z.string() }),
    requiresProvisionedUser: true,
  },
};

describe('buildClientClass — ServiceClient', () => {
  it('includes the autogen header', () => {
    const src = buildClientClass({
      className: 'ServiceClient',
      flavor: 'service',
      audience: 'internal',
      routes: internalRoutes,
    });
    expect(src).toContain('AUTO-GENERATED FILE');
    expect(src).toContain('pnpm ops codegen:routes');
  });

  it('imports callGateway + GatewayResult + ROUTE_MANIFEST from submodules', () => {
    const src = buildClientClass({
      className: 'ServiceClient',
      flavor: 'service',
      audience: 'internal',
      routes: internalRoutes,
    });
    // Imports come from submodule paths (not '../../index.js') to avoid
    // a circular dependency with the package root that re-exports the
    // generated classes themselves.
    expect(src).toContain(`callGateway`);
    expect(src).toContain(`type GatewayResult`);
    expect(src).toContain(`ROUTE_MANIFEST`);
    expect(src).toContain(`from '../transport.js'`);
    expect(src).toContain(`from '../../routes/manifest.js'`);
    expect(src).not.toContain(`from '../../index.js'`);
  });

  it('does NOT import ActorDiscordId / SubjectDiscordId / GatewayUser', () => {
    const src = buildClientClass({
      className: 'ServiceClient',
      flavor: 'service',
      audience: 'internal',
      routes: internalRoutes,
    });
    expect(src).not.toContain(`ActorDiscordId`);
    expect(src).not.toContain(`SubjectDiscordId`);
    expect(src).not.toContain(`GatewayUser`);
  });

  it('emits one method per route', () => {
    const src = buildClientClass({
      className: 'ServiceClient',
      flavor: 'service',
      audience: 'internal',
      routes: internalRoutes,
    });
    expect(src).toContain(`async pingService(`);
    expect(src).toContain(`async generate(`);
  });

  it('constructor accepts baseUrl + serviceSecret only', () => {
    const src = buildClientClass({
      className: 'ServiceClient',
      flavor: 'service',
      audience: 'internal',
      routes: internalRoutes,
    });
    expect(src).toContain(`constructor(options: ServiceClientOptions)`);
    expect(src).toContain(`this.baseUrl = options.baseUrl;`);
    expect(src).toContain(`this.serviceSecret = options.serviceSecret;`);
    expect(src).not.toContain(`this.actor =`);
  });
});

describe('buildClientClass — OwnerClient', () => {
  it('imports ActorDiscordId + SubjectDiscordId', () => {
    const src = buildClientClass({
      className: 'OwnerClient',
      flavor: 'owner',
      audience: 'admin',
      routes: adminRoutes,
    });
    expect(src).toContain(`type ActorDiscordId`);
    expect(src).toContain(`type SubjectDiscordId`);
  });

  it('constructor takes actor field', () => {
    const src = buildClientClass({
      className: 'OwnerClient',
      flavor: 'owner',
      audience: 'admin',
      routes: adminRoutes,
    });
    expect(src).toContain(`actor: ActorDiscordId;`);
    expect(src).toContain(`this.actor = options.actor;`);
  });

  it('emits subject option on acceptsSubject routes', () => {
    const src = buildClientClass({
      className: 'OwnerClient',
      flavor: 'owner',
      audience: 'admin',
      routes: adminRoutes,
    });
    expect(src).toContain(`subject?: SubjectDiscordId`);
  });
});

describe('buildClientClass — UserClient', () => {
  it('imports GatewayUser + ActorDiscordId (no SubjectDiscordId when no acceptsSubject routes)', () => {
    const src = buildClientClass({
      className: 'UserClient',
      flavor: 'user',
      audience: 'user',
      routes: userRoutes,
    });
    expect(src).toContain(`type ActorDiscordId`);
    expect(src).toContain(`GatewayUser`);
    expect(src).toContain(`from '@tzurot/common-types/types/gateway-context'`);
    expect(src).not.toContain(`SubjectDiscordId`);
  });

  it('imports SubjectDiscordId when at least one route has acceptsSubject', () => {
    const src = buildClientClass({
      className: 'UserClient',
      flavor: 'user',
      audience: 'user',
      routes: {
        ...userRoutes,
        diagnosticByRequestId: {
          audience: 'user',
          method: 'get',
          path: '/diagnostic/:requestId',
          id: 'diagnosticByRequestId',
          params: { requestId: z.string() },
          output: z.object({ log: z.unknown() }),
          acceptsSubject: true,
        },
      },
    });
    expect(src).toContain(`type SubjectDiscordId`);
  });

  it('constructor takes actor + user fields', () => {
    const src = buildClientClass({
      className: 'UserClient',
      flavor: 'user',
      audience: 'user',
      routes: userRoutes,
    });
    expect(src).toContain(`user: GatewayUser;`);
    expect(src).toContain(`this.user = options.user;`);
  });

  it('emits user-context headers in methods', () => {
    const src = buildClientClass({
      className: 'UserClient',
      flavor: 'user',
      audience: 'user',
      routes: userRoutes,
    });
    expect(src).toContain(`'X-User-Username': encodeURIComponent(this.user.username)`);
    expect(src).toContain(`'X-User-DisplayName': encodeURIComponent(this.user.displayName)`);
  });

  it('embeds the buildQueryString helper inline (self-contained file)', () => {
    const src = buildClientClass({
      className: 'UserClient',
      flavor: 'user',
      audience: 'user',
      routes: userRoutes,
    });
    expect(src).toContain(`function buildQueryString`);
  });
});

describe('buildClientClass — URL prefix', () => {
  it('paths get /api/internal prefix for service flavor', () => {
    const src = buildClientClass({
      className: 'ServiceClient',
      flavor: 'service',
      audience: 'internal',
      routes: internalRoutes,
    });
    expect(src).toContain(`'/api/internal/ping'`);
  });

  it('paths get /api/admin prefix for owner flavor', () => {
    const src = buildClientClass({
      className: 'OwnerClient',
      flavor: 'owner',
      audience: 'admin',
      routes: adminRoutes,
    });
    expect(src).toContain(`'/api/admin/diagnostic/recent'`);
  });

  it('paths get /api/user prefix for user flavor', () => {
    const src = buildClientClass({
      className: 'UserClient',
      flavor: 'user',
      audience: 'user',
      routes: userRoutes,
    });
    expect(src).toContain(`'/api/user/me'`);
  });
});
