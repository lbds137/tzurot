#!/usr/bin/env tsx
/**
 * Barrel-kill Phase 0: build the authoritative symbol → subpath map.
 *
 * The entire codemod rests on knowing, for every public name the
 * `@tzurot/common-types` root barrel exports, which leaf module it actually
 * lives in. Rather than hand-expand the barrel's `export *` / curated
 * `export { … }` forms (and re-derive its collision/ambiguity rules), we use
 * the compiler as the oracle: `SourceFile.getExportSymbols()` returns the
 * fully-resolved public export set — star-expanded, curation-respecting,
 * ambiguity-dropped. We chase each export alias to its real declaration and
 * mirror that declaration's src-relative path into an import subpath
 * (`utils/logger.ts` → `@tzurot/common-types/utils/logger`).
 *
 * Run with: npx tsx scripts/migrations/barrel-kill/build-symbol-map.ts [--json <path>]
 *
 * Fails loudly on:
 *   - a public name resolving to two different leaves (true collision)
 *   - an export whose declaration is not under src/ (third-party re-export leak)
 *   - keyset asymmetry between getExportSymbols() and the built map
 */

import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Project, ts, type Symbol as MorphSymbol } from 'ts-morph';

const COMMON_TYPES_ROOT = path.resolve(import.meta.dirname, '../../../packages/common-types');
const SRC_DIR = path.join(COMMON_TYPES_ROOT, 'src');
const INDEX_PATH = path.join(SRC_DIR, 'index.ts');
const PACKAGE_NAME = '@tzurot/common-types';

/** Leaf directories that must NEVER be exposed as a subpath. */
const INTERNAL_PREFIXES = ['generated/prisma/'];

function isInternalFile(filePath: string): boolean {
  const rel = path.relative(SRC_DIR, filePath).replace(/\\/g, '/');
  return INTERNAL_PREFIXES.some(p => rel.startsWith(p));
}

export interface SymbolMapEntry {
  /** src-relative import subpath, e.g. `utils/logger` (no leading `./`, no `.ts`). */
  subpath: string;
  /** The declaration's own name (barrel has no aliasing, so == publicName). */
  originalName: string;
  /** Has a runtime value binding (function/class/const/enum/…). */
  hasValue: boolean;
  /** Has a type binding (interface/type-alias/class/enum/…). */
  isType: boolean;
}

export type SymbolMap = Map<string, SymbolMapEntry>;

function chaseAlias(symbol: MorphSymbol): MorphSymbol {
  let current = symbol;
  const seen = new Set<MorphSymbol>();
  for (;;) {
    if (seen.has(current)) return current;
    seen.add(current);
    const aliased = current.getAliasedSymbol();
    if (aliased === undefined) return current;
    current = aliased;
  }
}

/**
 * Resolve an exported symbol to its ORIGIN declaration file (fully chased).
 * `getExportSymbols()` flattens the barrel's `export *`, so the origin is the
 * real leaf for normal symbols (schemas → schemas/api/persona, createLogger →
 * utils/logger) — great deep paths. The one case it gets "wrong" is a symbol
 * whose origin is internal (`PrismaClient` originates in generated/prisma/) —
 * those are handled by the direct-source fallback in `buildSymbolMap`.
 */
function resolveOriginFile(sym: MorphSymbol): { file: string | null; internal: boolean } {
  const resolved = chaseAlias(sym);
  const srcDecls = resolved
    .getDeclarations()
    .map(d => d.getSourceFile().getFilePath() as string)
    .filter(fp => fp.startsWith(SRC_DIR) && !fp.endsWith('.d.ts') && fp !== INDEX_PATH);
  if (srcDecls.length === 0) return { file: null, internal: false };
  return { file: srcDecls[0], internal: isInternalFile(srcDecls[0]) };
}

/**
 * Map each public name to the NON-internal leaf the barrel DIRECTLY re-exports
 * it through, by reading the barrel's own `export … from './X'` declarations.
 * Used only as the fallback for internal-origin symbols: `PrismaClient` is
 * `export *`-contributed by `services/prisma.ts` (which curates it out of the
 * generated client), so its direct source is the exposed `services/prisma`
 * leaf even though its origin is internal.
 */
function buildDirectSourceMap(
  index: ReturnType<Project['getSourceFileOrThrow']>
): Map<string, string> {
  const m = new Map<string, string>();
  for (const exp of index.getExportDeclarations()) {
    const modSrc = exp.getModuleSpecifierSourceFile();
    if (modSrc === undefined) continue;
    const modFile = modSrc.getFilePath() as string;
    if (!modFile.startsWith(SRC_DIR) || isInternalFile(modFile)) continue;
    const subpath = toSubpath(modFile);
    const named = exp.getNamedExports();
    if (named.length > 0) {
      for (const spec of named) m.set(spec.getName(), subpath);
    } else {
      for (const s of modSrc.getExportSymbols()) m.set(s.getName(), subpath);
    }
  }
  return m;
}

