/**
 * Route-level component test for the account-deletion flow over the REAL
 * mounted gateway surface (conformance harness: generated mounts, real auth
 * middleware, PGLite, mock Redis).
 *
 * This is the compensating test for the conformance registry's
 * `deleteAccount` RouteSkip: the shared sequential conformance actor can't
 * be deleted mid-run, so this suite drives the full
 * preview → token → delete handshake against its OWN harness instance and
 * parses every wire response through the declared output schemas.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import {
  ACCOUNT_DELETE_CONFIRMATION_PHRASE,
  AccountDeletePreviewResponseSchema,
  IssueAccountDeleteTokenResponseSchema,
  DeleteAccountResponseSchema,
} from '@tzurot/common-types/schemas/api/account';
import { ACCOUNT_EXPORT_SOURCE } from '@tzurot/common-types/types/account-export';
import {
  buildConformanceHarness,
  authHeaders,
  type ConformanceHarness,
} from '../../conformance/fixtures/harness.js';

describe('account deletion routes (component, real mounts over PGLite)', () => {
  let harness: ConformanceHarness;

  beforeAll(async () => {
    harness = await buildConformanceHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('403s the superuser actor at preview and token-issue (provisioned as bot owner)', async () => {
    const preview = await request(harness.app)
      .get('/api/user/account/delete/preview')
      .set(authHeaders());
    expect(preview.status).toBe(403);

    const issued = await request(harness.app)
      .post('/api/user/account/delete/token')
      .set(authHeaders())
      .send({ confirmationPhrase: ACCOUNT_DELETE_CONFIRMATION_PHRASE });
    expect(issued.status).toBe(403);
  });

  it('walks the full preview → token → delete handshake with schema-valid responses', async () => {
    // The harness actor doubles as the bot owner, so provisioning marked it
    // superuser; clear the flag to exercise the ordinary-user path.
    await harness.ctx.prisma.user.update({
      where: { id: harness.ctx.actorUserId },
      data: { isSuperuser: false },
    });

    const preview = await request(harness.app)
      .get('/api/user/account/delete/preview')
      .set(authHeaders());
    expect(preview.status).toBe(200);
    const parsedPreview = AccountDeletePreviewResponseSchema.parse(preview.body);
    expect(parsedPreview.confirmationPhrase).toBe(ACCOUNT_DELETE_CONFIRMATION_PHRASE);

    // Wrong phrase never mints a token.
    const wrongPhrase = await request(harness.app)
      .post('/api/user/account/delete/token')
      .set(authHeaders())
      .send({ confirmationPhrase: 'delete my stuff' });
    expect(wrongPhrase.status).toBe(400);

    // Case-insensitive match mints one (proves the server-side compare).
    const issued = await request(harness.app)
      .post('/api/user/account/delete/token')
      .set(authHeaders())
      .send({ confirmationPhrase: 'delete my account' });
    expect(issued.status).toBe(200);
    const { deleteToken } = IssueAccountDeleteTokenResponseSchema.parse(issued.body);

    const deleted = await request(harness.app)
      .post('/api/user/account/delete')
      .set(authHeaders())
      .send({ deleteToken });
    expect(deleted.status).toBe(200);
    const parsedDelete = DeleteAccountResponseSchema.parse(deleted.body);
    expect(parsedDelete.success).toBe(true);

    // The account row is really gone.
    expect(
      await harness.ctx.prisma.user.findUnique({ where: { id: harness.ctx.actorUserId } })
    ).toBeNull();

    // Replaying the consumed token fails: single-use. (The middleware
    // re-provisions a fresh account for the request, which is also the
    // "next contact auto-provisions" behavior users are promised — the
    // token peek rejects before any superuser consideration.)
    const replay = await request(harness.app)
      .post('/api/user/account/delete')
      .set(authHeaders())
      .send({ deleteToken });
    expect(replay.status).toBe(400);
  });

  it('re-provisions after deletion so the next FK-keyed write does not P2003 (regression)', async () => {
    // The bug this whole PR fixes, driven through the REAL shared UserService
    // the middleware reads. UserService caches `discordId → {userId}` (the
    // userId is deterministic on discordId) and reads it BEFORE the DB.
    // Deletion removes the users row; without eviction the next request reads
    // the stale cache, gets the deterministic userId back WITHOUT re-creating
    // the row, and the first FK-keyed write against it — the export_jobs
    // insert (the runtime-confirmed P2003) — violates the FK. The delete
    // route's synchronous invalidateUser is what forces the re-create.

    // Warm the provisioning cache (this authed read provisions the actor).
    await request(harness.app).get('/api/user/account/export/status').set(authHeaders());
    const before = await harness.ctx.prisma.user.findUniqueOrThrow({
      where: { discordId: harness.ctx.actorDiscordId },
    });
    // The re-provisioned actor is the bot owner, hence superuser; clear it so
    // the delete handshake (which blocks superusers) can run.
    await harness.ctx.prisma.user.update({
      where: { id: before.id },
      data: { isSuperuser: false },
    });

    const issued = await request(harness.app)
      .post('/api/user/account/delete/token')
      .set(authHeaders())
      .send({ confirmationPhrase: 'delete my account' });
    const { deleteToken } = IssueAccountDeleteTokenResponseSchema.parse(issued.body);
    const deleted = await request(harness.app)
      .post('/api/user/account/delete')
      .set(authHeaders())
      .send({ deleteToken });
    expect(deleted.status).toBe(200);
    // The row is really gone (and the deterministic id would collide on any
    // stale-cache write until the row is re-created).
    expect(await harness.ctx.prisma.user.findUnique({ where: { id: before.id } })).toBeNull();

    // The FK-keyed write that reproduced the P2003. A stale cache returns the
    // deterministic userId for a row that no longer exists → 500; the eviction
    // makes the middleware re-create the row first, so the insert lands (202).
    const exported = await request(harness.app)
      .post('/api/user/account/export')
      .set(authHeaders())
      .send({});
    expect(exported.status).toBe(202);

    // Re-creation is what the eviction bought us: the users row exists again…
    expect(await harness.ctx.prisma.user.findUnique({ where: { id: before.id } })).not.toBeNull();
    // …and the export_jobs row landed against it (the write that used to fail).
    expect(
      await harness.ctx.prisma.exportJob.findFirst({
        where: { userId: before.id, sourceService: ACCOUNT_EXPORT_SOURCE },
      })
    ).not.toBeNull();
  });
});
