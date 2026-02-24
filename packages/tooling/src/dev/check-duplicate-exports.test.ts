import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

import { readFileSync } from 'node:fs';
import {
  isSourceFile,
  parseReExportName,
  matchDeclarations,
  matchReExports,
  extractExports,
  findDuplicates,
  isAllowed,
  type ExportInfo,
} from './check-duplicate-exports.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('isSourceFile', () => {
  it('accepts regular .ts files', () => {
    expect(isSourceFile('MyService.ts')).toBe(true);
    expect(isSourceFile('utils.ts')).toBe(true);
    expect(isSourceFile('index.ts')).toBe(true);
  });

  it('rejects .test.ts files', () => {
    expect(isSourceFile('MyService.test.ts')).toBe(false);
  });

  it('rejects .d.ts files', () => {
    expect(isSourceFile('types.d.ts')).toBe(false);
  });

  it('rejects .int.test.ts files', () => {
    expect(isSourceFile('CommandHandler.int.test.ts')).toBe(false);
  });

  it('rejects test-utils.ts', () => {
    expect(isSourceFile('test-utils.ts')).toBe(false);
  });

  it('rejects non-ts files', () => {
    expect(isSourceFile('readme.md')).toBe(false);
    expect(isSourceFile('config.json')).toBe(false);
    expect(isSourceFile('script.js')).toBe(false);
  });
});

