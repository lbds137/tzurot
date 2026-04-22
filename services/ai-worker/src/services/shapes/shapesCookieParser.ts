/**
 * Cookie Parser for Shapes.inc API
 *
 * Merges Set-Cookie response headers into the existing cookie jar, narrowed
 * by `isShapesAllowedCookieName`. Cookies outside the allowlist (analytics,
 * WAF routing, CSRF tokens, etc.) are discarded rather than retained in the
 * jar — mixing unrelated cookies into subsequent requests adds risk without
 * benefit.
 *
 * Under Better Auth, the session cookie rotates rarely (within a ~1-day
 * `updateAge` window inside a 7-day session), so in the common case
 * `updateCookieFromResponse` is a no-op and returns the existing cookie
 * string unchanged.
 */

import { isShapesAllowedCookieName } from '@tzurot/common-types';

/**
 * Parse Set-Cookie headers and merge allowlisted values into the existing
 * cookie string. Returns the updated cookie string containing ONLY cookies
 * that pass `isShapesAllowedCookieName`.
 *
 * @param currentCookie - The current cookie string (semicolon-delimited name=value pairs)
 * @param response - The HTTP response whose Set-Cookie headers should be merged
 * @returns The updated cookie string, filtered to the allowlist
 */
export function updateCookieFromResponse(currentCookie: string, response: Response): string {
  // Parse current jar, filtering to allowlisted names.
  const cookieMap = new Map<string, string>();
  for (const part of currentCookie.split(';')) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) {
      continue;
    }
    const name = trimmed.substring(0, eqIdx);
    if (isShapesAllowedCookieName(name)) {
      cookieMap.set(name, trimmed.substring(eqIdx + 1));
    }
  }

  // Merge allowlisted Set-Cookie entries from the response.
  const setCookieHeaders = response.headers.getSetCookie();
  for (const header of setCookieHeaders) {
    // Set-Cookie: name=value; Path=/; HttpOnly; ...
    const firstPart = header.split(';')[0].trim();
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx <= 0) {
      continue;
    }
    const name = firstPart.substring(0, eqIdx);
    if (!isShapesAllowedCookieName(name)) {
      continue;
    }
    cookieMap.set(name, firstPart.substring(eqIdx + 1));
  }

  // Rebuild the cookie string from the filtered map.
  const parts: string[] = [];
  for (const [name, value] of cookieMap) {
    parts.push(`${name}=${value}`);
  }
  return parts.join('; ');
}
