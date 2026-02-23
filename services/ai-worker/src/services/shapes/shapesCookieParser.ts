/**
 * Cookie Parser for Shapes.inc API
 *
 * Shapes.inc rotates the appSession cookie on every API call. This module
 * parses set-cookie response headers and merges them into the existing
 * cookie string, keeping the cookie jar up to date across requests.
 */

/**
 * Parse set-cookie headers and merge fresh session values into the existing
 * cookie string. Returns the updated cookie string.
 *
 * @param currentCookie - The current cookie string (semicolon-delimited key=value pairs)
 * @param response - The HTTP response whose set-cookie headers should be merged
 * @returns The updated cookie string with any rotated values applied
 */
export function updateCookieFromResponse(currentCookie: string, response: Response): string {
  const setCookieHeaders = response.headers.getSetCookie();
  if (setCookieHeaders.length === 0) {
    return currentCookie;
  }

  // Parse current cookies into a map
  const cookieMap = new Map<string, string>();
  for (const part of currentCookie.split(';')) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      cookieMap.set(trimmed.substring(0, eqIdx), trimmed.substring(eqIdx + 1));
    }
  }

  // Update with new cookies from response
  for (const header of setCookieHeaders) {
    // set-cookie: name=value; Path=/; ...
    const cookiePart = header.split(';')[0].trim();
    const eqIdx = cookiePart.indexOf('=');
    if (eqIdx > 0) {
      const name = cookiePart.substring(0, eqIdx);
      const value = cookiePart.substring(eqIdx + 1);
      cookieMap.set(name, value);
    }
  }

  // Rebuild cookie string
  const parts: string[] = [];
  for (const [name, value] of cookieMap) {
    parts.push(`${name}=${value}`);
  }
  return parts.join('; ');
}
