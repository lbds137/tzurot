import { describe, it, expect } from 'vitest';
import {
  SHAPES_SESSION_COOKIE_NAME,
  isShapesAllowedCookieName,
  isPlausibleShapesTokenValue,
  buildSessionCookie,
  parseShapesSessionCookieInput,
} from './shapes-import.js';

describe('SHAPES_SESSION_COOKIE_NAME', () => {
  it('is the Better Auth cookie name (case-sensitive, __Secure- prefix, dotted)', () => {
    expect(SHAPES_SESSION_COOKIE_NAME).toBe('__Secure-better-auth.session_token');
  });
});

describe('isShapesAllowedCookieName', () => {
  it('accepts the session cookie name', () => {
    expect(isShapesAllowedCookieName(SHAPES_SESSION_COOKIE_NAME)).toBe(true);
  });

  it('rejects legacy Auth0 cookie names', () => {
    expect(isShapesAllowedCookieName('appSession')).toBe(false);
    expect(isShapesAllowedCookieName('appSession.0')).toBe(false);
    expect(isShapesAllowedCookieName('appSession.1')).toBe(false);
  });

  it('rejects arbitrary analytics / WAF cookie names', () => {
    expect(isShapesAllowedCookieName('_ga')).toBe(false);
    expect(isShapesAllowedCookieName('cf_clearance')).toBe(false);
    expect(isShapesAllowedCookieName('x-datadome')).toBe(false);
  });
});

describe('buildSessionCookie', () => {
  it('prepends the cookie name to a raw token value', () => {
    expect(buildSessionCookie('abc123')).toBe(`${SHAPES_SESSION_COOKIE_NAME}=abc123`);
  });
});

describe('isPlausibleShapesTokenValue', () => {
  it('accepts a 32-char alphanumeric value (exact boundary)', () => {
    expect(isPlausibleShapesTokenValue('a'.repeat(32))).toBe(true);
  });

  it('accepts a value mixing allowed characters (letters, digits, dot, underscore, hyphen)', () => {
    expect(isPlausibleShapesTokenValue('ABC-def_123.xyz-0123456789abcdef')).toBe(true);
  });

  it('rejects a 31-char value (just under the minimum)', () => {
    expect(isPlausibleShapesTokenValue('a'.repeat(31))).toBe(false);
  });

  it('accepts a 512-char value (exact upper boundary)', () => {
    expect(isPlausibleShapesTokenValue('a'.repeat(512))).toBe(true);
  });

  it('rejects a 513-char value (just over the maximum)', () => {
    expect(isPlausibleShapesTokenValue('a'.repeat(513))).toBe(false);
  });

  it('rejects a 10,000-char pathological oversize value', () => {
    expect(isPlausibleShapesTokenValue('a'.repeat(10_000))).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isPlausibleShapesTokenValue('')).toBe(false);
  });

  it('rejects values containing spaces', () => {
    expect(isPlausibleShapesTokenValue(`${'a'.repeat(20)} ${'b'.repeat(20)}`)).toBe(false);
  });

  it('rejects values containing special characters outside the allowed set', () => {
    expect(isPlausibleShapesTokenValue(`${'a'.repeat(30)}!@`)).toBe(false);
    expect(isPlausibleShapesTokenValue(`${'a'.repeat(30)}==`)).toBe(false);
  });
});

