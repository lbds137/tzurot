import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { isScannedSourceFile, findStarExports } from './check-no-export-star.js';

describe('isScannedSourceFile', () => {
  it('includes plain .ts production files', () => {
    expect(isScannedSourceFile('/repo/packages/a/src/foo.ts')).toBe(true);
  });

  it('excludes test, spec, and declaration files', () => {
    expect(isScannedSourceFile('/repo/packages/a/src/foo.test.ts')).toBe(false);
    expect(isScannedSourceFile('/repo/packages/a/src/foo.spec.ts')).toBe(false);
    expect(isScannedSourceFile('/repo/packages/a/src/foo.d.ts')).toBe(false);
  });

  it('exempts generated code and test infrastructure', () => {
    expect(isScannedSourceFile('/repo/packages/a/src/generated/x.ts')).toBe(false);
    expect(isScannedSourceFile('/repo/packages/a/src/clients/_generated/y.ts')).toBe(false);
    expect(isScannedSourceFile('/repo/services/a/src/services/__mocks__/z.ts')).toBe(false);
    expect(isScannedSourceFile('/repo/services/a/src/test/mocks/index.ts')).toBe(false);
    expect(isScannedSourceFile('/repo/services/a/src/test/fixtures/f.ts')).toBe(false);
  });
});

describe('findStarExports', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'guard-star-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function write(rel: string, content: string): void {
    const full = join(tmp, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  it('flags `export *` in production source, ignoring explicit re-exports + exempt paths', () => {
    write(
      'packages/a/src/index.ts',
      "export * from './foo.js';\nexport { Bar } from './bar.js';\n"
    );
    write('packages/a/src/foo.ts', 'export const x = 1;\n');
    write('packages/a/src/generated/gen.ts', "export * from './blah.js';\n"); // exempt (generated)
    write('packages/a/src/index.test.ts', "export * from './foo.js';\n"); // exempt (test)
    write('services/b/src/deep/re.ts', "  export * from '../thing.js';\n"); // flagged (indented)

    const found = findStarExports(tmp);
    const rels = found.map(v => v.filePath.slice(tmp.length + 1)).sort();

    expect(rels).toEqual(['packages/a/src/index.ts', 'services/b/src/deep/re.ts']);
    const idx = found.find(v => v.filePath.endsWith('index.ts'));
    expect(idx?.line).toBe(1);
    expect(idx?.text).toBe("export * from './foo.js';");
  });

  it('returns [] when nothing uses `export *`', () => {
    write('packages/a/src/index.ts', "export { Bar } from './bar.js';\n");
    expect(findStarExports(tmp)).toEqual([]);
  });
});
