#!/usr/bin/env tsx
/**
 * Barrel-kill codemod: rewrite consumer imports of the `@tzurot/common-types`
 * ROOT barrel into deep subpath imports, driven by the authoritative
 * symbol→subpath map (see build-symbol-map.ts).
 *
 * Production half (this file): rewrites
 *   - `import { a, b } from '@tzurot/common-types'` → grouped deep imports
 *   - `export { a } from '@tzurot/common-types'`     → grouped deep re-exports
 *   - inline `import('@tzurot/common-types').X` type queries (with qualifier)
 *
 * Flags for manual review (never silently mangled):
 *   - `import * as ns from '@tzurot/common-types'` namespace imports
 *   - `export * from '@tzurot/common-types'` wildcard re-exports
 *   - any imported/exported name absent from the map (curated-out / prisma-internal)
 *
 * The transform fires ONLY on the exact specifier `@tzurot/common-types`, so
 * already-migrated deep imports are invisible → idempotent and resumable.
 *
 * Test-mock half (vi.mock / importActual splitting) lives in mock-codemod.ts and
 * runs in the same pass for packages that have test mocks.
 *
 * Run: npx tsx scripts/migrations/barrel-kill/codemod.ts <pkgDir> [--dry-run]
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Project,
  QuoteKind,
  SyntaxKind,
  type SourceFile,
  type OptionalKind,
  type ImportSpecifierStructure,
  type ExportSpecifierStructure,
} from 'ts-morph';
import { buildSymbolMap, type SymbolMap } from './build-symbol-map.js';
import { rewriteViMocks } from './mock-codemod.js';

const PACKAGE = '@tzurot/common-types';

export interface CodemodReport {
  filesChanged: number;
  importsRewritten: number;
  exportsRewritten: number;
  inlineTypesRewritten: number;
  mocksRewritten: number;
  mockGroupsEmitted: number;
  namespaceImports: string[];
  wildcardReExports: string[];
  flagged: string[];
  unresolved: string[];
  /**
   * Bare `'@tzurot/common-types'` refs surviving after the AST transforms —
   * dynamic `import()` calls, string-embedded imports, and barrel-centric test
   * code the codemod can't rewrite. These keep working under dual-publish but
   * MUST reach zero (minus an intentional allowlist) before PR 3 drops `"."`.
   */
  remainingBareRefs: string[];
}

function isBarrelSpecifier(spec: string): boolean {
  return spec === PACKAGE;
}

/** Rewrite `import { … } from '@tzurot/common-types'` → grouped deep imports. */
function rewriteImportDeclarations(sf: SourceFile, map: SymbolMap, report: CodemodReport): void {
  const barrelImports = sf
    .getImportDeclarations()
    .filter(i => isBarrelSpecifier(i.getModuleSpecifierValue()));
  // Process bottom-to-top so earlier statements keep their child index while we
  // remove-then-insert (net +N-1 statements) at each site.
  barrelImports.reverse();
  for (const imp of barrelImports) {
    const ns = imp.getNamespaceImport();
    if (ns !== undefined) {
      report.namespaceImports.push(`${sf.getFilePath()} :: import * as ${ns.getText()}`);
      continue;
    }
    const named = imp.getNamedImports();
    if (named.length === 0) continue; // bare side-effect import — nothing to route
    const importIsTypeOnly = imp.isTypeOnly();

    const groups = new Map<string, OptionalKind<ImportSpecifierStructure>[]>();
    let unresolved = false;
    for (const spec of named) {
      const name = spec.getName();
      const entry = map.get(name);
      if (entry === undefined) {
        report.unresolved.push(`${sf.getFilePath()} :: import ${name}`);
        unresolved = true;
        break;
      }
      const arr = groups.get(entry.subpath) ?? [];
      arr.push({
        name,
        alias: spec.getAliasNode()?.getText(),
        isTypeOnly: spec.isTypeOnly(),
      });
      groups.set(entry.subpath, arr);
    }
    if (unresolved) continue; // leave the original import in place, flagged

    const sorted = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
    const first = sorted[0];
    if (first === undefined) continue;
    // Mutate the FIRST group INTO the existing import node in place, rather than
    // remove()+insert. This keeps the node's leading trivia (file-header JSDoc,
    // and any file-level pragma like `/* eslint-disable */`) attached exactly
    // once — remove() strips leading comments, and re-attaching them by hand
    // double-adds a surviving file-level pragma. Remaining groups insert after.
    imp.set({
      moduleSpecifier: `${PACKAGE}/${first[0]}`,
      namedImports: first[1],
      isTypeOnly: importIsTypeOnly,
    });
    let insertAt = imp.getChildIndex() + 1;
    for (const [subpath, specs] of sorted.slice(1)) {
      sf.insertImportDeclaration(insertAt++, {
        isTypeOnly: importIsTypeOnly,
        namedImports: specs,
        moduleSpecifier: `${PACKAGE}/${subpath}`,
      });
    }
    report.importsRewritten += 1;
  }
}

