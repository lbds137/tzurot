/**
 * Bot-protection detection for shapes.inc responses.
 *
 * Checks a response for signals that shapes.inc has put bot-detection
 * middleware in front of the API. Vendors announce themselves in headers:
 * Cloudflare active mitigation (`cf-mitigated`), Datadome (`x-datadome*`,
 * e.g. `x-datadome-cid`), PerimeterX (`x-px*`), or an HTML block/challenge
 * page served where JSON was expected.
 *
 * Deliberately NOT a signal: `cf-ray`. It is present on every response that
 * transits Cloudflare — including perfectly healthy 200s from any CF-proxied
 * origin — so treating its presence as a block would false-positive on
 * normal traffic the moment shapes.inc fronts with Cloudflare at all. Only
 * the active-mitigation marker means a challenge fired.
 */

/** Headers whose exact presence means active bot mitigation. */
const MITIGATION_HEADERS_EXACT = ['cf-mitigated'] as const;

/**
 * Header-name prefixes for vendors that use a header FAMILY rather than one
 * fixed name (PerimeterX: x-px-block, x-pxhd, …; Datadome: x-datadome,
 * x-datadome-cid, …).
 */
const MITIGATION_HEADER_PREFIXES = ['x-px', 'x-datadome'] as const;

/**
 * Inspect a response for bot-protection signals.
 *
 * @returns a human-readable description of the detected signal, or null when
 *   the response looks like normal API traffic.
 */
export function detectBotProtection(response: Response): string | null {
  for (const header of MITIGATION_HEADERS_EXACT) {
    const value = response.headers.get(header);
    if (value !== null) {
      return `'${header}: ${value}' response header`;
    }
  }

  let familyHeader: string | null = null;
  response.headers.forEach((_value, name) => {
    const lowered = name.toLowerCase();
    if (MITIGATION_HEADER_PREFIXES.some(prefix => lowered.startsWith(prefix))) {
      familyHeader = name;
    }
  });
  if (familyHeader !== null) {
    return `'${String(familyHeader)}' response header`;
  }

  // An HTML body where JSON was expected is a challenge/block page — but ONLY
  // on responses that would otherwise read as success or an auth-shaped 403.
  // Transient 429/5xx commonly serve default HTML error pages (nginx, CDN
  // maintenance) and must keep their retryable classification; a real
  // challenge on those statuses announces itself via the vendor headers
  // above. Missing content-type stays quiet — only an explicit HTML type is
  // a signal.
  if (response.ok || response.status === 403) {
    const contentType = response.headers.get('content-type');
    if (contentType?.toLowerCase().includes('text/html') === true) {
      return `HTML response ('content-type: ${contentType}') from a JSON endpoint`;
    }
  }

  return null;
}
