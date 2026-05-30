/**
 * Path-contract integration test — the real-app proof that bot-client's
 * surviving hand-written gateway paths actually resolve to mounted routes.
 *
 * Most bot-client → gateway calls go through codegen'd typed clients, whose
 * paths can't drift from the mounts (same manifest source; `mounts.int.test.ts`
 * + the codegen-drift check cover those). The residual risk is the two
 * deliberately-raw calls in `gatewayServiceCalls.ts`:
 *
 *   - `POST /ai/transcribe?wait=true` — synchronous STT job-wait (240s),
 *     served by the legacy `/ai` router.
 *   - `GET /health` — public liveness probe.
 *
 * If either mount were removed (a recurrence of the bare-path 404 regression),
 * the corresponding bot-client helper would silently 404. This test boots the
 * real routers and asserts those paths resolve (status ≠ 404). It also probes
 * the new `getAdminSettingsInternal` alias mount, since that route was added by
 * this change.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

import { createAIRouter } from '../ai/index.js';
import { createHealthRouter } from '../public/health.js';
import { mountInternalRoutes } from './mounts.js';
import type { RouteDeps } from '../routeDeps.js';

// Handlers close over deps but the route-resolution probe never reaches the
// parts that touch Prisma/BullMQ — a non-404 status proves the mount exists
// regardless of whether the handler then errors on the stubbed deps.
function buildStubDeps(): RouteDeps {
  return { prisma: {} as RouteDeps['prisma'] };
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  const deps = buildStubDeps();
  app.use('/ai', createAIRouter(deps));
  app.use('/health', createHealthRouter(0));
  mountInternalRoutes(app, deps);
  return app;
}

describe('gateway path contract — surviving raw-fetch paths resolve', () => {
  let app: Express;

  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    app = buildApp();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('POST /ai/transcribe?wait=true resolves (gatewayServiceCalls.transcribe)', async () => {
    const res = await request(app).post('/ai/transcribe?wait=true').send({ attachments: [] });
    expect(res.status).not.toBe(404);
  });

  it('GET /health resolves (gatewayServiceCalls.healthCheck)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).not.toBe(404);
  });

  it('GET /api/internal/admin-settings resolves (new getAdminSettingsInternal alias)', async () => {
    const res = await request(app).get('/api/internal/admin-settings');
    expect(res.status).not.toBe(404);
  });

  it('GET /api/internal/channel/:channelId resolves (getChannelSettings)', async () => {
    const res = await request(app).get('/api/internal/channel/chan-1');
    expect(res.status).not.toBe(404);
  });
});