/** Rewrite `export { … } from '@tzurot/common-types'` → grouped deep re-exports. */
function rewriteExportDeclarations(sf: SourceFile, map: SymbolMap, report: CodemodReport): void {
  const barrelExports = sf
    .getExportDeclarations()
    .filter(
      e =>
        e.getModuleSpecifierValue() !== undefined &&
        isBarrelSpecifier(e.getModuleSpecifierValue() as string)
    );
  barrelExports.reverse();
  for (const exp of barrelExports) {
    if (exp.getNamedExports().length === 0) {
      // `export * from barrel` — cannot be split into deep paths.
      report.wildcardReExports.push(`${sf.getFilePath()} :: export *`);
      continue;
    }
    const exportIsTypeOnly = exp.isTypeOnly();
    const groups = new Map<string, OptionalKind<ExportSpecifierStructure>[]>();
    let unresolved = false;
    for (const spec of exp.getNamedExports()) {
      const name = spec.getName();
      const entry = map.get(name);
      if (entry === undefined) {
        report.unresolved.push(`${sf.getFilePath()} :: export ${name}`);
        unresolved = true;
        break;
      }
      const arr = groups.get(entry.subpath) ?? [];
      arr.push({ name, alias: spec.getAliasNode()?.getText(), isTypeOnly: spec.isTypeOnly() });
      groups.set(entry.subpath, arr);
    }
    if (unresolved) continue;

    const sorted = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
    const first = sorted[0];
    if (first === undefined) continue;
    // Mutate the first group in place (preserves leading trivia — see the import
    // rewrite above), insert the rest after.
    exp.set({
      moduleSpecifier: `${PACKAGE}/${first[0]}`,
      namedExports: first[1],
      isTypeOnly: exportIsTypeOnly,
    });
    let insertAt = exp.getChildIndex() + 1;
    for (const [subpath, specs] of sorted.slice(1)) {
      sf.insertExportDeclaration(insertAt++, {
        isTypeOnly: exportIsTypeOnly,
        namedExports: specs,
        moduleSpecifier: `${PACKAGE}/${subpath}`,
      });
    }
    report.exportsRewritten += 1;
  }
}

/** Rewrite inline `import('@tzurot/common-types').X` type queries (qualifier only). */
function rewriteInlineTypeImports(sf: SourceFile, map: SymbolMap, report: CodemodReport): void {
  for (const node of sf.getDescendantsOfKind(SyntaxKind.ImportType)) {
    const qualifier = node.getQualifier();
    if (qualifier === undefined) continue; // bare `import('…')` — owned by the mock transform
    const argLiteral = node.getArgument().asKind(SyntaxKind.LiteralType)?.getLiteral();
    const argText = argLiteral?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
    if (argText === undefined || !isBarrelSpecifier(argText)) continue;
    // First segment of the qualifier is the top-level symbol name.
    const firstName =
      qualifier.getFirstDescendantByKind(SyntaxKind.Identifier)?.getText() ?? qualifier.getText();
    const entry = map.get(firstName);
    if (entry === undefined) {
      report.unresolved.push(`${sf.getFilePath()} :: import('…').${firstName}`);
      continue;
    }
    argLiteral?.asKind(SyntaxKind.StringLiteral)?.setLiteralValue(`${PACKAGE}/${entry.subpath}`);
    report.inlineTypesRewritten += 1;
  }
}

/**
 * Flag lines carrying a BARE `@tzurot/common-types` in MODULE-RESOLUTION syntax
 * — a dynamic `import('…')` call or a `from '…'` specifier. After the AST pass
 * rewrites real static imports to deep paths, a surviving bare `from '…'` means
 * it's string-embedded (e.g. a generated subprocess script). Deliberately does
 * NOT match prose mentions, package-name strings, or a tool's barrel-detection
 * literals — only refs that actually resolve the module and would break when
 * `"."` is dropped. The remaining hits still need human triage (some are
 * intentional barrel-centric test fixtures → allowlist at PR 3).
 */
function scanRemainingBareRefs(filePath: string, text: string, report: CodemodReport): void {
  // Match ANY bare-barrel string literal the AST rewrite couldn't reach: dynamic
  // `import()`, `from`, and crucially the vitest string-arg forms in test bodies —
  // `vi.doMock('@tzurot/common-types', …)`, `vi.doUnmock(…)`, `vi.importActual(…)`.
  // The closing quote immediately after `common-types` excludes deep specifiers
  // (`@tzurot/common-types/config` has a `/` there, so it won't match). This runs
  // AFTER the rewrites, so a surviving bare literal is genuinely unhandled.
  const re = /['"`]@tzurot\/common-types['"`]/;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) report.remainingBareRefs.push(`${filePath}:${i + 1}`);
  }
}

