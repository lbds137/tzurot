import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

// ts-morph has a cold-start cost (~500ms locally, 10-15s on slow CI runners under
// load) that can exceed the default 5s timeout. 30s gives sufficient headroom.
vi.setConfig({ testTimeout: 30_000 });

import { parseNamedImports, fileImportsSymbol, clearFileImportCache } from './importAssertions.js';

/** The match `fileImportsSymbol` applies, over parsed content (no file I/O). */
const contentImportsSymbol = (content: string, symbol: string, from: string): boolean =>
  parseNamedImports(content).some(i => i.symbol === symbol && i.source.includes(from));

describe('parseNamedImports', () => {
  it('extracts each VALUE named import with its module specifier', () => {
    const code = `
import { createJobChain } from './jobChainOrchestrator.js';
import { ContextAssembler, type Foo } from './ContextAssembler.js';
`;
    // `type Foo` is an inline type-only specifier → excluded (it doesn't exercise
    // the runtime value, so it can't prove the test runs the real symbol).
    expect(parseNamedImports(code)).toEqual([
      { symbol: 'createJobChain', source: './jobChainOrchestrator.js' },
      { symbol: 'ContextAssembler', source: './ContextAssembler.js' },
    ]);
  });

  it('excludes a type-only import declaration (`import type {...}`)', () => {
    // The bypass this guards: a circular test could `import type` the real producer
    // and use it in a type annotation to satisfy a value-import check.
    const code = `import type { createJobChain } from './jobChainOrchestrator.js';`;
    expect(parseNamedImports(code)).toEqual([]);
  });

  it('handles multi-line named imports', () => {
    const code = `
import {
  audioTranscriptionJobDataSchema,
  llmGenerationJobDataSchema,
} from '@tzurot/common-types';
`;
    expect(parseNamedImports(code).map(i => i.symbol)).toEqual([
      'audioTranscriptionJobDataSchema',
      'llmGenerationJobDataSchema',
    ]);
  });

  it('returns the ORIGINAL exported name for an aliased import (not the local alias)', () => {
    const code = `import { createJobChain as cjc } from './jobChainOrchestrator.js';`;
    expect(parseNamedImports(code)).toEqual([
      { symbol: 'createJobChain', source: './jobChainOrchestrator.js' },
    ]);
  });

  it('ignores default and namespace imports (named imports only)', () => {
    const code = `
import request from 'supertest';
import * as orch from './jobChainOrchestrator.js';
import { ROUTE_MANIFEST } from '@tzurot/clients';
`;
    expect(parseNamedImports(code)).toEqual([
      { symbol: 'ROUTE_MANIFEST', source: '@tzurot/clients' },
    ]);
  });
});

describe('contentImportsSymbol', () => {
  const code = `import { createJobChain } from './jobChainOrchestrator.js';`;

  it('matches a named import of the symbol from a module containing the fragment', () => {
    expect(contentImportsSymbol(code, 'createJobChain', 'jobChainOrchestrator')).toBe(true);
  });

  it('rejects when the symbol is absent (the circular-test shape)', () => {
    // A circular test that hand-writes a payload imports only the SCHEMA, never
    // the real producer — this is the regression the upgrade catches.
    const circular = `import { llmGenerationJobDataSchema } from '@tzurot/common-types';`;
    expect(contentImportsSymbol(circular, 'createJobChain', 'jobChainOrchestrator')).toBe(false);
  });

  it('rejects when the symbol is imported from the WRONG module', () => {
    const fake = `import { createJobChain } from './fake-shim.js';`;
    expect(contentImportsSymbol(fake, 'createJobChain', 'jobChainOrchestrator')).toBe(false);
  });

  it('rejects a TYPE-ONLY import of the real symbol (the type-import bypass)', () => {
    const typeOnly = `import type { createJobChain } from './jobChainOrchestrator.js';`;
    expect(contentImportsSymbol(typeOnly, 'createJobChain', 'jobChainOrchestrator')).toBe(false);
  });
});

describe('fileImportsSymbol', () => {
  it('returns false for an absent file (a missing contract half, not a crash)', () => {
    expect(
      fileImportsSymbol(
        '/tmp/__no_such_import_assert__.ts',
        'createJobChain',
        'jobChainOrchestrator'
      )
    ).toBe(false);
  });

  it('reads + matches a real file, and re-reads after the cache is cleared', () => {
    const dir = mkdtempSync(join(tmpdir(), 'import-assert-'));
    const file = join(dir, 'probe.ts');
    try {
      // Circular shape: imports only the schema, not the real producer.
      writeFileSync(file, "import { llmGenerationJobDataSchema } from '@tzurot/common-types';\n");
      expect(fileImportsSymbol(file, 'createJobChain', 'jobChainOrchestrator')).toBe(false);

      // Without a cache clear the stale (false) result would persist; clearing
      // forces a re-read, so the rewritten file now matches.
      clearFileImportCache();
      writeFileSync(file, "import { createJobChain } from './jobChainOrchestrator.js';\n");
      expect(fileImportsSymbol(file, 'createJobChain', 'jobChainOrchestrator')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearFileImportCache();
    }
  });
});
