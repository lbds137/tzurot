import { describe, it, expect } from 'vitest';
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

describe('updateCookieFromResponse', () => {
  it('should return current cookie unchanged when no set-cookie headers', () => {
    const response = makeResponse([]);
    const result = updateCookieFromResponse('appSession.0=abc; appSession.1=def', response);
    expect(result).toBe('appSession.0=abc; appSession.1=def');
  });

  it('should merge new cookie values into existing cookie string', () => {
    const response = makeResponse([
      'appSession.0=new-value-0; Path=/; HttpOnly',
      'appSession.1=new-value-1; Path=/; HttpOnly',
    ]);
    const result = updateCookieFromResponse('appSession.0=old-0; appSession.1=old-1', response);
    expect(result).toContain('appSession.0=new-value-0');
    expect(result).toContain('appSession.1=new-value-1');
    expect(result).not.toContain('old-0');
    expect(result).not.toContain('old-1');
  });

  it('should preserve cookies not present in set-cookie headers', () => {
    const response = makeResponse(['appSession.0=rotated; Path=/']);
    const result = updateCookieFromResponse('appSession.0=old; otherCookie=keep-me', response);
    expect(result).toContain('appSession.0=rotated');
    expect(result).toContain('otherCookie=keep-me');
  });

  it('should add new cookies not in the original string', () => {
    const response = makeResponse(['newCookie=hello; Path=/']);
    const result = updateCookieFromResponse('appSession.0=abc', response);
    expect(result).toContain('appSession.0=abc');
    expect(result).toContain('newCookie=hello');
  });

  it('should handle empty current cookie string', () => {
    const response = makeResponse(['appSession.0=fresh; Path=/']);
    const result = updateCookieFromResponse('', response);
    expect(result).toContain('appSession.0=fresh');
  });

  it('should strip set-cookie attributes (Path, HttpOnly, etc.)', () => {
    const response = makeResponse(['token=abc123; Path=/; HttpOnly; Secure; SameSite=Lax']);
    const result = updateCookieFromResponse('', response);
    expect(result).toBe('token=abc123');
    expect(result).not.toContain('Path');
    expect(result).not.toContain('HttpOnly');
  });
});
