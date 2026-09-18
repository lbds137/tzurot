/**
 * Seam test for the request-logging middleware.
 *
 * Runs the REAL `createLogger` + the REAL pino-http chain end to end — no
 * mocking of either side — because this is the only test that would catch a
 * wrong redaction mechanism (e.g. relying on the parent logger's
 * `formatters.log`, which pino-http's child-binding request never reaches).
 */
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { createRequestLogger } from './requestLogger.js';

function createCaptureStream(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      lines.push(chunk.toString().trim());
      callback();
    },
  });
  return { stream, lines };
}

async function waitForLine(lines: string[]): Promise<void> {
  // pino-http logs on response finish, which can land just after supertest
  // resolves. Poll with vitest's built-in retry (real wall-clock wait, no
  // fake timers) instead of a literal setTimeout delay, which
  // `no-restricted-syntax` bans in unit tests.
  await expect.poll(() => lines.length, { timeout: 500, interval: 10 }).toBeGreaterThan(0);
}

describe('createRequestLogger seam', () => {
  const REQUEST_SENTINEL = 'a'.repeat(64);
  const RESPONSE_SENTINEL = 'b'.repeat(64);
  const FILENAME_SENTINEL = 'qx_canary_user_7f3a2b';

  interface CapturedEntry {
    req: {
      url: string;
      id: string | number;
      headers: Record<string, unknown>;
      remoteAddress: unknown;
    };
    res: Record<string, unknown>;
  }

  async function captureOneRequestLine(
    options: { status?: number; requestPath?: string } = {}
  ): Promise<{ output: string; entry: CapturedEntry }> {
    const { status = 200, requestPath } = options;
    const { stream, lines } = createCaptureStream();
    const logger = createLogger('test', { destination: stream });

    const app = express();
    app.use(createRequestLogger(logger));
    // Express matches the route by path, ignoring any query string, so a
    // `requestPath` carrying `?...` still lands on this same route.
    app.get('/seam-probe', (_req, res) => {
      res.setHeader('set-cookie', `session=${RESPONSE_SENTINEL}; Path=/`);
      const exportName = `tzurot-account-export-${FILENAME_SENTINEL}-2026-01-01.zip`;
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${exportName}"; filename*=UTF-8''${exportName}`
      );
      res.status(status).json({ ok: true });
    });

    await request(app)
      .get(requestPath ?? '/seam-probe')
      .set('x-service-auth', REQUEST_SENTINEL)
      .set('x-user-id', '278863839632818186')
      .set('x-forwarded-for', '203.0.113.7')
      .expect(status);

    await waitForLine(lines);

    return { output: lines.join('\n'), entry: JSON.parse(lines[0]) as CapturedEntry };
  }

  it('redacts x-service-auth from the real pino-http request log without blanking ids', async () => {
    const { output, entry } = await captureOneRequestLine();

    // Load-bearing: the internal service secret must never reach a log line.
    expect(output).not.toContain(REQUEST_SENTINEL);
    expect(output).toContain('[REDACTED]');
    // The client IP set via x-forwarded-for must never reach a log line either.
    expect(output).not.toContain('203.0.113.7');

    expect(entry.req.headers['x-service-auth']).toBe('[REDACTED]');
    expect(entry.req.url).toBe('/seam-probe');
    expect(entry.req.id).toBeDefined();
    expect(entry.req.headers['x-user-id']).toBe('278863839632818186');
    expect(entry.req.headers['x-forwarded-for']).toBe('[REDACTED]');
    // supertest connects over loopback, so pino-std-serializers DOES populate
    // remoteAddress on this path — assert it is present AND redacted, not
    // merely absent, so the redaction arm is actually exercised.
    expect(entry.req.remoteAddress).toBe('[REDACTED]');
  });

  it('carries the real status and the response headers, with set-cookie redacted', async () => {
    const { output, entry } = await captureOneRequestLine();

    expect(entry.res.statusCode).toBe(200);
    // Membership, not just presence — a third key here reddens this
    // assertion, catching an unexpected addition to the serialized `res`.
    expect(Object.keys(entry.res).sort()).toEqual(['headers', 'statusCode']);

    const headers = entry.res.headers as Record<string, unknown>;
    // Present AND redacted, not merely absent — absence alone would not prove
    // the redaction arm ran; it could just mean the header never reached
    // this object at all.
    expect(headers['set-cookie']).toBe('[REDACTED]');
    expect(output).not.toContain(RESPONSE_SENTINEL);

    // A non-sensitive response header must survive untouched, proving the
    // arm is selective rather than blanking the whole headers map.
    expect(headers['content-type']).toContain('application/json');
  });

  it('redacts a content-disposition carrying the account-export filename', async () => {
    const { output, entry } = await captureOneRequestLine();

    // The export filename embeds the Discord username, which is banned from
    // logs. Present AND redacted — absence alone would not prove the arm ran,
    // it could just mean the header never reached this object.
    const headers = entry.res.headers as Record<string, unknown>;
    expect(headers['content-disposition']).toBe('[REDACTED]');
    // Both the `filename=` and `filename*=UTF-8''` forms carry the sentinel,
    // so a partial redaction of either form still reddens this.
    expect(output).not.toContain(FILENAME_SENTINEL);
  });

  it('carries the real status for a 4xx response', async () => {
    const { entry } = await captureOneRequestLine({ status: 418 });

    expect(entry.res.statusCode).toBe(418);
  });

  it('redacts a sensitive query parameter value while preserving a non-sensitive sibling', async () => {
    const secret = 'canary-india-0009';
    const { output, entry } = await captureOneRequestLine({
      requestPath: `/seam-probe?token=${secret}&limit=25`,
    });

    expect(output).not.toContain(secret);
    expect(entry.req.url).toContain('/seam-probe');
    expect(entry.req.url).toContain('limit=25');
    expect(entry.req.url).toContain('token=[REDACTED]');
  });
});
