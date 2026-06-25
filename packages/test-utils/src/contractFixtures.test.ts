import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { contractFixtureFile } from './contractFixtures.js';

describe('contractFixtureFile', () => {
  it('resolves an absolute path to a real committed fixture', () => {
    const p = contractFixtureFile('raw-assembly-inputs/base.json');
    expect(p.endsWith('fixtures/contracts/raw-assembly-inputs/base.json')).toBe(true);
    // Absolute (resolved from this module via import.meta.url), and the file is
    // actually there — catches a `../fixtures/` path-resolution regression.
    expect(isAbsolute(p)).toBe(true);
    expect(existsSync(p)).toBe(true);
  });
});
