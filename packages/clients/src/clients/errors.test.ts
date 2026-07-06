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

    expect(parsed).toEqual({ message: 'HTTP 502' });
  });
});
