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

  interface CapturedEntry {
    req: {
      url: string;
      id: string | number;
      headers: Record<string, unknown>;
      remoteAddress: unknown;
    };
    res: Record<string, unknown>;
  }

  async function captureOneRequestLine(): Promise<{ output: string; entry: CapturedEntry }> {
    const { stream, lines } = createCaptureStream();
    const logger = createLogger('test', { destination: stream });

    const app = express();
    app.use(createRequestLogger(logger));
    app.get('/seam-probe', (_req, res) => {
      res.setHeader('set-cookie', `session=${RESPONSE_SENTINEL}; Path=/`);
      res.status(200).json({ ok: true });
    });

    await request(app)
      .get('/seam-probe')
      .set('x-service-auth', REQUEST_SENTINEL)
      .set('x-user-id', '278863839632818186')
      .set('x-forwarded-for', '203.0.113.7')
      .expect(200);

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

  it('does not carry response headers into the log line', async () => {
    const { output, entry } = await captureOneRequestLine();

    // The route sets a `set-cookie` carrying RESPONSE_SENTINEL. The serialized
    // `res` on this express + pino-http path holds only `statusCode`, so no
    // response header reaches the line and the cookie cannot leak. The `res`
    // sanitizer is wired through the same `createSanitizedSerializers()` call
    // as `req`; if a dependency upgrade starts including response headers,
    // this test reddens, and the already-wired arm redacts the sensitive-named
    // ones carrying a string or an array of strings.
    expect(output).not.toContain(RESPONSE_SENTINEL);
    expect(Object.keys(entry.res)).toEqual(['statusCode']);
  });
});
