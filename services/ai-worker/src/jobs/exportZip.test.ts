/**
 * Tests for the export ZIP helper
 */

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { sanitizeFileStem, zipTextFiles } from './exportZip.js';

describe('zipTextFiles', () => {
  it('round-trips every entry name and its content', () => {
    const files = {
      'README.md': '# Hello',
      'config.json': '{"a":1}',
      'nested/path/file.md': 'nested content',
    };

    const zipped = zipTextFiles(files);
    expect(zipped).toBeInstanceOf(Uint8Array);

    const unzipped = unzipSync(zipped);
    expect(Object.keys(unzipped).sort()).toEqual(Object.keys(files).sort());
    for (const [path, content] of Object.entries(files)) {
      expect(strFromU8(unzipped[path])).toBe(content);
    }
  });

  it('produces a valid empty archive for an empty map', () => {
    const zipped = zipTextFiles({});
    expect(zipped).toBeInstanceOf(Uint8Array);

    const unzipped = unzipSync(zipped);
    expect(Object.keys(unzipped)).toHaveLength(0);
  });
});

// Mirrors accountExportManifest.test.ts's sanitizeExportFileStem cases on
// purpose — the two copies are meant to stay byte-identical, and these
// paired tests are the guard against silent divergence.
describe('sanitizeFileStem', () => {
  it('leaves word characters, dots, and hyphens untouched', () => {
    expect(sanitizeFileStem('my-persona.v2')).toBe('my-persona.v2');
  });

  it('replaces disallowed characters with underscores', () => {
    expect(sanitizeFileStem('a b/c?d')).toBe('a_b_c_d');
  });

  it('replaces every disallowed character rather than collapsing to empty', () => {
    expect(sanitizeFileStem('???')).toBe('___');
  });

  it('falls back to "unnamed" for a genuinely empty stem', () => {
    expect(sanitizeFileStem('')).toBe('unnamed');
  });
});
