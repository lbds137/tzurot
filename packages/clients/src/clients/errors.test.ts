/**
 * Tests for the gateway-client error helpers.
 */

import { describe, it, expect } from 'vitest';
import { GatewayApiError, parseErrorResponse } from './errors.js';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';

describe('GatewayApiError', () => {
  it('preserves status + kind + code on construction', () => {
    const err = new GatewayApiError(
      'Persona not found',
      404,
      'http',
      API_ERROR_SUBCODE.NAME_COLLISION
    );
    expect(err.message).toBe('Persona not found');
    expect(err.status).toBe(404);
    expect(err.kind).toBe('http');
    expect(err.code).toBe('NAME_COLLISION');
    expect(err.name).toBe('GatewayApiError');
  });

  it('omits code when none provided but keeps the required kind', () => {
    const err = new GatewayApiError('Request timeout', 0, 'timeout');
    expect(err.kind).toBe('timeout');
    expect(err.code).toBeUndefined();
  });

  it('is instanceof Error so existing catch blocks still match', () => {
    const err = new GatewayApiError('msg', 400, 'http');
    expect(err instanceof Error).toBe(true);
  });
});

function jsonResponse(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('parseErrorResponse', () => {
  it('extracts message + code from a structured error body', async () => {
    const parsed = await parseErrorResponse(
      jsonResponse(
        { error: 'NAME_COLLISION', message: 'Name already in use', code: 'NAME_COLLISION' },
        409
      )
    );
    expect(parsed.message).toBe('Name already in use');
    expect(parsed.code).toBe('NAME_COLLISION');
  });

  it('prefers `message` over `error` for the human-readable text', async () => {
    const parsed = await parseErrorResponse(
      jsonResponse({ error: 'VALIDATION_ERROR', message: 'Body failed validation' }, 400)
    );
    expect(parsed.message).toBe('Body failed validation');
  });

  it('falls back to `error` when `message` is absent', async () => {
    const parsed = await parseErrorResponse(jsonResponse({ error: 'Not found' }, 404));
    expect(parsed.message).toBe('Not found');
  });

  it('falls back to `HTTP <status>` when the body has neither', async () => {
    const parsed = await parseErrorResponse(jsonResponse({}, 503));
    expect(parsed.message).toBe('HTTP 503');
  });

  it('falls back to `HTTP <status>` when the body is non-JSON', async () => {
    const response = new Response('Internal Server Error — see logs', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
    const parsed = await parseErrorResponse(response);
    expect(parsed.message).toBe('HTTP 500');
  });
});
describe('parseErrorResponse — wrong-shape JSON fallback', () => {
  it('falls back to the status-derived message when the body is JSON but not an error envelope', async () => {
    // message must be present with the WRONG TYPE — the schema is passthrough
    // with all-optional fields, so merely-unknown keys would still parse.
    const response = new Response(JSON.stringify({ message: 123 }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });

    const parsed = await parseErrorResponse(response);

    expect(parsed).toEqual({ message: 'HTTP 502', rawText: '{"message":123}' });
  });
});

describe('parseErrorResponse — raw body capture for operator logs', () => {
  it('captures the raw body of a non-JSON upstream error page', async () => {
    // The motivating case: an nginx/CDN page reaching the client as a 502. The
    // status alone can't tell an operator WHICH hop failed; the body can.
    const response = new Response('<html><body><h1>502 Bad Gateway</h1>nginx</body></html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    });

    const parsed = await parseErrorResponse(response);

    expect(parsed.message).toBe('HTTP 502');
    expect(parsed.rawText).toContain('502 Bad Gateway');
    expect(parsed.rawText).toContain('nginx');
  });

  it('omits rawText when the gateway returned its own structured error', async () => {
    // The gateway's `message` already carries the detail — duplicating the body
    // into every failed-request log line would be pure noise.
    const parsed = await parseErrorResponse(
      jsonResponse({ error: 'NOT_FOUND', message: 'Persona not found' }, 404)
    );

    expect(parsed.message).toBe('Persona not found');
    expect(parsed.rawText).toBeUndefined();
  });

  it('omits rawText for an empty body', async () => {
    const parsed = await parseErrorResponse(new Response('', { status: 401 }));

    expect(parsed).toEqual({ message: 'HTTP 401' });
  });

  it('truncates a large body rather than logging it whole', async () => {
    const parsed = await parseErrorResponse(new Response('x'.repeat(5000), { status: 500 }));

    expect(parsed.rawText).toHaveLength(512);
  });

  it('drops an orphan at the LOW end of the high-surrogate range', async () => {
    // U+10000 encodes as 𐀀 — its high half is the first high
    // surrogate, so this pins `>=` rather than `>`. A lone surrogate can't be
    // written into the body directly: the response decoder would substitute
    // U+FFFD. Only a real astral character split by OUR cut produces one.
    const body = 'x'.repeat(511) + '\u{10000}' + 'tail';
    const parsed = await parseErrorResponse(new Response(body, { status: 500 }));

    // 511, not 1: the orphan comes off the END of the cut.
    expect(parsed.rawText).toHaveLength(511);
    expect(parsed.rawText).toBe('x'.repeat(511));
  });

  it('drops an orphan at the HIGH end of the high-surrogate range', async () => {
    // U+10FC00 encodes as 􏰀 — last high surrogate, pinning `<=`.
    const body = 'x'.repeat(511) + '\u{10FC00}' + 'tail';
    const parsed = await parseErrorResponse(new Response(body, { status: 500 }));

    expect(parsed.rawText).toHaveLength(511);
  });

  it('keeps a complete surrogate pair that ends exactly at the cap', async () => {
    // The cut lands after the emoji's LOW surrogate, so nothing is orphaned and
    // the full 512 units must survive. Guards against the guard over-firing on
    // any code unit in the surrogate block.
    const body = 'x'.repeat(510) + '😀' + 'tail';
    const parsed = await parseErrorResponse(new Response(body, { status: 500 }));

    expect(parsed.rawText).toHaveLength(512);
    expect(parsed.rawText?.endsWith('😀')).toBe(true);
  });

  it('returns the status-only message when the body stream is unreadable', async () => {
    // A connection dropped mid-response: `.text()` itself rejects. The parse
    // must degrade to the status rather than propagating the throw into the
    // transport's error path (which would be reported as a network failure).
    const response = {
      status: 500,
      text: () => Promise.reject(new Error('stream closed')),
    } as unknown as Response;

    const parsed = await parseErrorResponse(response);

    expect(parsed).toEqual({ message: 'HTTP 500' });
  });
});
