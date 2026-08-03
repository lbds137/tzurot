/**
 * Integration smoke test for the generated mounts.ts.
 *
 * Doesn't exercise every individual handler — the per-route unit tests
 * already cover handler behavior. What's verified here is:
 *
 *   1. The codegen-emitted mount calls correctly wire each route at the
 *      audience prefix (`/api/internal/*`, `/api/admin/*`, `/api/user/*`).
 *   2. Audience-level middleware composes as expected: internal routes
 *      need no user auth, admin routes need owner auth, user routes need
 *      user auth.
 *
 * The structural invariant that `requireProvisionedUser` is applied
 * only to flagged routes (not all user routes) is covered by
 * `mounts-builder.test.ts` and the codegen unit tests, so it isn't
 * re-tested here.
 *
 * The tests deliberately probe with empty/bad auth headers to exercise
 * the middleware chain without needing real DB / Redis. A handful of
 * representative endpoints per audience is enough — the unit tests for
 * the codegen (`handler-paths.test.ts`, `mounts-builder.test.ts`) verify
 * the wiring is uniform.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

import { mountInternalRoutes, mountAdminRoutes, mountUserRoutes } from './mounts.js';
import type { RouteDeps } from '../routeDeps.js';

// The handlers all close over `deps.prisma`. The Prisma client isn't called
// by the auth-failure paths we're testing, so a typed-stub is enough. The two
// resolvers are compile-required on RouteDeps (type-level, not runtime) but the
// auth-failure paths never invoke them — inert stubs satisfy the wiring check.
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

describe('mounts.ts — audience-prefix routing', () => {
  let app: Express;

  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    app = buildApp();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('internal routes — no audience auth (service-auth is global)', () => {
    // Internal routes have no audience-level middleware in mounts.ts —
    // service-auth is applied globally at the app level by the eventual
    // index.ts cutover. We only verify the route is mounted at the
    // /api/internal prefix (status ≠ 404), not the handler behavior.
    it('exposes POST /api/internal/ai/generate at the expected prefix', async () => {
      // Empty body — Zod validation rejects with 400 if the handler runs.
      // Either way, ≠ 404 confirms the mount.
      const res = await request(app).post('/api/internal/ai/generate').send({});
      expect(res.status).not.toBe(404);
    });

    it('exposes GET /api/internal/admin-settings at the expected prefix', async () => {
      // The service-read alias for AdminSettings (getAdminSettingsInternal),
      // reachable without a Discord actor unlike the owner /api/admin/settings
      // route. Handler reads via prisma only (no Redis); ≠ 404 confirms the
      // mount — handler behavior is covered in admin/settings.test.ts.
      const res = await request(app).get('/api/internal/admin-settings');
      expect(res.status).not.toBe(404);
    });
  });

  describe('admin routes — require user + owner auth', () => {
    it('rejects unauthenticated GET /api/admin/llm-config with 401', async () => {
      const res = await request(app).get('/api/admin/llm-config');
      // 401 — no credentials at all is an authentication failure (the user-auth
      // middleware runs before the owner gate; an authenticated non-owner gets 403).
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated POST /api/admin/db-sync with 401', async () => {
      const res = await request(app).post('/api/admin/db-sync').send({});
      // 401 — no credentials at all is an authentication failure (the user-auth
      // middleware runs before the owner gate; an authenticated non-owner gets 403).
      expect(res.status).toBe(401);
    });
  });

  describe('user routes — require user auth', () => {
    it('rejects unauthenticated GET /api/user/timezone with 401', async () => {
      const res = await request(app).get('/api/user/timezone');
      // 401 — missing user identity is an authentication failure.
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated GET /api/user/personality with 401', async () => {
      const res = await request(app).get('/api/user/personality');
      // 401 — missing user identity is an authentication failure.
      expect(res.status).toBe(401);
    });
  });

  // The two blocks below pin per-route invariants that used to be asserted by
  // structural router-stack tests in the route files themselves. Those tests
  // inspected a pre-cutover route factory; the manifest + these mounts own the
  // wiring now, so the assertions belong here, at the level that decides it.

  describe('diagnostic routes — split across two audiences', () => {
    // The diagnostic reads are user-audience (any authenticated user, filtered
    // server-side to their own rows; the owner sees everything), while the
    // response-ids write is a service-to-service call from bot-client with no
    // human actor. Swapping those two audiences would silently either lock
    // bot-client out of the write or expose the write to any Discord user, and
    // neither shows up as a 404, so each route is probed by identity of gate.
    it.each([
      '/api/user/diagnostic/recent',
      '/api/user/diagnostic/by-message/1234567890123456789',
      '/api/user/diagnostic/by-response/1234567890123456789',
      '/api/user/diagnostic/some-request-id',
    ])('rejects unauthenticated GET %s with 401', async path => {
      const res = await request(app).get(path);
      // 401 proves requireUserAuth() is wired on the route: without it the
      // request would reach the handler and fail some other way.
      expect(res.status).toBe(401);
    });

    it('does not gate PATCH /api/internal/diagnostic/:requestId/response-ids on user auth', async () => {
      const res = await request(app)
        .patch('/api/internal/diagnostic/req-123/response-ids')
        .send({});
      // Mounted (≠ 404) and NOT behind user auth (≠ 401) — the internal
      // audience carries no user middleware; the shared service secret is
      // enforced globally in index.ts. The empty body then trips the handler's
      // own Zod parse and answers 400, which is what makes these negative
      // assertions load-bearing rather than vacuous; the 400 itself is
      // behavior covered by admin/diagnostic.test.ts, so it isn't pinned here.
      // ≠ 403 closes the remaining gate shape: an auth layer rejecting the
      // no-user call outright would break bot-client's delivery write.
      expect(res.status).not.toBe(404);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });

  describe('admin-settings — one handler, two mounts with different gates', () => {
    // handleGetAdminSettings is mounted twice on purpose: bot-client hydrates
    // its admin-settings cache at startup with no Discord actor, so the read
    // needs an ungated internal alias; the same read under /api/admin is
    // owner-only. Collapsing either mount into the other breaks one of the two
    // callers, so both halves are pinned.
    it('serves the internal read without user auth', async () => {
      const res = await request(app).get('/api/internal/admin-settings');
      // The handler is reached and dies on the inert stub prisma (500), which
      // is the proof there is no user gate in front of it — a gated route
      // would have short-circuited to 401 or 403 before touching prisma. The
      // ≠ 403 arm matters most: isAuthorizedForRead rejecting the no-userId
      // call is exactly the regression that locks bot-client out of its
      // startup cache hydration.
      expect(res.status).not.toBe(404);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('rejects the unauthenticated admin read with 401', async () => {
      const res = await request(app).get('/api/admin/settings');
      expect(res.status).toBe(401);
    });

    // A caller that presents an identity clears requireUserAuth and lands on
    // requireOwnerAuth, which answers 403 for a non-owner. Asserting both codes
    // per route is what distinguishes "user auth only" from "user + owner auth"
    // — a route missing the owner gate would answer something other than 403.
    it.each([
      { method: 'get' as const, path: '/api/admin/settings' },
      { method: 'patch' as const, path: '/api/admin/settings/config-defaults' },
      { method: 'delete' as const, path: '/api/admin/settings/config-defaults' },
    ])('gates $method $path behind user auth then owner auth', async ({ method, path }) => {
      const unauthenticated = await request(app)[method](path).send({});
      expect(unauthenticated.status).toBe(401);

      const nonOwner = await request(app)[method](path).set('X-User-Id', 'not-the-owner').send({});
      expect(nonOwner.status).toBe(403);
    });
  });

  describe('unmounted prefixes', () => {
    it('returns 404 for unmounted paths', async () => {
      const res = await request(app).get('/some/random/path');
      expect(res.status).toBe(404);
    });
  });
});
