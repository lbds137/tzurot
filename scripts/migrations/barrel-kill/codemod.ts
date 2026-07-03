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
import {
  Project,
  QuoteKind,
  SyntaxKind,
  type SourceFile,
  type ImportSpecifierStructure,
} from 'ts-morph';
import { buildSymbolMap, type SymbolMap } from './build-symbol-map.js';

const PACKAGE = '@tzurot/common-types';

export interface CodemodReport {
  filesChanged: number;
  importsRewritten: number;
  exportsRewritten: number;
  inlineTypesRewritten: number;
  namespaceImports: string[];
  wildcardReExports: string[];
  unresolved: string[];
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

    const groups = new Map<string, ImportSpecifierStructure[]>();
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

    const structures = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([subpath, specs]) => ({
        isTypeOnly: importIsTypeOnly,
        namedImports: specs,
        moduleSpecifier: `${PACKAGE}/${subpath}`,
      }));

    const idx = imp.getChildIndex();
    imp.remove();
    sf.insertImportDeclarations(idx, structures);
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
    const groups = new Map<string, ImportSpecifierStructure[]>();
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

    const structures = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([subpath, specs]) => ({
        isTypeOnly: exportIsTypeOnly,
        namedExports: specs,
        moduleSpecifier: `${PACKAGE}/${subpath}`,
      }));

    const idx = exp.getChildIndex();
    exp.remove();
    sf.insertExportDeclarations(idx, structures);
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
      qualifier.getFirstDescendantOfKind(SyntaxKind.Identifier)?.getText() ?? qualifier.getText();
    const entry = map.get(firstName);
    if (entry === undefined) {
      report.unresolved.push(`${sf.getFilePath()} :: import('…').${firstName}`);
      continue;
    }
    argLiteral?.asKind(SyntaxKind.StringLiteral)?.setLiteralValue(`${PACKAGE}/${entry.subpath}`);
    report.inlineTypesRewritten += 1;
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
    namespaceImports: [],
    wildcardReExports: [],
    unresolved: [],
  };

  for (const sf of project.getSourceFiles()) {
    const before = sf.getFullText();
    rewriteImportDeclarations(sf, map, report);
    rewriteExportDeclarations(sf, map, report);
    rewriteInlineTypeImports(sf, map, report);
    if (sf.getFullText() !== before) {
      report.filesChanged += 1;
      if (!dryRun) sf.saveSync();
    }
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
  if (dryRun) console.log(`\n(dry run — no files written)`);
}

main();
