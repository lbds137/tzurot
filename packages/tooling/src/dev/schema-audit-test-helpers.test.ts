/**
 * Tests for the shared `withTempDir` test helper.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withTempDir } from './schema-audit-test-helpers.js';

describe('withTempDir', () => {
  it('creates a directory and passes its path to the callback', async () => {
    let capturedDir: string | null = null;
    await withTempDir(dir => {
      capturedDir = dir;
      expect(existsSync(dir)).toBe(true);
    });
    expect(capturedDir).not.toBeNull();
    expect(existsSync(capturedDir as unknown as string)).toBe(false);
  });

  it('returns the callback result', async () => {
    const result = await withTempDir(() => 42);
    expect(result).toBe(42);
  });

  it('supports async callbacks and awaits them before cleanup', async () => {
    let dirSeenInsideCallback: string | null = null;
    await withTempDir(async dir => {
      dirSeenInsideCallback = dir;
      writeFileSync(join(dir, 'inside.txt'), 'present');
      await Promise.resolve();
      expect(existsSync(join(dir, 'inside.txt'))).toBe(true);
    });
    expect(existsSync(dirSeenInsideCallback as unknown as string)).toBe(false);
  });

  it('removes the temp directory even if the callback throws', async () => {
    let capturedDir: string | null = null;
    await expect(
      withTempDir(dir => {
        capturedDir = dir;
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(capturedDir).not.toBeNull();
    expect(existsSync(capturedDir as unknown as string)).toBe(false);
  });
});
