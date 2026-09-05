/**
 * Tests for the export ZIP helper
 */

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { zipTextFiles } from './exportZip.js';

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
