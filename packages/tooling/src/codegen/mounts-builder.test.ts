/**
 * Tests for the mounts.ts file builder.
 *
 * The builder is a pure function over manifest entries — these tests
 * exercise it with synthetic routes spanning all three audiences plus
 * the per-route flag combinations the mount-generation cares about
 * (acceptsSubject, requiresProvisionedUser) to verify the emitted
 * source has the right shape. Note that timeoutMs is a client-side
 * concern handled by method-builder.ts; the mount generator doesn't
 * emit it.
 *
 * A separate integration test verifying the real manifest's wired
 * composition lands with the handler-export refactor in the follow-up.
 * Here we just verify the builder's structural correctness.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Audience, RouteDef } from '@tzurot/common-types';
import { buildMountsFile, type HandlerPathResolver } from './mounts-builder.js';

const handlerPathFor: HandlerPathResolver = id => `../testHandlers/${id}.js`;

function makeRoute(overrides: Partial<RouteDef> & { id: string; audience: Audience }): RouteDef {
  return {
    method: 'get',
    path: `/${overrides.id}`,
    output: z.object({ ok: z.boolean() }),
    ...overrides,
  };
}

describe('buildMountsFile — structural', () => {
  it('emits the AUTO-GENERATED header', () => {
    const src = buildMountsFile({
      routesByAudience: { internal: {}, admin: {}, user: {} },
      handlerPathFor,
    });
    expect(src).toContain('AUTO-GENERATED FILE');
  });

  it('exports the three mount functions even when an audience has no routes', () => {
    const src = buildMountsFile({
      routesByAudience: { internal: {}, admin: {}, user: {} },
      handlerPathFor,
    });
    expect(src).toContain(`export function mountInternalRoutes`);
    expect(src).toContain(`export function mountAdminRoutes`);
    expect(src).toContain(`export function mountUserRoutes`);
  });

  it('marks unused params with _-prefix when an audience has no routes', () => {
    const src = buildMountsFile({
      routesByAudience: { internal: {}, admin: {}, user: {} },
      handlerPathFor,
    });
    // No routes → unused app and deps params. Underscore-prefixing
    // keeps noUnusedParameters happy.
    expect(src).toContain(`mountInternalRoutes(_app: Express, _deps: RouteDeps)`);
  });

  it('imports RouteDeps from routes/routeDeps.js', () => {
    const src = buildMountsFile({
      routesByAudience: { internal: {}, admin: {}, user: {} },
      handlerPathFor,
    });
    expect(src).toContain(`import type { RouteDeps } from '../routeDeps.js'`);
  });

  it('does not emit a trailing blank line when the manifest has no routes', () => {
    // Regression guard: the import-list builder had a filter that kept
    // empty strings through, leaving a spurious double-blank tail in
    // the output when handlerImports was '' (no routes). Drift checks
    // would flag the difference as a meaningless diff.
    const src = buildMountsFile({
      routesByAudience: { internal: {}, admin: {}, user: {} },
      handlerPathFor,
    });
    // No `handle*` imports → no separator-then-empty-block tail.
    expect(src).not.toMatch(/\n\n\n/);
  });

  it('merges handlers from the same source module into a single import statement', () => {
    const sharedPath = '../shared/foo.js';
    const src = buildMountsFile({
      routesByAudience: {
        internal: {},
        admin: {},
        user: {
          getFoo: makeRoute({ id: 'getFoo', audience: 'user', method: 'get', path: '/foo' }),
          updateFoo: makeRoute({ id: 'updateFoo', audience: 'user', method: 'put', path: '/bar' }),
        },
      },
      // Both route handlers resolve to the same module.
      handlerPathFor: () => sharedPath,
    });

    // One merged import, not two single-name lines from the same path.
    expect(src).toMatch(/import \{ handleGetFoo, handleUpdateFoo \} from '\.\.\/shared\/foo\.js';/);
    expect(src).not.toMatch(/import \{ handleGetFoo \} from '\.\.\/shared\/foo\.js';/);
  });

  it('omits the AuthMiddleware import entirely when no routes use any of its members', () => {
    // Empty manifest → no audience needs auth → import block is omitted
    // to satisfy noUnusedLocals in the generated file.
    const src = buildMountsFile({
      routesByAudience: { internal: {}, admin: {}, user: {} },
      handlerPathFor,
    });
    expect(src).not.toContain(`from '../../services/AuthMiddleware.js'`);
    expect(src).not.toContain(`requireOwnerAuth`);
    expect(src).not.toContain(`requireProvisionedUser`);
    expect(src).not.toContain(`requireUserAuth`);
  });
});

describe('buildMountsFile — conditional middleware imports', () => {
  it('imports only requireUserAuth when only user-audience routes exist (no provisioning)', () => {
    const src = buildMountsFile({
      routesByAudience: {
        internal: {},
        admin: {},
        user: {
          getDiagnostic: makeRoute({
            id: 'getDiagnostic',
            audience: 'user',
            acceptsSubject: true,
          }),
        },
      },
      handlerPathFor,
    });
    expect(src).toContain(`requireUserAuth,`);
    expect(src).not.toContain(`requireOwnerAuth`);
    expect(src).not.toContain(`requireProvisionedUser`);
  });

  it('does NOT add requireProvisionedUser for an admin route with the flag set', () => {
    // Defense-in-depth: manifest invariant test forbids
    // requiresProvisionedUser on non-user routes, but if it ever
    // weakens, the codegen should still produce a consistent file.
    // An admin route with the flag set should not get the provisioning
    // middleware (the audience prefix doesn't apply it) nor pull in
    // the requireProvisionedUser import.
    const src = buildMountsFile({
      routesByAudience: {
        internal: {},
        admin: {
          weirdAdmin: makeRoute({
            id: 'weirdAdmin',
            audience: 'admin',
            method: 'post',
            requiresProvisionedUser: true,
          }),
        },
        user: {},
      },
      handlerPathFor,
    });
    expect(src).not.toContain(`requireProvisionedUser`);
    expect(src).toContain(`requireOwnerAuth,`);
  });

  it('adds requireProvisionedUser when at least one user route requires provisioning', () => {
    const src = buildMountsFile({
      routesByAudience: {
        internal: {},
        admin: {},
        user: {
          getMe: makeRoute({
            id: 'getMe',
            audience: 'user',
            requiresProvisionedUser: true,
          }),
        },
      },
      handlerPathFor,
    });
    expect(src).toContain(`requireProvisionedUser,`);
    expect(src).toContain(`requireUserAuth,`);
    expect(src).not.toContain(`requireOwnerAuth`);
  });

  it('adds requireOwnerAuth when at least one admin route exists', () => {
    const src = buildMountsFile({
      routesByAudience: {
        internal: {},
        admin: { dbSync: makeRoute({ id: 'dbSync', audience: 'admin', method: 'post' }) },
        user: {},
      },
      handlerPathFor,
    });
    expect(src).toContain(`requireOwnerAuth,`);
    expect(src).toContain(`requireUserAuth,`);
    expect(src).not.toContain(`requireProvisionedUser`);
  });

  it('omits all middleware imports for internal-only manifests', () => {
    const src = buildMountsFile({
      routesByAudience: {
        internal: {
          aiGenerate: makeRoute({ id: 'aiGenerate', audience: 'internal', serviceOnly: true }),
        },
        admin: {},
        user: {},
      },
      handlerPathFor,
    });
    expect(src).not.toContain(`from '../../services/AuthMiddleware.js'`);
    expect(src).not.toContain(`requireOwnerAuth`);
    expect(src).not.toContain(`requireUserAuth`);
    expect(src).not.toContain(`requireProvisionedUser`);
  });
});

describe('buildMountsFile — internal audience', () => {
  const internalRoute = makeRoute({
    id: 'aiGenerate',
    audience: 'internal',
    method: 'post',
    path: '/ai/generate',
    serviceOnly: true,
  });

  it('mounts at /api/internal/<path>', () => {
    const src = buildMountsFile({
      routesByAudience: { internal: { aiGenerate: internalRoute }, admin: {}, user: {} },
      handlerPathFor,
    });
    expect(src).toContain(`app.post('/api/internal/ai/generate'`);
  });

  it('does not apply user-level or owner-level middleware', () => {
    const src = buildMountsFile({
      routesByAudience: { internal: { aiGenerate: internalRoute }, admin: {}, user: {} },
      handlerPathFor,
    });
    // The internal mount line should be just the handler call, no auth middleware.
    expect(src).toContain(`app.post('/api/internal/ai/generate', handleAiGenerate(deps));`);
  });

  it('emits the handler import using the resolver-provided path', () => {
    const src = buildMountsFile({
      routesByAudience: { internal: { aiGenerate: internalRoute }, admin: {}, user: {} },
      handlerPathFor,
    });
    expect(src).toContain(`import { handleAiGenerate } from '../testHandlers/aiGenerate.js';`);
  });
});

describe('buildMountsFile — admin audience', () => {
  const adminRoute = makeRoute({
    id: 'dbSync',
    audience: 'admin',
    method: 'post',
    path: '/db-sync',
  });

  it('mounts at /api/admin/<path> with user-auth + owner-auth middleware', () => {
    const src = buildMountsFile({
      routesByAudience: { internal: {}, admin: { dbSync: adminRoute }, user: {} },
      handlerPathFor,
    });
    expect(src).toContain(
      `app.post('/api/admin/db-sync', requireUserAuth(), requireOwnerAuth(), handleDbSync(deps));`
    );
  });
});

describe('buildMountsFile — user audience', () => {
  const userRouteRequiresProv = makeRoute({
    id: 'getTimezone',
    audience: 'user',
    method: 'get',
    path: '/timezone',
    requiresProvisionedUser: true,
  });

  const userRouteAcceptsSubject = makeRoute({
    id: 'getRecentDiagnostics',
    audience: 'user',
    method: 'get',
    path: '/diagnostic/recent',
    acceptsSubject: true,
  });

  it('mounts with user-auth + requireProvisionedUser when route requires provisioning', () => {
    const src = buildMountsFile({
      routesByAudience: { internal: {}, admin: {}, user: { getTimezone: userRouteRequiresProv } },
      handlerPathFor,
    });
    expect(src).toContain(
      `app.get('/api/user/timezone', requireUserAuth(), requireProvisionedUser(deps.prisma), handleGetTimezone(deps));`
    );
  });

  it('mounts WITHOUT requireProvisionedUser when route omits the flag', () => {
    // Diagnostic GETs (acceptsSubject) deliberately skip provisioning —
    // the subject row may not be provisioned. Verify the mount call
    // doesn't include the provisioning middleware.
    const src = buildMountsFile({
      routesByAudience: {
        internal: {},
        admin: {},
        user: { getRecentDiagnostics: userRouteAcceptsSubject },
      },
      handlerPathFor,
    });
    expect(src).toContain(
      `app.get('/api/user/diagnostic/recent', requireUserAuth(), handleGetRecentDiagnostics(deps));`
    );
    expect(src).not.toContain(`requireProvisionedUser(deps.prisma), handleGetRecentDiagnostics`);
  });

  it('uppercases the first character of the route id for the handler name', () => {
    const src = buildMountsFile({
      routesByAudience: {
        internal: {},
        admin: {},
        user: { getRecentDiagnostics: userRouteAcceptsSubject },
      },
      handlerPathFor,
    });
    // Route id `getRecentDiagnostics` → handler name `handleGetRecentDiagnostics`.
    expect(src).toContain(`handleGetRecentDiagnostics`);
  });
});

describe('buildMountsFile — multi-route composition', () => {
  it('preserves declaration order within an audience', () => {
    const src = buildMountsFile({
      routesByAudience: {
        internal: {},
        admin: {
          first: makeRoute({ id: 'first', audience: 'admin', path: '/first' }),
          second: makeRoute({ id: 'second', audience: 'admin', method: 'post', path: '/second' }),
        },
        user: {},
      },
      handlerPathFor,
    });

    const firstIdx = src.indexOf(`app.get('/api/admin/first'`);
    const secondIdx = src.indexOf(`app.post('/api/admin/second'`);
    expect(firstIdx).toBeGreaterThan(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });

  it('groups handler imports together (one import per route)', () => {
    const src = buildMountsFile({
      routesByAudience: {
        internal: { a: makeRoute({ id: 'a', audience: 'internal' }) },
        admin: { b: makeRoute({ id: 'b', audience: 'admin' }) },
        user: { c: makeRoute({ id: 'c', audience: 'user' }) },
      },
      handlerPathFor,
    });
    // One import line per route, regardless of audience.
    expect(src).toContain(`import { handleA } from '../testHandlers/a.js';`);
    expect(src).toContain(`import { handleB } from '../testHandlers/b.js';`);
    expect(src).toContain(`import { handleC } from '../testHandlers/c.js';`);
    // Middleware imports for the combined manifest: admin needs both
    // requireOwnerAuth + requireUserAuth, user contributes requireUserAuth
    // (deduped), no route opts into provisioning so it's omitted.
    expect(src).toContain(`requireOwnerAuth,`);
    expect(src).toContain(`requireUserAuth,`);
    expect(src).not.toContain(`requireProvisionedUser`);
  });
});

describe('buildMountsFile — route ordering for Express', () => {
  it('registers static-path routes before parameterized siblings', () => {
    // Manifest intentionally lists the parameterized route first to verify
    // the sort flips them. Without sortRoutesForExpress, `/thing/default`
    // would be shadowed by `/thing/:id` and respond from the wrong handler.
    const src = buildMountsFile({
      routesByAudience: {
        internal: {},
        admin: {},
        user: {
          getById: makeRoute({
            id: 'getById',
            audience: 'user',
            path: '/thing/:id',
          }),
          getDefault: makeRoute({
            id: 'getDefault',
            audience: 'user',
            path: '/thing/default',
          }),
        },
      },
      handlerPathFor,
    });
    const defaultIdx = src.indexOf(`app.get('/api/user/thing/default'`);
    const byIdIdx = src.indexOf(`app.get('/api/user/thing/:id'`);
    expect(defaultIdx).toBeGreaterThan(0);
    expect(byIdIdx).toBeGreaterThan(0);
    expect(defaultIdx).toBeLessThan(byIdIdx);
  });

  it('preserves manifest order for same-param-count routes', () => {
    // Two routes at the same param-count bucket stable-sort to manifest
    // order. Express's exact-segment-count matching prevents collisions
    // at equal depth across disjoint static-segment positions.
    const src = buildMountsFile({
      routesByAudience: {
        internal: {},
        admin: {},
        user: {
          first: makeRoute({
            id: 'first',
            audience: 'user',
            path: '/a/:x/foo',
          }),
          second: makeRoute({
            id: 'second',
            audience: 'user',
            path: '/b/:y/bar',
          }),
        },
      },
      handlerPathFor,
    });
    const firstIdx = src.indexOf(`/api/user/a/:x/foo`);
    const secondIdx = src.indexOf(`/api/user/b/:y/bar`);
    expect(firstIdx).toBeLessThan(secondIdx);
  });
});
