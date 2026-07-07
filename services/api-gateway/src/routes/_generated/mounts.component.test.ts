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
    it('rejects unauthenticated GET /api/admin/llm-config with 403', async () => {
      const res = await request(app).get('/api/admin/llm-config');
      // 403 (not 401) — middleware is composed and rejects unauthenticated.
      expect(res.status).toBe(403);
    });

    it('rejects unauthenticated POST /api/admin/db-sync with 403', async () => {
      const res = await request(app).post('/api/admin/db-sync').send({});
      // 403 (not 401) — middleware is composed and rejects unauthenticated.
      expect(res.status).toBe(403);
    });
  });

  describe('user routes — require user auth', () => {
    it('rejects unauthenticated GET /api/user/timezone with 403', async () => {
      const res = await request(app).get('/api/user/timezone');
      // 403 (not 401) — middleware is composed and rejects unauthenticated.
      expect(res.status).toBe(403);
    });

    it('rejects unauthenticated GET /api/user/personality with 403', async () => {
      const res = await request(app).get('/api/user/personality');
      // 403 (not 401) — middleware is composed and rejects unauthenticated.
      expect(res.status).toBe(403);
    });
  });

  describe('unmounted prefixes', () => {
    it('returns 404 for unmounted paths', async () => {
      const res = await request(app).get('/some/random/path');
      expect(res.status).toBe(404);
    });
  });
});
