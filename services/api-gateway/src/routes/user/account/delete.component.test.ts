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
});
