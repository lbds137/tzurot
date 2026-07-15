import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { StatusCodes } from 'http-status-codes';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Queue } from 'bullmq';

const SECRET = 'webhook-test-secret';

const configMock = vi.hoisted(() => ({
  value: { GITHUB_WEBHOOK_SECRET: 'webhook-test-secret' as string | undefined },
}));
vi.mock('@tzurot/common-types/config/config', () => ({
  getConfig: () => configMock.value,
}));

const announceMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/releaseAnnounce.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/releaseAnnounce.js')>(
    '../../services/releaseAnnounce.js'
  );
  return { ...actual, announceGitHubRelease: announceMock };
});

import { createGitHubReleaseWebhookRouter } from './githubWebhook.js';

const prisma = {} as PrismaClient;
const queue = {} as Queue;

function makeApp(deps?: { queueUndefined?: boolean; skipRawMount?: boolean }): express.Express {
  const app = express();
  if (deps?.skipRawMount !== true) {
    // Mirrors the real main() wiring: raw wins the stream for this prefix.
    app.use('/webhooks/github', express.raw({ type: 'application/json', limit: '1mb' }));
  }
  app.use(express.json());
  app.use(
    '/webhooks/github',
    createGitHubReleaseWebhookRouter({
      prisma,
      releaseBroadcastQueue: deps?.queueUndefined === true ? undefined : queue,
    })
  );
  return app;
}

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(Buffer.from(body)).digest('hex')}`;
}

const RELEASE_PAYLOAD = JSON.stringify({
  action: 'published',
  release: {
    id: 1234,
    tag_name: 'v3.0.0-beta.166',
    name: 'v3.0.0-beta.166',
    body: '### Features\n- thing',
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/lbds137/tzurot/releases/tag/v3.0.0-beta.166',
    published_at: '2026-07-15T04:00:00Z',
  },
});

function post(app: express.Express, body: string, headers: Record<string, string>) {
  let req = request(app).post('/webhooks/github/release').set('content-type', 'application/json');
  for (const [key, value] of Object.entries(headers)) {
    req = req.set(key, value);
  }
  return req.send(body);
}

describe('POST /webhooks/github/release', () => {
  beforeEach(() => {
    announceMock.mockReset();
    configMock.value = { GITHUB_WEBHOOK_SECRET: SECRET };
  });

  it('503s when the secret is unset (fail closed, no signature math)', async () => {
    configMock.value = { GITHUB_WEBHOOK_SECRET: undefined };
    const res = await post(makeApp(), RELEASE_PAYLOAD, {
      'x-hub-signature-256': sign(RELEASE_PAYLOAD),
      'x-github-event': 'release',
    });
    expect(res.status).toBe(StatusCodes.SERVICE_UNAVAILABLE);
  });

  it('503s when the broadcast queue dependency is missing', async () => {
    const res = await post(makeApp({ queueUndefined: true }), RELEASE_PAYLOAD, {
      'x-hub-signature-256': sign(RELEASE_PAYLOAD),
      'x-github-event': 'release',
    });
    expect(res.status).toBe(StatusCodes.SERVICE_UNAVAILABLE);
  });

  it('401s a wrong-secret signature and a missing signature', async () => {
    const bad = await post(makeApp(), RELEASE_PAYLOAD, {
      'x-hub-signature-256': sign(RELEASE_PAYLOAD, 'not-the-secret'),
      'x-github-event': 'release',
    });
    expect(bad.status).toBe(StatusCodes.UNAUTHORIZED);

    const missing = await post(makeApp(), RELEASE_PAYLOAD, { 'x-github-event': 'release' });
    expect(missing.status).toBe(StatusCodes.UNAUTHORIZED);
    expect(announceMock).not.toHaveBeenCalled();
  });

  it('200-ignores the ping event GitHub sends at webhook creation', async () => {
    const body = JSON.stringify({ zen: 'Design for failure.' });
    const res = await post(makeApp(), body, {
      'x-hub-signature-256': sign(body),
      'x-github-event': 'ping',
    });
    expect(res.status).toBe(StatusCodes.OK);
    expect(res.body.status).toBe('ignored');
    expect(announceMock).not.toHaveBeenCalled();
  });

  it('200-ignores non-published release actions (the demote-previous edit)', async () => {
    const body = JSON.stringify({ ...JSON.parse(RELEASE_PAYLOAD), action: 'edited' });
    const res = await post(makeApp(), body, {
      'x-hub-signature-256': sign(body),
      'x-github-event': 'release',
    });
    expect(res.status).toBe(StatusCodes.OK);
    expect(res.body).toEqual({ status: 'ignored', reason: 'action:edited' });
    expect(announceMock).not.toHaveBeenCalled();
  });

  it('announces a published release and passes the parsed release across the seam', async () => {
    announceMock.mockResolvedValue({
      status: 'announced',
      version: 'v3.0.0-beta.166',
      level: 'minor',
      recipients: 12,
      batches: 1,
    });
    const res = await post(makeApp(), RELEASE_PAYLOAD, {
      'x-hub-signature-256': sign(RELEASE_PAYLOAD),
      'x-github-event': 'release',
    });
    expect(res.status).toBe(StatusCodes.OK);
    expect(res.body.status).toBe('announced');
    expect(announceMock).toHaveBeenCalledWith(
      { prisma, queue },
      expect.objectContaining({ tag_name: 'v3.0.0-beta.166', id: 1234, prerelease: false })
    );
  });

  it('resolves a verified replay as 200 already-announced (hook stays green)', async () => {
    announceMock.mockResolvedValue({ status: 'already-announced', version: 'v3.0.0-beta.166' });
    const res = await post(makeApp(), RELEASE_PAYLOAD, {
      'x-hub-signature-256': sign(RELEASE_PAYLOAD),
      'x-github-event': 'release',
    });
    expect(res.status).toBe(StatusCodes.OK);
    expect(res.body.status).toBe('already-announced');
  });

  it('400s signed-but-malformed JSON and a wrong payload shape', async () => {
    const garbage = 'not json at all';
    const malformed = await post(makeApp(), garbage, {
      'x-hub-signature-256': sign(garbage),
      'x-github-event': 'release',
    });
    expect(malformed.status).toBe(StatusCodes.BAD_REQUEST);

    const wrongShape = JSON.stringify({ action: 'published' });
    const shapeless = await post(makeApp(), wrongShape, {
      'x-hub-signature-256': sign(wrongShape),
      'x-github-event': 'release',
    });
    expect(shapeless.status).toBe(StatusCodes.BAD_REQUEST);
  });

  it('500s loudly when the raw mount is missing and the body arrived parsed', async () => {
    const res = await post(makeApp({ skipRawMount: true }), RELEASE_PAYLOAD, {
      'x-hub-signature-256': sign(RELEASE_PAYLOAD),
      'x-github-event': 'release',
    });
    expect(res.status).toBe(StatusCodes.INTERNAL_SERVER_ERROR);
  });
});
