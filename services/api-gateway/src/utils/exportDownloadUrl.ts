/**
 * Public export-download URL builder.
 *
 * Extracted from the near-identical `resolveBaseUrl` + download-URL template
 * duplicated between `user/account/export.ts` and `user/shapes/export.ts`.
 * Both call sites now go through this module so the base-URL resolution and
 * the `encodeURIComponent` SSRF guard on the token live in exactly one
 * place.
 *
 * No module-level memoization here (both duplicated originals cached the
 * resolved base URL in a module-level variable): reading env config is
 * cheap, env vars don't change at runtime, and a plain function is
 * trivially testable without a `__resetForTesting` escape hatch.
 */

import { getConfig } from '@tzurot/common-types/config/config';

/** The public gateway origin, falling back to the internal `GATEWAY_URL`. */
export function resolveExportBaseUrl(): string {
  const envConfig = getConfig();
  return envConfig.PUBLIC_GATEWAY_URL ?? envConfig.GATEWAY_URL ?? '';
}

/**
 * Builds the public download URL for an export's token. `encodeURIComponent`
 * is an SSRF guard, not cosmetic — the token is user/system data reaching a
 * URL path segment.
 */
export function buildExportDownloadUrl(token: string): string {
  return `${resolveExportBaseUrl()}/exports/${encodeURIComponent(token)}`;
}