describe('parseReExportName', () => {
  it('returns plain name as-is', () => {
    expect(parseReExportName('myFunction')).toBe('myFunction');
  });

  it('returns alias for "name as alias" syntax', () => {
    expect(parseReExportName('foo as bar')).toBe('bar');
  });

  it('returns null for type exports', () => {
    expect(parseReExportName('type MyType')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(parseReExportName('  myFunction  ')).toBe('myFunction');
    expect(parseReExportName('  foo as bar  ')).toBe('bar');
  });

  it('strips leading type keyword from non-prefixed type re-exports', () => {
    // The function does trimmed.startsWith('type ') check first,
    // then also does .replace(/^type\s+/, '') on the result
    expect(parseReExportName('type SomeType')).toBeNull();
  });
});

describe('matchDeclarations', () => {
  const file = 'src/service.ts';

  it('matches export function declarations', () => {
    const result = matchDeclarations('export function doSomething() {', file, 10);
    expect(result).toEqual([{ name: 'doSomething', file, line: 10, kind: 'function' }]);
  });

  it('matches export async function declarations', () => {
    const result = matchDeclarations('export async function fetchData() {', file, 5);
    expect(result).toEqual([{ name: 'fetchData', file, line: 5, kind: 'function' }]);
  });

  it('matches export class declarations', () => {
    const result = matchDeclarations('export class UserService {', file, 20);
    expect(result).toEqual([{ name: 'UserService', file, line: 20, kind: 'class' }]);
  });

  it('matches export const declarations', () => {
    const result = matchDeclarations('export const MAX_RETRIES = 3;', file, 1);
    expect(result).toEqual([{ name: 'MAX_RETRIES', file, line: 1, kind: 'const' }]);
  });

  it('returns empty array for non-export lines', () => {
    expect(matchDeclarations('function privateHelper() {', file, 1)).toEqual([]);
    expect(matchDeclarations('const localVar = 5;', file, 2)).toEqual([]);
    expect(matchDeclarations('// export function commented() {', file, 3)).toEqual([]);
    expect(matchDeclarations('import { something } from "./mod";', file, 4)).toEqual([]);
  });

  it('returns empty array for export type/interface lines', () => {
    // These are not matched by EXPORT_PATTERNS (which only match function/class/const)
    expect(matchDeclarations('export type MyType = string;', file, 1)).toEqual([]);
    expect(matchDeclarations('export interface MyInterface {', file, 2)).toEqual([]);
  });
});

describe('matchReExports', () => {
  const file = 'src/index.ts';

  it('matches single re-export', () => {
    const result = matchReExports("export { myFunction } from './utils';", file, 3);
    expect(result).toEqual([{ name: 'myFunction', file, line: 3, kind: 'reexport' }]);
  });

  it('matches multiple re-exports on one line', () => {
    const result = matchReExports("export { foo, bar, baz } from './helpers';", file, 7);
    expect(result).toEqual([
      { name: 'foo', file, line: 7, kind: 'reexport' },
      { name: 'bar', file, line: 7, kind: 'reexport' },
      { name: 'baz', file, line: 7, kind: 'reexport' },
    ]);
  });

  it('filters out type re-exports', () => {
    const result = matchReExports("export { type MyType, realExport } from './mod';", file, 1);
    expect(result).toEqual([{ name: 'realExport', file, line: 1, kind: 'reexport' }]);
  });

  it('handles aliased re-exports', () => {
    const result = matchReExports("export { original as renamed } from './mod';", file, 2);
    expect(result).toEqual([{ name: 'renamed', file, line: 2, kind: 'reexport' }]);
  });

  it('returns empty array for non-re-export lines', () => {
    expect(matchReExports('export function foo() {', file, 1)).toEqual([]);
    expect(matchReExports('import { bar } from "./mod";', file, 2)).toEqual([]);
    expect(matchReExports('const x = 5;', file, 3)).toEqual([]);
  });
});

describe('extractExports', () => {
  const mockReadFileSync = vi.mocked(readFileSync);

  it('extracts exports across multiple lines', () => {
    mockReadFileSync.mockReturnValue(
      [
        'import { something } from "./dep";',
        '',
        'export function helperA() {',
        '  return 1;',
        '}',
        '',
        'export const MY_CONST = "value";',
        '',
        'export class MyService {',
        '  constructor() {}',
        '}',
      ].join('\n')
    );

    const result = extractExports('/fake/path/service.ts');

    expect(mockReadFileSync).toHaveBeenCalledWith('/fake/path/service.ts', 'utf-8');
    expect(result).toEqual([
      { name: 'helperA', file: '/fake/path/service.ts', line: 3, kind: 'function' },
      { name: 'MY_CONST', file: '/fake/path/service.ts', line: 7, kind: 'const' },
      { name: 'MyService', file: '/fake/path/service.ts', line: 9, kind: 'class' },
    ]);
  });

  it('skips export type and export interface lines', () => {
    mockReadFileSync.mockReturnValue(
      [
        'export type MyType = string;',
        'export interface MyInterface {',
        '  field: number;',
        '}',
        'export function realExport() {}',
      ].join('\n')
    );

    const result = extractExports('/fake/path/types.ts');

    expect(result).toEqual([
      { name: 'realExport', file: '/fake/path/types.ts', line: 5, kind: 'function' },
    ]);
  });

  it('handles re-exports alongside declarations', () => {
    mockReadFileSync.mockReturnValue(
      ['export function localFn() {}', "export { remoteFn } from './other';"].join('\n')
    );

    const result = extractExports('/fake/path/index.ts');

    expect(result).toEqual([
      { name: 'localFn', file: '/fake/path/index.ts', line: 1, kind: 'function' },
      { name: 'remoteFn', file: '/fake/path/index.ts', line: 2, kind: 'reexport' },
    ]);
  });

  it('returns empty array for file with no exports', () => {
    mockReadFileSync.mockReturnValue(['const internal = 1;', 'function helper() {}'].join('\n'));

    const result = extractExports('/fake/path/internal.ts');
    expect(result).toEqual([]);
  });
});

describe('findDuplicates', () => {
  it('returns empty array when all names are unique', () => {
    const exports: ExportInfo[] = [
      { name: 'foo', file: 'a.ts', line: 1, kind: 'function' },
      { name: 'bar', file: 'b.ts', line: 1, kind: 'function' },
      { name: 'baz', file: 'c.ts', line: 1, kind: 'const' },
    ];

    expect(findDuplicates(exports, 'api-gateway')).toEqual([]);
  });

  it('groups exports that share the same name across files', () => {
    const exports: ExportInfo[] = [
      { name: 'process', file: 'a.ts', line: 1, kind: 'function' },
      { name: 'process', file: 'b.ts', line: 5, kind: 'function' },
      { name: 'unique', file: 'c.ts', line: 1, kind: 'const' },
    ];

    const result = findDuplicates(exports, 'api-gateway');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('process');
    expect(result[0].exports).toHaveLength(2);
    expect(result[0].exports[0].file).toBe('a.ts');
    expect(result[0].exports[1].file).toBe('b.ts');
  });

  it('skips allowlisted names', () => {
    const exports: ExportInfo[] = [
      { name: 'createListHandler', file: 'routes/a.ts', line: 1, kind: 'function' },
      { name: 'createListHandler', file: 'routes/b.ts', line: 1, kind: 'function' },
    ];

    // 'createListHandler' is in the global '*' allowlist
    expect(findDuplicates(exports, 'api-gateway')).toEqual([]);
  });

  it('skips when only one definition plus re-exports', () => {
    const exports: ExportInfo[] = [
      { name: 'myHelper', file: 'utils/helper.ts', line: 5, kind: 'function' },
      { name: 'myHelper', file: 'index.ts', line: 1, kind: 'reexport' },
      { name: 'myHelper', file: 'barrel.ts', line: 3, kind: 'reexport' },
    ];

    // Only one non-reexport definition, so this is the intentional re-export pattern
    expect(findDuplicates(exports, 'api-gateway')).toEqual([]);
  });

  it('reports duplicates when multiple definitions exist alongside re-exports', () => {
    const exports: ExportInfo[] = [
      { name: 'transform', file: 'a.ts', line: 1, kind: 'function' },
      { name: 'transform', file: 'b.ts', line: 1, kind: 'function' },
      { name: 'transform', file: 'index.ts', line: 1, kind: 'reexport' },
    ];

    const result = findDuplicates(exports, 'api-gateway');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('transform');
    expect(result[0].exports).toHaveLength(3);
  });

  it('does not report single-occurrence names', () => {
    const exports: ExportInfo[] = [{ name: 'onlyOne', file: 'a.ts', line: 1, kind: 'function' }];

    expect(findDuplicates(exports, 'api-gateway')).toEqual([]);
  });
});

describe('isAllowed', () => {
  it('returns true for global allowlist items', () => {
    expect(isAllowed('createListHandler', 'api-gateway')).toBe(true);
    expect(isAllowed('createGetHandler', 'ai-worker')).toBe(true);
    expect(isAllowed('createDeleteHandler', 'common-types')).toBe(true);
  });

  it('returns true for package-specific allowlist items', () => {
    expect(isAllowed('handleBrowse', 'bot-client')).toBe(true);
    expect(isAllowed('execute', 'bot-client')).toBe(true);
    expect(isAllowed('handleButton', 'bot-client')).toBe(true);
    expect(isAllowed('data', 'bot-client')).toBe(true);
  });

  it('returns false for package-specific items in wrong package', () => {
    // 'handleBrowse' is only allowlisted for bot-client
    expect(isAllowed('handleBrowse', 'api-gateway')).toBe(false);
    expect(isAllowed('execute', 'ai-worker')).toBe(false);
  });

  it('returns false for non-allowed names', () => {
    expect(isAllowed('randomFunction', 'api-gateway')).toBe(false);
    expect(isAllowed('myHelper', 'bot-client')).toBe(false);
    expect(isAllowed('transform', 'common-types')).toBe(false);
  });
});
