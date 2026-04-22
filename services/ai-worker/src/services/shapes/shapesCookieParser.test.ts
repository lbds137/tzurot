import { describe, it, expect } from 'vitest';
import { SHAPES_SESSION_COOKIE_NAME } from '@tzurot/common-types';
import { updateCookieFromResponse } from './shapesCookieParser.js';

/**
 * Helper to build a minimal Response with getSetCookie() support.
 */
function makeResponse(setCookieHeaders: string[]): Response {
  const headers = new Headers();
  for (const header of setCookieHeaders) {
    headers.append('set-cookie', header);
  }
  return { headers } as unknown as Response;
}

const VALID_TOKEN_A = 'token-value-a1b2c3d4e5f6g7h8i9j0';
const VALID_TOKEN_B = 'token-value-z9y8x7w6v5u4t3s2r1q0';
const INITIAL_COOKIE = `${SHAPES_SESSION_COOKIE_NAME}=${VALID_TOKEN_A}`;

describe('updateCookieFromResponse', () => {
  it('returns the current cookie unchanged when the response has no Set-Cookie headers', () => {
    const response = makeResponse([]);
    expect(updateCookieFromResponse(INITIAL_COOKIE, response)).toBe(INITIAL_COOKIE);
  });

  it('replaces the allowlisted cookie when shapes.inc rotates it', () => {
    const response = makeResponse([
      `${SHAPES_SESSION_COOKIE_NAME}=${VALID_TOKEN_B}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    ]);
    const result = updateCookieFromResponse(INITIAL_COOKIE, response);
    expect(result).toBe(`${SHAPES_SESSION_COOKIE_NAME}=${VALID_TOKEN_B}`);
    expect(result).not.toContain(VALID_TOKEN_A);
  });

  it('discards unrelated cookies served alongside the allowlisted one', () => {
    const response = makeResponse([
      '_ga=GA1.1.12345; Path=/; Domain=.shapes.inc',
      'cf_clearance=someWafToken; Path=/; Secure',
      `${SHAPES_SESSION_COOKIE_NAME}=${VALID_TOKEN_B}; Path=/; HttpOnly; Secure`,
    ]);
    const result = updateCookieFromResponse(INITIAL_COOKIE, response);
    expect(result).toBe(`${SHAPES_SESSION_COOKIE_NAME}=${VALID_TOKEN_B}`);
    expect(result).not.toContain('_ga');
    expect(result).not.toContain('cf_clearance');
  });

  it('discards a response that contains only unrelated cookies', () => {
    const response = makeResponse(['_ga=GA1.1.12345; Path=/', 'x-datadome=ddToken; Path=/']);
    const result = updateCookieFromResponse(INITIAL_COOKIE, response);
    expect(result).toBe(INITIAL_COOKIE);
  });

  it('accepts an empty initial jar and bootstraps from the response', () => {
    const response = makeResponse([
      `${SHAPES_SESSION_COOKIE_NAME}=${VALID_TOKEN_A}; Path=/; HttpOnly; Secure`,
    ]);
    expect(updateCookieFromResponse('', response)).toBe(
      `${SHAPES_SESSION_COOKIE_NAME}=${VALID_TOKEN_A}`
    );
  });

  it('strips cookie attributes (Path, HttpOnly, Expires, SameSite) from the jar', () => {
    const response = makeResponse([
      `${SHAPES_SESSION_COOKIE_NAME}=${VALID_TOKEN_A}; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; Secure; SameSite=Lax`,
    ]);
    const result = updateCookieFromResponse('', response);
    // Exact equality is the tightest check — the rebuilt jar contains ONLY `name=value`.
    // Individual `.not.toContain()` checks for attribute names would produce false
    // negatives here because the cookie name itself contains "Secure" as a substring.
    expect(result).toBe(`${SHAPES_SESSION_COOKIE_NAME}=${VALID_TOKEN_A}`);
  });

  it('drops non-allowlisted cookies that were somehow present in the initial jar', () => {
    // Defense-in-depth: even if a stale jar has extraneous entries, the parser
    // narrows them on merge rather than perpetuating them.
    const pollutedInitial = `_ga=junk; ${SHAPES_SESSION_COOKIE_NAME}=${VALID_TOKEN_A}; theme=dark`;
    const response = makeResponse([]);
    expect(updateCookieFromResponse(pollutedInitial, response)).toBe(INITIAL_COOKIE);
  });
});
