import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { contractFixtureFile, loadContractFixture } from './contractFixtures.js';

describe('contractFixtureFile', () => {
  it('resolves an absolute path to a real committed fixture', () => {
    const p = contractFixtureFile('raw-assembly-inputs/base.json');
    expect(p.endsWith('fixtures/contracts/raw-assembly-inputs/base.json')).toBe(true);
    // Absolute (resolved from this module via import.meta.url), and the file is
    // actually there — catches a `../fixtures/` path-resolution regression.
    expect(isAbsolute(p)).toBe(true);
    expect(existsSync(p)).toBe(true);
  });

  it('rejects a path-traversal name (`..` or leading `/`)', () => {
    expect(() => contractFixtureFile('../../etc/passwd')).toThrow(/path traversal/);
    expect(() => contractFixtureFile('/etc/passwd')).toThrow(/path traversal/);
  });
});

describe('loadContractFixture', () => {
  it('reads + JSON.parses a committed fixture', () => {
    const fixture = loadContractFixture<{ rawMessageContent: string }>(
      'raw-assembly-inputs/base.json'
    );
    expect(fixture.rawMessageContent).toBeTypeOf('string');
  });

  it('propagates the path-traversal guard from contractFixtureFile', () => {
    expect(() => loadContractFixture('../../secret.json')).toThrow(/path traversal/);
  });
});
