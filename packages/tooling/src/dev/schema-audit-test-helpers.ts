/**
 * Shared test helpers for the schema-audit module suite.
 *
 * `withTempDir` was previously duplicated across 5 colocated test files
 * (parser/reads/writes/suppression/entry-point). Extracted here once the
 * copy count crossed the "three similar lines is better than a premature
 * abstraction" threshold in `02-code-standards.md`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Run `fn` inside a fresh temp directory. The directory is created with
 * `mkdtempSync` and recursively removed when `fn` resolves (or throws).
 *
 * Async-safe: `fn` may return `T` or `Promise<T>`. The return value is
 * always awaited via `Promise.resolve()` so the cleanup runs after any
 * pending awaits inside the callback.
 */
export async function withTempDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'schema-audit-test-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
