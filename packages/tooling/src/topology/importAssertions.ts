/**
 * Import-assertion helper for the coverage topology.
 *
 * The topology's coverage signal is upgraded from "a contract test FILE exists /
 * a schema string APPEARS" to "the contract test IMPORTS the real
 * producer/consumer symbol." A circular test — one that hand-writes a payload and
 * validates it against its own schema, importing NEITHER the real producer nor
 * the real consumer — imports no real symbol and is therefore reported as a gap.
 *
 * Why an import check is enough (no call-site/witness analysis): the repo's root
 * tsconfig sets `noUnusedLocals: true`, so an imported VALUE symbol that is never
 * referenced is a `tsc` error. So a present import proves the binding is in scope
 * and not dead-code-eliminated by esbuild — strictly, that much, not that the
 * symbol is *invoked at runtime*. The residual gap: a `typeof RealProducer`
 * reference satisfies `noUnusedLocals` from a type position without ever calling
 * it. That's an ADVERSARIAL shape, not an accidental one (a contributor writing a
 * real contract test calls the producer), so it's accepted — closing it would need
 * call-witness AST, which the council judged gold-plating. The guarantee also holds
 * end-to-end only because CI runs `typecheck` alongside `test` (vitest/esbuild
 * transpile away an unused import; tsc is what rejects it).
 *
 * Named imports only (the convention across the contract tests, enforced by
 * `02-code-standards.md` "import from source modules"). Two shapes the substring
 * match would miss — both unused here: a namespace import (`import * as x`, which
 * has no named bindings) and a barrel re-export (`import { createJobChain } from
 * './index.js'`, whose specifier wouldn't include the source-module fragment).
 * `getName()` returns the original exported name, so an aliased import
 * (`import { createJobChain as cjc }`) still matches `createJobChain`.
 *
 * Uses ts-morph in in-memory mode — the proven `xray/file-parser.ts` pattern.
 */

import { Project } from 'ts-morph';

import { fileExists, readFile } from '../test/audit-utils.js';

/** A named import paired with the module specifier it came from. */
export interface NamedImport {
  /** The original exported name (not the local alias). */
  symbol: string;
  /** The raw module specifier, e.g. `./jobChainOrchestrator.js` or `@tzurot/clients`. */
  source: string;
}

// One shared in-memory project — ts-morph cold-start is ~500ms, so reuse it
// across calls (same rationale as xray/file-parser.ts). Callers must be SERIAL:
// createSourceFile reuses a fixed filename with `overwrite: true`, so a concurrent
// (e.g. Promise.all) caller would clobber another's source mid-parse. The topology
// probe calls these serially.
const project = new Project({ useInMemoryFileSystem: true });

/**
 * Parse the named imports (symbol + module specifier) from TypeScript source
 * content. Pure over its input — the unit-test entry point.
 *
 * @remarks Not concurrency-safe: reuses one shared in-memory source file
 * (`overwrite: true`), so a `Promise.all` over multiple calls would clobber one
 * another mid-parse. Call serially (the topology probe does).
 */
export function parseNamedImports(content: string): NamedImport[] {
  const sourceFile = project.createSourceFile('__import_assert__.ts', content, { overwrite: true });
  const result: NamedImport[] = [];
  for (const decl of sourceFile.getImportDeclarations()) {
    // Type-only imports don't exercise the runtime value, so they don't prove the
    // test runs the real producer/consumer — a circular test could `import type`
    // the real symbol (using it only in a type annotation) and fake coverage. Skip
    // both the `import type {...}` declaration form and the inline `import { type X }`.
    if (decl.isTypeOnly()) {
      continue;
    }
    const source = decl.getModuleSpecifierValue();
    for (const named of decl.getNamedImports()) {
      if (named.isTypeOnly()) {
        continue;
      }
      result.push({ symbol: named.getName(), source });
    }
  }
  return result;
}

// The probe queries the same file for multiple symbols (e.g. the conformance
// harness for both CONFORMANCE_REGISTRY and ROUTE_MANIFEST), so cache the parsed
// imports per absolute path. An absent file caches an empty list (→ uncovered).
const fileImportCache = new Map<string, NamedImport[]>();

function namedImportsForFile(absPath: string): NamedImport[] {
  const cached = fileImportCache.get(absPath);
  if (cached !== undefined) {
    return cached;
  }
  const imports = fileExists(absPath) ? parseNamedImports(readFile(absPath)) : [];
  fileImportCache.set(absPath, imports);
  return imports;
}

/**
 * True iff the file at `absPath` imports `symbol` from a module matching
 * `fromModuleMatch`. False when the file is absent (a missing contract half is an
 * uncovered surface, not a crash).
 *
 * Results are cached per path for the PROCESS lifetime — safe because every
 * `topology:generate` / `topology:check` invocation runs in a fresh `tsx` process,
 * so a file cannot change between two reads within one run. (Tests that rewrite a
 * fixture between assertions call `clearFileImportCache`.)
 */
export function fileImportsSymbol(
  absPath: string,
  symbol: string,
  fromModuleMatch: string
): boolean {
  return namedImportsForFile(absPath).some(
    i => i.symbol === symbol && i.source.includes(fromModuleMatch)
  );
}

/** Clear the per-path cache (for tests that rewrite fixture files between cases). */
export function clearFileImportCache(): void {
  fileImportCache.clear();
}
