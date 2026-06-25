/**
 * Cross-service contract fixtures.
 *
 * A committed JSON fixture under `fixtures/contracts/` IS the contract artifact
 * between two services that may not import each other (the depcruise
 * service-boundary rule). The PRODUCER side asserts its real output equals the
 * committed fixture (`toMatchFileSnapshot`, regenerate-on-purpose); the CONSUMER
 * side reads the SAME fixture and feeds it to its real code. Neither service
 * imports the other — they share only this data artifact via `@tzurot/test-utils`.
 *
 * Resolves relative to this module (the `loadPGliteSchema` pattern) so it works
 * whether test-utils runs from `src` (aliased) or `dist`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to a committed contract fixture under
 * `packages/test-utils/fixtures/contracts/`. `name` is the path beneath that
 * directory, e.g. `raw-assembly-inputs/base.json`.
 */
export function contractFixtureFile(name: string): string {
  return join(__dirname, '../fixtures/contracts', name);
}

/** Read + `JSON.parse` a committed contract fixture by its `name` (see above). */
export function loadContractFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(contractFixtureFile(name), 'utf-8')) as T;
}