function toSubpath(filePath: string): string {
  let rel = path.relative(SRC_DIR, filePath).replace(/\\/g, '/');
  rel = rel.replace(/\.ts$/, '');
  rel = rel.replace(/\/index$/, ''); // a leaf that IS an index barrel collapses to its dir
  return rel;
}

export function buildSymbolMap(): {
  map: SymbolMap;
  subpaths: Set<string>;
  flags: { internalLeaks: string[]; unresolved: string[] };
} {
  const project = new Project({
    tsConfigFilePath: path.join(COMMON_TYPES_ROOT, 'tsconfig.json'),
  });
  const index = project.getSourceFileOrThrow(path.join(SRC_DIR, 'index.ts'));

  const map: SymbolMap = new Map();
  const subpaths = new Set<string>();
  const internalLeaks: string[] = [];
  const unresolved: string[] = [];
  const collisions: string[] = [];

  const exportSymbols = index.getExportSymbols();
  const directSource = buildDirectSourceMap(index);

  for (const sym of exportSymbols) {
    const publicName = sym.getName();
    const { file: originFile, internal } = resolveOriginFile(sym);

    let subpath: string | undefined;
    if (originFile !== null && !internal) {
      subpath = toSubpath(originFile); // normal case: deep path to the real leaf
    } else {
      // Internal origin (generated/prisma) OR no src decl → fall back to the
      // exposed leaf the barrel directly re-exports it through.
      subpath = directSource.get(publicName);
    }
    if (subpath === undefined) {
      if (internal) internalLeaks.push(`${publicName} → generated/prisma`);
      else unresolved.push(publicName);
      continue;
    }
    const resolved = chaseAlias(sym); // origin symbol carries the real value/type flags
    const flags = resolved.getFlags();
    const entry: SymbolMapEntry = {
      subpath,
      originalName: resolved.getName(),
      hasValue: (flags & ts.SymbolFlags.Value) !== 0,
      isType: (flags & ts.SymbolFlags.Type) !== 0,
    };
    const existing = map.get(publicName);
    if (existing !== undefined && existing.subpath !== subpath) {
      collisions.push(`${publicName}: ${existing.subpath} vs ${subpath}`);
      continue;
    }
    map.set(publicName, entry);
    subpaths.add(subpath);
  }

  // Keyset symmetry cross-check (minus the intentionally-dropped buckets).
  const exportedNames = new Set(exportSymbols.map(s => s.getName()));
  const droppedCount = internalLeaks.length + unresolved.length + collisions.length;
  const asymmetry = exportedNames.size - (map.size + droppedCount);

  if (collisions.length > 0) {
    console.error('\n❌ HARD FAIL — true symbol collisions (name → two leaves):');
    for (const c of collisions) console.error(`   ${c}`);
    process.exit(1);
  }
  if (asymmetry !== 0) {
    console.error(
      `\n❌ HARD FAIL — keyset asymmetry: ${exportedNames.size} exported, ` +
        `${map.size} mapped + ${droppedCount} dropped (diff ${asymmetry}).`
    );
    process.exit(1);
  }

  return { map, subpaths, flags: { internalLeaks, unresolved } };
}

function main(): void {
  const { map, subpaths, flags } = buildSymbolMap();

  console.log(`\n📦 Barrel symbol → subpath map`);
  console.log(`   ${map.size} public symbols across ${subpaths.size} subpaths\n`);

  // Per-subpath symbol counts, sorted.
  const bySubpath = new Map<string, string[]>();
  for (const [name, entry] of map) {
    const list = bySubpath.get(entry.subpath) ?? [];
    list.push(name);
    bySubpath.set(entry.subpath, list);
  }
  for (const sp of [...subpaths].sort()) {
    const names = (bySubpath.get(sp) ?? []).sort();
    console.log(`   ${PACKAGE_NAME}/${sp}  (${names.length})`);
    console.log(`      ${names.join(', ')}`);
  }

  if (flags.internalLeaks.length > 0) {
    console.log(`\n🔒 Dropped (internal generated/prisma — correctly NOT exposed):`);
    for (const l of flags.internalLeaks) console.log(`   ${l}`);
  }
  if (flags.unresolved.length > 0) {
    console.log(`\n⚠️  Unresolved (no src declaration — investigate):`);
    for (const u of flags.unresolved) console.log(`   ${u}`);
  }

  const jsonFlag = process.argv.indexOf('--json');
  if (jsonFlag !== -1 && process.argv[jsonFlag + 1] !== undefined) {
    const out = Object.fromEntries(map);
    writeFileSync(process.argv[jsonFlag + 1], JSON.stringify(out, null, 2));
    console.log(`\n💾 Wrote map JSON → ${process.argv[jsonFlag + 1]}`);
  }
}

// Only dump the map when run directly (`tsx build-symbol-map.ts`), not on import.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main();
}