describe('parseShapesSessionCookieInput', () => {
  // A plausible Better Auth token value — 40 chars of allowed characters.
  const validToken = 'a1b2c3d4e5f6g7h8.i9j0k1l2m3n4o5p6q7r8s9t0';
  const expectedCookie = `${SHAPES_SESSION_COOKIE_NAME}=${validToken}`;

  describe('bare token value path', () => {
    it('normalizes a bare token value to name=value form', () => {
      expect(parseShapesSessionCookieInput(validToken)).toEqual({
        ok: true,
        cookie: expectedCookie,
      });
    });

    it('trims surrounding whitespace from bare tokens', () => {
      expect(parseShapesSessionCookieInput(`   ${validToken}\n`)).toEqual({
        ok: true,
        cookie: expectedCookie,
      });
    });

    it('rejects bare values shorter than the minimum length', () => {
      expect(parseShapesSessionCookieInput('tooShort')).toEqual({
        ok: false,
        reason: 'malformed-value',
      });
    });

    it('rejects bare values containing characters outside the allowed set', () => {
      // 40 chars with a disallowed space embedded.
      const badValue = 'a1b2c3d4e5f6g7h8 i9j0k1l2m3n4o5p6q7r8s9t0';
      expect(parseShapesSessionCookieInput(badValue)).toEqual({
        ok: false,
        reason: 'malformed-value',
      });
    });
  });

  describe('single name=value pair path', () => {
    it('accepts the expected name=value pair verbatim', () => {
      expect(parseShapesSessionCookieInput(expectedCookie)).toEqual({
        ok: true,
        cookie: expectedCookie,
      });
    });

    it('rejects a name=value pair with a different cookie name', () => {
      expect(parseShapesSessionCookieInput(`appSession=${validToken}`)).toEqual({
        ok: false,
        reason: 'wrong-cookie',
      });
    });

    it('rejects name=value with an empty value', () => {
      expect(parseShapesSessionCookieInput(`${SHAPES_SESSION_COOKIE_NAME}=`)).toEqual({
        ok: false,
        reason: 'malformed-value',
      });
    });

    it('rejects name=value with a value shorter than the minimum length', () => {
      // 'tooShort' is 8 chars; the min is 32. Same regex+length guard as the
      // bare-token path must apply here so the parser's contract is uniform.
      expect(parseShapesSessionCookieInput(`${SHAPES_SESSION_COOKIE_NAME}=tooShort`)).toEqual({
        ok: false,
        reason: 'malformed-value',
      });
    });

    it('rejects name=value with a value containing disallowed characters', () => {
      // Spaces fail the token-shape regex even though the length is fine.
      expect(
        parseShapesSessionCookieInput(
          `${SHAPES_SESSION_COOKIE_NAME}=val with spaces and padding xxx`
        )
      ).toEqual({ ok: false, reason: 'malformed-value' });
    });
  });

  describe('full Cookie: header paste defense', () => {
    it('extracts the session cookie from a multi-cookie header string', () => {
      const fullHeader = `_ga=GA1.1.12345; ${SHAPES_SESSION_COOKIE_NAME}=${validToken}; theme=dark`;
      expect(parseShapesSessionCookieInput(fullHeader)).toEqual({
        ok: true,
        cookie: expectedCookie,
      });
    });

    it('handles extra whitespace around semicolons in a header paste', () => {
      const messy = `  _ga=GA1.1.12345  ;  ${SHAPES_SESSION_COOKIE_NAME}=${validToken}  ;  theme=dark `;
      expect(parseShapesSessionCookieInput(messy)).toEqual({
        ok: true,
        cookie: expectedCookie,
      });
    });

    it('rejects a multi-cookie header that lacks the session cookie name', () => {
      const wrong = '_ga=GA1.1.12345; cf_clearance=abc123; theme=dark';
      expect(parseShapesSessionCookieInput(wrong)).toEqual({
        ok: false,
        reason: 'wrong-cookie',
      });
    });

    it('rejects a legacy Auth0 cookie paste (appSession.0 + appSession.1)', () => {
      const legacy = 'appSession.0=part0value; appSession.1=part1value';
      expect(parseShapesSessionCookieInput(legacy)).toEqual({
        ok: false,
        reason: 'wrong-cookie',
      });
    });

    it('rejects a multi-cookie paste where the session cookie value itself is malformed', () => {
      // Session cookie name is present but its value has disallowed characters
      // and sub-minimum length. The multi-cookie path must apply the same
      // shape/length guard as the bare-token and name=value paths.
      const mixed = `_ga=GA1.1.12345; ${SHAPES_SESSION_COOKIE_NAME}=oops short; theme=dark`;
      expect(parseShapesSessionCookieInput(mixed)).toEqual({
        ok: false,
        reason: 'malformed-value',
      });
    });
  });

  describe('empty input', () => {
    it('rejects the empty string', () => {
      expect(parseShapesSessionCookieInput('')).toEqual({ ok: false, reason: 'empty' });
    });

    it('rejects a whitespace-only string', () => {
      expect(parseShapesSessionCookieInput('   \n\t ')).toEqual({ ok: false, reason: 'empty' });
    });
  });
});
