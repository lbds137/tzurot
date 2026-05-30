import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Structural guard against a bug class: a hand-written `fetch()` to a gateway
 * URL whose path drifts out of sync with the gateway's actual mounts (e.g. a
 * bare `/admin/*` path after the route moved to `/api/internal/*`), producing
 * silent 404s that no isolated unit test catches.
 *
 * The sanctioned way to call the gateway is the codegen'd typed clients
 * (`ServiceClient`/`UserClient`/`OwnerClient`), whose paths are generated from
 * the same route manifest as the server mounts and therefore cannot drift.
 * This test fails if a NEW raw `fetch(`${...GATEWAY_URL}...`)` appears in
 * bot-client source — forcing the author to either use a typed client or
 * justify the exception with an explicit `raw-fetch-allowed:` marker comment.
 *
 * The only blessed exceptions are the long-poll / non-API endpoints in
 * `gatewayServiceCalls.ts` (synchronous `transcribe` job-wait, public `/health`
 * probe), each annotated at its fetch site.
 */

const SRC_ROOT = resolve(fileURLToPath(import.meta.url), '../..');

// Matches `fetch(`${...GATEWAY_URL...}` — a raw fetch whose first
// template-literal segment interpolates the gateway base URL.
const RAW_GATEWAY_FETCH = /fetch\(`\$\{[^}]*GATEWAY_URL[^}]*\}/;
const ALLOW_MARKER = 'raw-fetch-allowed:';
// How many lines above the fetch the marker comment may sit.
const MARKER_LOOKBACK = 4;

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (full.endsWith('.ts') && !full.endsWith('.test.ts') && !full.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('raw gateway fetch guard', () => {
  it('every raw GATEWAY_URL fetch in bot-client is explicitly allow-listed', () => {
    const offenders: string[] = [];

    for (const file of collectSourceFiles(SRC_ROOT)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!RAW_GATEWAY_FETCH.test(line)) {
          return;
        }
        const windowStart = Math.max(0, i - MARKER_LOOKBACK);
        const hasMarker = lines.slice(windowStart, i + 1).some(l => l.includes(ALLOW_MARKER));
        if (!hasMarker) {
          offenders.push(`${file.replace(SRC_ROOT, 'src')}:${i + 1}`);
        }
      });
    }

    expect(
      offenders,
      `Unmarked raw gateway fetch(es) found. Use a typed client (ServiceClient/UserClient/` +
        `OwnerClient) instead, or justify with a "raw-fetch-allowed:" comment:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('detects the two known allow-listed exceptions (sanity check on the matcher)', () => {
    // Confidence check: the matcher actually fires on the real raw fetches —
    // otherwise the guard above would be a no-op that always passes.
    const calls = collectSourceFiles(SRC_ROOT)
      .flatMap(file => readFileSync(file, 'utf8').split('\n'))
      .filter(line => RAW_GATEWAY_FETCH.test(line));
    // transcribe + healthCheck in gatewayServiceCalls.ts.
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
});
