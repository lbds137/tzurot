/**
 * Component Test: admin system-settings routes over a REAL Prisma client (PGLite).
 *
 * Exists to pin the optimistic-concurrency round-trip against Prisma's actual
 * `@updatedAt` semantics — a mocked-prisma unit test cannot observe whether an
 * internal read bumps the token and self-defeats the conditional write (the
 * "mocked seam" gap in 02-code-standards rule 7). The GET → PATCH flow here is
 * exactly what the slash setter does in production.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createTestPGlite, loadPGliteSchema } from '@tzurot/test-utils';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import { handleGetSystemSettings, handleUpdateSystemSettings } from './systemSettings.js';
import type { RouteDeps } from '../routeDeps.js';

describe('Admin System Settings Routes (component)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;
  let app: express.Express;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) });

    const deps = { prisma, cascadeResolver: {} as never } as unknown as RouteDeps;
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as express.Request & { userId: string }).userId = '278863839632818186';
      next();
    });
    app.get('/system', handleGetSystemSettings(deps));
    app.patch('/system', handleUpdateSystemSettings(deps));
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  beforeEach(async () => {
    await prisma.adminSettings.deleteMany();
    await prisma.adminSettings.create({
      data: {
        id: ADMIN_SETTINGS_SINGLETON_ID,
        systemSettings: { zaiHeadroomPercent: 75, futureKey: 'preserved' },
      },
    });
  });

  it('GET → PATCH with the returned token succeeds (the token must survive reads)', async () => {
    const read = await request(app).get('/system');
    expect(read.status).toBe(200);

    const write = await request(app)
      .patch('/system')
      .send({
        expectedUpdatedAt: read.body.updatedAt,
        patch: { zaiHeadroomPercent: 50 },
      });

    expect(write.status).toBe(200);
    expect(write.body.systemSettings.zaiHeadroomPercent).toBe(50);
  });

  it('a second GET does not advance the token (reads are side-effect-free)', async () => {
    const first = await request(app).get('/system');
    const second = await request(app).get('/system');
    expect(second.body.updatedAt).toBe(first.body.updatedAt);
  });

  it('a stale token is rejected with 409 (real conditional write)', async () => {
    const read = await request(app).get('/system');

    const winner = await request(app)
      .patch('/system')
      .send({ expectedUpdatedAt: read.body.updatedAt, patch: { extractionEnabled: true } });
    expect(winner.status).toBe(200);

    const loser = await request(app)
      .patch('/system')
      .send({ expectedUpdatedAt: read.body.updatedAt, patch: { extractionEnabled: false } });
    expect(loser.status).toBe(409);
  });

  it('unknown keys survive a real JSONB merge round-trip', async () => {
    const read = await request(app).get('/system');
    await request(app)
      .patch('/system')
      .send({ expectedUpdatedAt: read.body.updatedAt, patch: { zaiHeadroomPercent: 40 } });

    const after = await request(app).get('/system');
    expect(after.body.systemSettings).toMatchObject({
      zaiHeadroomPercent: 40,
      futureKey: 'preserved',
    });
  });

  it('a malformed concurrency token is a clean 400, not a 500', async () => {
    const res = await request(app)
      .patch('/system')
      .send({ expectedUpdatedAt: 'not-a-date', patch: { zaiHeadroomPercent: 50 } });

    expect(res.status).toBe(400);
  });
});