export function runCodemod(pkgDir: string, dryRun: boolean): CodemodReport {
  const { map } = buildSymbolMap();
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false },
    manipulationSettings: { quoteKind: QuoteKind.Single },
  });
  // Skip codegen output (`_generated/`): those files are rewritten by their
  // GENERATOR (e.g. client-builder.ts emits the deep import), not by hand — a
  // codemod edit here would be clobbered on the next `codegen:routes` run.
  project.addSourceFilesAtPaths([
    path.join(pkgDir, 'src/**/*.ts'),
    `!${path.join(pkgDir, 'src/**/*.d.ts')}`,
    `!${path.join(pkgDir, 'src/**/_generated/**')}`,
  ]);

  const report: CodemodReport = {
    filesChanged: 0,
    importsRewritten: 0,
    exportsRewritten: 0,
    inlineTypesRewritten: 0,
    mocksRewritten: 0,
    mockGroupsEmitted: 0,
    namespaceImports: [],
    wildcardReExports: [],
    flagged: [],
    unresolved: [],
    remainingBareRefs: [],
  };

  for (const sf of project.getSourceFiles()) {
    const before = sf.getFullText();
    // Mocks first: rewriteViMocks reads the ORIGINAL barrel-specifier vi.mock
    // calls; the import rewrite doesn't touch them, but ordering keeps intent
    // clear (test-mock half, then production imports on the same file).
    rewriteViMocks(sf, map, report);
    rewriteImportDeclarations(sf, map, report);
    rewriteExportDeclarations(sf, map, report);
    rewriteInlineTypeImports(sf, map, report);
    const after = sf.getFullText();
    if (after !== before) {
      report.filesChanged += 1;
      if (!dryRun) sf.saveSync();
    }
    // Text scan for bare barrel refs the AST can't reach. Runs on the FINAL
    // text of every file (changed or not) so dynamic import() / string-embedded
    // imports surface — the "grep sweep" the codemod would otherwise hide.
    scanRemainingBareRefs(sf.getFilePath(), after, report);
  }
  return report;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const pkgDir = args.find(a => !a.startsWith('--'));
  if (pkgDir === undefined) {
    console.error('Usage: codemod.ts <pkgDir> [--dry-run]');
    process.exit(1);
  }
  const abs = path.resolve(pkgDir);
  console.log(`\n🔧 Barrel-kill codemod (production half)${dryRun ? ' — DRY RUN' : ''}`);
  console.log(`   target: ${abs}\n`);

  const r = runCodemod(abs, dryRun);

  console.log(`   files changed:        ${r.filesChanged}`);
  console.log(`   imports rewritten:    ${r.importsRewritten}`);
  console.log(`   export-froms:         ${r.exportsRewritten}`);
  console.log(`   inline type imports:  ${r.inlineTypesRewritten}`);
  console.log(
    `   vi.mocks rewritten:   ${r.mocksRewritten} (→ ${r.mockGroupsEmitted} subpath groups)`
  );
  if (r.flagged.length > 0) {
    console.log(`\n⚠️  Flagged for MANUAL review (${r.flagged.length}):`);
    for (const n of r.flagged) console.log(`   ${n}`);
  }
  if (r.namespaceImports.length > 0) {
    console.log(`\n⚠️  Namespace imports (MANUAL — cannot auto-split):`);
    for (const n of r.namespaceImports) console.log(`   ${n}`);
  }
  if (r.wildcardReExports.length > 0) {
    console.log(`\n⚠️  Wildcard re-exports (MANUAL):`);
    for (const n of r.wildcardReExports) console.log(`   ${n}`);
  }
  if (r.unresolved.length > 0) {
    console.log(`\n❌ Unresolved names (NOT in barrel map — investigate):`);
    for (const n of r.unresolved) console.log(`   ${n}`);
  }
  if (r.remainingBareRefs.length > 0) {
    console.log(
      `\n🔎 Remaining BARE barrel refs (dynamic import()/string/barrel-centric — ` +
        `AST can't rewrite; must clear or allowlist before PR 3 drops "."): ${r.remainingBareRefs.length}`
    );
    for (const n of r.remainingBareRefs) console.log(`   ${n.replace(`${process.cwd()}/`, '')}`);
  }
  if (dryRun) console.log(`\n(dry run — no files written)`);
}

// Only run when invoked directly (`tsx codemod.ts`), not on import.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main();
}
