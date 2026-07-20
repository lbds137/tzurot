import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { BUILDER_IMPORT_ALLOWLIST, allowlistPairCount } from './builder-import-allowlist.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('allowlist contract (shrink-only)', () => {
  it('never grows past the grandfathered ceiling', () => {
    // Shrinking (migrating a file off hand-built UI) passes without touching
    // this pin; adding a file or symbol fails it. Lower the ceiling
    // opportunistically when the count drops.
    expect(allowlistPairCount()).toBeLessThanOrEqual(84);
  });

  it('contains no stale entries — every allowlisted file still exists', () => {
    const stale = Object.keys(BUILDER_IMPORT_ALLOWLIST).filter(
      relPath => !existsSync(path.join(repoRoot, relPath))
    );
    expect(stale).toEqual([]);
  });

  it('lists every symbol set sorted and non-empty', () => {
    for (const [file, symbols] of Object.entries(BUILDER_IMPORT_ALLOWLIST)) {
      expect(symbols.length, `${file} has an empty symbol set — remove the entry`).toBeGreaterThan(
        0
      );
      expect([...symbols].sort(), `${file} symbols should stay sorted`).toEqual([...symbols]);
    }
  });
});
