/**
 * Invariant tests for the manifest-id → handler-source-file map.
 *
 * The map is hand-maintained (the file layout for a handler is not
 * derivable from the manifest audience field — see the moduledocstring
 * on `handler-paths.ts`). These tests catch the two ways it can drift:
 *
 *   1. A new route in ROUTE_MANIFEST without a matching map entry — the
 *      codegen would emit a broken import.
 *   2. A map entry whose target file no longer exports the expected
 *      `handle{PascalCase(id)}` symbol — the codegen would emit a stale
 *      import that fails to resolve at runtime.
 *
 * The codegen orchestrator already throws on (1), but a test makes the
 * failure visible at CI time rather than at the first codegen run after
 * a manifest edit.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { ROUTE_MANIFEST } from '@tzurot/clients';
import {
  HANDLER_PATH_MAP,
  HANDLER_EXPORT_NAME_OVERRIDES,
  handlerPathFor,
  handlerExportNameFor,
} from './handler-paths.js';

const ROUTES_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../services/api-gateway/src/routes'
);

/** `'../admin/foo.js'` → absolute path to `admin/foo.ts` under `_generated/`. */
function resolveImportPath(importPath: string): string {
  // mounts.ts lives at `_generated/`, so '../admin/foo.js' is relative to that
  const fromGenerated = resolve(ROUTES_ROOT, '_generated', importPath);
  return normalize(fromGenerated).replace(/\.js$/, '.ts');
}

describe('HANDLER_PATH_MAP', () => {
  it('covers every route id in ROUTE_MANIFEST', () => {
    const manifestIds = Object.keys(ROUTE_MANIFEST);
    const mapIds = Object.keys(HANDLER_PATH_MAP);

    const missing = manifestIds.filter(id => !mapIds.includes(id));
    expect(
      missing,
      `Missing entries in HANDLER_PATH_MAP for ${missing.length} route id(s). ` +
        `Add them to packages/tooling/src/codegen/handler-paths.ts.`
    ).toEqual([]);
  });

  it('has no stale entries (every map id is in ROUTE_MANIFEST)', () => {
    const manifestIds = new Set(Object.keys(ROUTE_MANIFEST));
    const stale = Object.keys(HANDLER_PATH_MAP).filter(id => !manifestIds.has(id));

    expect(
      stale,
      `Stale entries in HANDLER_PATH_MAP for ${stale.length} route id(s) ` +
        `that no longer exist in ROUTE_MANIFEST. Remove them.`
    ).toEqual([]);
  });

  it('points every entry at an existing source file', () => {
    const missing: string[] = [];
    for (const [id, importPath] of Object.entries(HANDLER_PATH_MAP)) {
      const sourcePath = resolveImportPath(importPath);
      if (!existsSync(sourcePath)) {
        missing.push(`${id} → ${importPath} (resolved: ${sourcePath})`);
      }
    }
    expect(missing, 'HANDLER_PATH_MAP entries pointing at missing files').toEqual([]);
  });

  it('points every entry at a file that exports the resolved handler name', async () => {
    const errors: string[] = [];
    for (const [id, importPath] of Object.entries(HANDLER_PATH_MAP)) {
      const sourcePath = resolveImportPath(importPath);
      if (!existsSync(sourcePath)) {
        // Already covered by the previous test; skip to keep errors readable.
        continue;
      }
      const expectedExport = handlerExportNameFor(id);
      const source = await readFile(sourcePath, 'utf-8');
      // Match either a `const` or `function` shape.
      const pattern = new RegExp(`^export (const|function) ${expectedExport}\\b`, 'm');
      if (!pattern.test(source)) {
        errors.push(`${id}: expected '${expectedExport}' export in ${importPath}`);
      }
    }
    expect(errors, 'HANDLER_PATH_MAP entries missing their expected handler export').toEqual([]);
  });
});

describe('HANDLER_EXPORT_NAME_OVERRIDES', () => {
  it('only contains overrides for known manifest ids', () => {
    const manifestIds = new Set(Object.keys(ROUTE_MANIFEST));
    const stale = Object.keys(HANDLER_EXPORT_NAME_OVERRIDES).filter(id => !manifestIds.has(id));
    expect(stale, 'HANDLER_EXPORT_NAME_OVERRIDES entries for non-manifest ids').toEqual([]);
  });
});

describe('handlerPathFor', () => {
  it('returns the mapped path for a known id', () => {
    expect(handlerPathFor('getTimezone')).toBe('../user/timezone.js');
  });

  it('throws with a clear message for an unknown id', () => {
    expect(() => handlerPathFor('nonexistent-route-id-xyz')).toThrow(
      /no source file mapped for route id/
    );
  });
});

describe('handlerExportNameFor', () => {
  it('applies EXPORT_NAME_OVERRIDES for known overrides', () => {
    // getChannelSettings shares its handler with getUserChannel.
    expect(handlerExportNameFor('getChannelSettings')).toBe('handleGetUserChannel');
  });

  it('falls back to handle{PascalCase(id)} for non-overridden ids', () => {
    expect(handlerExportNameFor('getTimezone')).toBe('handleGetTimezone');
    expect(handlerExportNameFor('createPersona')).toBe('handleCreatePersona');
  });
});
