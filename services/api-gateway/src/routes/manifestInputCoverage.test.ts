/**
 * Drift guard: every manifest route (user, internal, or admin) that declares
 * a `query` schema must be enforced by `withManifestInput` at mount time.
 *
 * The manifest is the intended single definition of what a route accepts,
 * but nothing stops a handler conversion from being missed or reverted —
 * this test walks the ACTUAL mounted Express router (not the source files)
 * and asserts each query-declaring route's handler is tagged with its own
 * manifest id. `PENDING` is the sanctioned exception list; a route leaves it
 * only by being wrapped, never joins it after the fact.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import express, { type Express } from 'express';
import { userRoutes, internalRoutes, adminRoutes, type RouteDef } from '@tzurot/clients';
import { mountInternalRoutes, mountAdminRoutes, mountUserRoutes } from './_generated/mounts.js';
import { getManifestValidatedRouteId } from '../utils/manifestInput.js';
import type { RouteDeps } from './routeDeps.js';

// The handlers all close over `deps.prisma`. The Prisma client isn't called
// while mounting or by the id-tagging we inspect here, so a typed stub is
// enough. Mirrors mounts.component.test.ts's buildStubDeps.
function buildStubDeps(): RouteDeps {
  return {
    prisma: {} as RouteDeps['prisma'],
    cascadeResolver: {} as NonNullable<RouteDeps['cascadeResolver']>,
    llmConfigResolver: {} as NonNullable<RouteDeps['llmConfigResolver']>,
  };
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  const deps = buildStubDeps();
  mountInternalRoutes(app, deps);
  mountAdminRoutes(app, deps);
  mountUserRoutes(app, deps);
  return app;
}

/** Minimal shape of an Express route layer — probed against Express 5.2.1's
 *  `app.router.stack`: each mounted route is one layer with a `.route`
 *  carrying `.path`, `.methods` (e.g. `{ get: true }`), and `.stack`, whose
 *  LAST entry's `.handle` is the final registered handler (earlier entries
 *  are the audience/provisioning middleware). */
interface ExpressRouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: unknown }[];
  };
}

/** Index every mounted route by `${method} ${path}` → its final handler. */
function indexMountedHandlers(app: Express): Map<string, unknown> {
  const index = new Map<string, unknown>();
  const stack = (app as unknown as { router: { stack: ExpressRouteLayer[] } }).router.stack;
  for (const layer of stack) {
    const route = layer.route;
    if (route === undefined) {
      continue;
    }
    const handle = route.stack[route.stack.length - 1].handle;
    for (const method of Object.keys(route.methods)) {
      index.set(`${method} ${route.path}`, handle);
    }
  }
  return index;
}

/** Codegen prepends `/api/{audience}` to every route's mount path (types.ts). */
function mountKeyFor(route: RouteDef): string {
  return `${route.method} /api/${route.audience}${route.path}`;
}

describe('manifest query-schema enforcement coverage (drift guard)', () => {
  const guardedRoutes = (
    [
      ...Object.values(userRoutes),
      ...Object.values(internalRoutes),
      ...Object.values(adminRoutes),
    ] as RouteDef[]
  ).filter(route => route.query !== undefined);

  /**
   * Routes whose manifest `query` schema is not yet enforced by
   * `withManifestInput`. Empty: every query-declaring route across all three
   * audiences is now wrapped. A route leaves this set only by being wrapped,
   * the "pending" test below fails the moment that happens, forcing the
   * removal — and it never regains an entry once emptied. Never add an id
   * here for a newly-declared query schema; a new route ships
   * already-enforced.
   */
  const PENDING = new Set<string>([]);

  it('positive control: the derived guarded set is non-trivial and spans all three audiences', () => {
    const ids = guardedRoutes.map(route => route.id);
    expect(ids).toContain('listFacts');
    expect(ids).toContain('getVoiceResolution');
    expect(ids).toContain('getRecentDiagnostics');
    expect(ids).not.toContain('getFact');
    expect(ids).toContain('lookupPersonalityFromMessage');
    expect(ids).toContain('getAdminUsageStats');
    expect(guardedRoutes.length).toBeGreaterThanOrEqual(20);
  });

  describe('enforced routes', () => {
    let mountedHandlers: Map<string, unknown>;

    beforeAll(() => {
      mountedHandlers = indexMountedHandlers(buildApp());
    });

    it.each(guardedRoutes.filter(route => !PENDING.has(route.id)))(
      '$id is mounted and wrapped with ITS OWN manifest entry',
      route => {
        const key = mountKeyFor(route);
        const handle = mountedHandlers.get(key);
        expect(handle, `no handler mounted at ${key}`).toBeDefined();
        expect(getManifestValidatedRouteId(handle)).toBe(route.id);
      }
    );

    it.each(guardedRoutes.filter(route => PENDING.has(route.id)))(
      '$id is mounted but still pending manifest-input enforcement',
      route => {
        const key = mountKeyFor(route);
        const handle = mountedHandlers.get(key);
        expect(handle, `no handler mounted at ${key}`).toBeDefined();
        expect(
          getManifestValidatedRouteId(handle),
          `${route.id} is now wrapped with withManifestInput — remove it from PENDING`
        ).toBeUndefined();
      }
    );
  });

  it('every PENDING id is still a query-declaring route', () => {
    const guardedIds = new Set(guardedRoutes.map(route => route.id));
    for (const id of PENDING) {
      expect(guardedIds.has(id), `${id} in PENDING is not a query-declaring route`).toBe(true);
    }
  });
});
