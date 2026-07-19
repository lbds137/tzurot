/**
 * Structural guard: no raw gateway access in bot-client.
 *
 * The gateway base URL (`GATEWAY_URL`) must only be read by the blessed
 * transport/infra layers. Every other bot-client → gateway call MUST go through
 * the typed clients (`clientsFor` / `getServiceClient`), which attach the
 * `X-Service-Auth` header automatically. A raw `fetch(GATEWAY_URL + …)` without
 * that header is silently rejected by `requireServiceAuth` — exactly the bug
 * that left `/models` returning only the static z.ai catalog on dev.
 *
 * This test fails if any non-allow-listed source file references `GATEWAY_URL`,
 * turning the "typed clients only" doctrine in `serviceFetch.ts` into
 * enforcement. To legitimately add a reader, justify it and add it to
 * ALLOWED_RELATIVE below (the bar is the same as adding a route to the manifest:
 * the URL must be infrastructure/public-asset, not an RPC that needs auth).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__dirname, '..'); // services/bot-client/src

/**
 * Files permitted to read GATEWAY_URL, with the reason each is legitimate.
 * Paths are relative to services/bot-client/src.
 */
const ALLOWED_RELATIVE = new Set<string>([
  'index.ts', // startup wiring/logging
  'utils/serviceFetch.ts', // blessed infra fetch (/health, /metrics) — attaches X-Service-Auth
  'utils/gatewayClients.ts', // typed-client transport base URL
  'utils/gatewayServiceCalls.ts', // service-to-service calls — attaches X-Service-Auth
  'commands/character/export.ts', // builds the PUBLIC /avatars asset URL (no auth gate)
  'commands/character/viewV2.ts', // same PUBLIC /avatars asset URL, as the V2 header Thumbnail
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('gateway access guard', () => {
  it('only allow-listed transport/infra files reference GATEWAY_URL', () => {
    const offenders = walk(SRC_ROOT)
      .filter(file => readFileSync(file, 'utf-8').includes('GATEWAY_URL'))
      .map(file => relative(SRC_ROOT, file))
      .filter(rel => !ALLOWED_RELATIVE.has(rel));

    expect(
      offenders,
      `These files read GATEWAY_URL outside the transport/infra allow-list. ` +
        `Route bot-client → gateway calls through the typed clients (clientsFor / ` +
        `getServiceClient) so X-Service-Auth is attached automatically. If a reader ` +
        `is genuinely legitimate (public asset / infra path), add it to ALLOWED_RELATIVE ` +
        `with a justification. Offenders: ${offenders.join(', ')}`
    ).toEqual([]);
  });
});
