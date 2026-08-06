/**
 * Generate PGLite Schema
 *
 * Regenerate PGLite schema SQL from Prisma schema.
 * Run this whenever you change prisma/schema.prisma.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

/**
 * Dummy DATABASE_URL - Prisma doesn't actually connect for migrate diff,
 * just needs a valid-looking URL to identify the provider.
 * Using minimal format to avoid secretlint false positives.
 */
const DUMMY_DATABASE_URL = 'postgres://x:x@x/x';

/**
 * Header preceding appended CHECK statements in the generated schema. Spelled
 * out as a constant (rather than inlined into the template literal) so a
 * reader scanning `generateSchema()` sees the intent immediately instead of
 * parsing an escaped-newline blob.
 */
const CHECK_CONSTRAINT_BANNER = [
  '-- CHECK constraints harvested from prisma/migrations/**/migration.sql',
  "-- (Prisma's schema-diff generator has no CHECK-constraint representation,",
  "-- so they're merged back in here at schema-generation time.)",
].join('\n');

/**
 * Header preceding appended partial-UNIQUE-index statements. Mirrors
 * CHECK_CONSTRAINT_BANNER — broken out as a constant so the intent is visible
 * at the call site rather than buried in an escaped-newline template literal.
 */
const PARTIAL_UNIQUE_INDEX_BANNER = [
  '-- Partial-UNIQUE indexes harvested from prisma/migrations/**/migration.sql',
  "-- (Prisma's schema-diff can't represent partial indexes, so they're merged",
  '-- back in here. These enforce per-kind/per-scope uniqueness that PGLite,',
  '-- being real Postgres-in-WASM, applies just like prod.)',
].join('\n');

/**
 * Header preceding appended DEFERRABLE-constraint ALTERs. Same shape as the
 * banners above.
 */
const DEFERRABLE_CONSTRAINT_BANNER = [
  '-- DEFERRABLE-constraint ALTERs harvested from prisma/migrations/**/migration.sql',
  "-- (Prisma can't express DEFERRABLE in schema.prisma, so the hand-written",
  '-- ALTER CONSTRAINT statements are merged back in here. db-sync relies on',
  '-- SET CONSTRAINTS ALL DEFERRED for atomic circular-FK inserts.)',
].join('\n');

/**
 * Header preceding appended plpgsql functions + triggers. Same shape as the
 * banners above.
 */
const TRIGGER_BANNER = [
  '-- plpgsql functions + triggers harvested from prisma/migrations/**/migration.sql',
  "-- (Prisma's migrate diff cannot see functions or triggers at all, so the",
  '-- hand-written ones are merged back in here. sync_tombstone_capture backs',
  "-- db-sync's deletion propagation; the cache-invalidation triggers' pg_notify",
  '-- calls are listener-less no-ops under PGLite.)',
].join('\n');

interface GenerateSchemaOptions {
  output?: string;
}

/**
 * Matches an `ALTER TABLE ... ADD CONSTRAINT "<name>" CHECK (...)` statement
 * and captures the constraint name.
 *
 * Why this extractor exists: Prisma's `migrate diff --from-empty` is
 * introspection-based and has no representation for CHECK constraints — so
 * any CHECK added via a hand-written migration is silently dropped from the
 * generated SQL. Without this harvest, integration tests against PGLite
 * would permit values prod Postgres rejects (empty persona names,
 * snowflake-shaped names, birthday out-of-range, etc.).
 *
 * The regex is intentionally permissive about whitespace/newlines between
 * tokens (some migrations wrap after `ALTER TABLE`, others are single-line).
 * Case-insensitive to match either SQL convention. `"[^"]+"` requires at
 * least one character inside the quotes, so a successful match guarantees
 * the name group is a non-empty string.
 */
const CHECK_CONSTRAINT_REGEX =
  /^ALTER\s+TABLE\s+"([^"]+)"\s+ADD\s+CONSTRAINT\s+"([^"]+)"\s+CHECK\b/i;
// Matches both forms: `DROP CONSTRAINT "c"` and `DROP CONSTRAINT IF EXISTS "c"`.
// Prisma migrate dev doesn't currently emit `IF EXISTS` for CHECK constraints,
// but a hand-written migration may, and the IF-EXISTS form is semantically
// equivalent for our extraction purposes.
const DROP_CONSTRAINT_REGEX =
  /^ALTER\s+TABLE\s+"([^"]+)"\s+DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/i;

/**
 * Matches a `CREATE UNIQUE INDEX "<name>" ON ... WHERE ...` statement and
 * captures the index name.
 *
 * Why this extractor exists: same gap as the CHECK harvest above. Prisma's
 * schema model has no way to express a *partial* index (`WHERE <predicate>`),
 * so any partial-unique index added via a hand-written migration is silently
 * dropped from the generated SQL. Without this harvest, component tests
 * against PGLite would permit duplicate rows prod Postgres rejects (e.g. two
 * `is_default = true` configs for the same `kind`).
 *
 * SCOPE IS DELIBERATELY NARROW: the trailing `WHERE` token is required, so
 * this matches ONLY partial indexes — the exact subset Prisma omits. A plain
 * non-partial `CREATE UNIQUE INDEX` (no WHERE) is already emitted by Prisma's
 * diff; re-harvesting it would produce a duplicate-name CREATE and PGLite
 * would throw "index already exists". And `UNIQUE` is required, so a non-
 * unique partial index (`CREATE INDEX ... WHERE`) — which enforces nothing —
 * is not harvested.
 *
 * The `[\s\S]*?` between the table reference and `WHERE` is lazy so it can
 * span the multi-line column list these statements usually wrap across,
 * without swallowing past the first `WHERE`. Case-insensitive to match either
 * SQL convention.
 */
const PARTIAL_UNIQUE_INDEX_REGEX = /^CREATE\s+UNIQUE\s+INDEX\s+"([^"]+)"\s+ON\s[\s\S]*?\bWHERE\b/i;
// Matches both `DROP INDEX "i"` and `DROP INDEX IF EXISTS "i"`. A hand-written
// migration may DROP a partial-unique index it intends to recreate with a
// different predicate (the per-kind rework does exactly this), so the dedup
// loop needs to see the DROP to apply last-wins correctly.
const DROP_INDEX_REGEX = /^DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/i;

/**
 * Matches an `ALTER TABLE ... ALTER CONSTRAINT "<name>" DEFERRABLE ...`
 * statement and captures the constraint name.
 *
 * Why this extractor exists: same gap again. Prisma cannot express
 * DEFERRABLE in schema.prisma, so the circular-FK migrations hand-write
 * `ALTER CONSTRAINT ... DEFERRABLE INITIALLY IMMEDIATE` — and `migrate diff`
 * silently omits them. Without this harvest, PGLite FKs are NOT DEFERRABLE:
 * `SET CONSTRAINTS ALL DEFERRED` becomes a silent no-op and db-sync's atomic
 * circular inserts (users ↔ personas ↔ configs) fail in component tests while
 * working in prod.
 *
 * The name group cannot match a `NOT DEFERRABLE` revert — `NOT` intervenes
 * between the quoted name and `DEFERRABLE`, so the revert form falls through
 * to DEFERRABLE_UNDO_REGEX below.
 */
const DEFERRABLE_CONSTRAINT_REGEX =
  /^ALTER\s+TABLE\s+"([^"]+)"\s+ALTER\s+CONSTRAINT\s+"([^"]+)"\s+DEFERRABLE\b/i;
/**
 * Undoes a harvested DEFERRABLE clause. Two forms retire deferrability:
 * an explicit `ALTER CONSTRAINT "c" NOT DEFERRABLE` revert, or dropping the
 * constraint outright (Prisma emits DROP + re-ADD when an FK definition
 * changes, and the re-ADD never carries DEFERRABLE — so post-drop, prod is
 * not deferrable unless a later migration re-alters it, and the harvest
 * must mirror that).
 */
const DEFERRABLE_UNDO_REGEX =
  /^ALTER\s+TABLE\s+"([^"]+)"\s+(?:ALTER\s+CONSTRAINT\s+"([^"]+)"\s+NOT\s+DEFERRABLE\b|DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"([^"]+)")/i;

/**
 * One harvest's regex pair plus how to build its dedup key.
 *
 * `tableScoped` encodes the identifier-uniqueness rule Postgres applies to
 * the objects that harvest collects:
 *
 * - CONSTRAINT names are unique only WITHIN a table, so two tables may
 *   legitimately carry the same constraint name (`"valid_range"` on both).
 *   Those harvests capture the quoted table as group 1 and key on
 *   `table + name` — keying on the name alone would last-wins-collapse the
 *   pair into ONE statement and silently drop the other from the generated
 *   schema.
 * - INDEX names are unique per SCHEMA, not per table, so the name alone is
 *   already a complete key — and `DROP INDEX "i"` names no table at all
 *   (Postgres does not accept one), so a table-scoped key is not merely
 *   unnecessary there but unrepresentable on the drop side.
 */
interface HarvestSpec {
  addRegex: RegExp;
  dropRegex: RegExp;
  /** When true, group 1 of BOTH regexes is the quoted table name. */
  tableScoped: boolean;
}

const CHECK_CONSTRAINT_SPEC: HarvestSpec = {
  addRegex: CHECK_CONSTRAINT_REGEX,
  dropRegex: DROP_CONSTRAINT_REGEX,
  tableScoped: true,
};

const PARTIAL_UNIQUE_INDEX_SPEC: HarvestSpec = {
  addRegex: PARTIAL_UNIQUE_INDEX_REGEX,
  dropRegex: DROP_INDEX_REGEX,
  tableScoped: false,
};

const DEFERRABLE_CONSTRAINT_SPEC: HarvestSpec = {
  addRegex: DEFERRABLE_CONSTRAINT_REGEX,
  dropRegex: DEFERRABLE_UNDO_REGEX,
  tableScoped: true,
};

type ExtractedOp = { kind: 'add'; key: string; statement: string } | { kind: 'drop'; key: string };

/** Collapse internal whitespace so each statement ends up on one line. */
function normalizeStatement(stmt: string): string {
  return stmt.replace(/\s+/g, ' ').trim();
}

/**
 * Build the dedup key for a matched statement under the group convention
 * described on `HarvestSpec`: when the harvest is table-scoped, group 1 is
 * the quoted table and the object name is the first defined group after it
 * (the undo regexes carry the name in one of two alternatives); otherwise
 * the name is simply the first defined group.
 *
 * The separator is a double quote: every capture group here is `[^"]+`, so a
 * quote can never appear inside either half and no pair of (table, name)
 * values can collide with a different pair by concatenation.
 */
function dedupKeyFor(match: RegExpExecArray, tableScoped: boolean): string | undefined {
  const groups = match.slice(1);
  if (!tableScoped) {
    return groups.find(group => group !== undefined);
  }
  const table = groups[0];
  const name = groups.slice(1).find(group => group !== undefined);
  if (table === undefined || name === undefined) return undefined;
  return `${table}"${name}`;
}

/**
 * Matches whichever comes first: a dollar-quote tag (`$$` or `$tag$`), the
 * start of a line comment, or the start of a block comment.
 */
const SQL_COMMENT_OR_DOLLAR_TAG_REGEX = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$|--|\/\*/g;

/**
 * Index just past the block comment opening at `start`.
 *
 * Postgres block comments NEST: an inner open-comment token inside an outer
 * one starts a second level, and BOTH must close before the comment ends.
 * Closing at the first close-token instead would leave the outer comment's
 * tail behind as live SQL, where its own text (a stray `;` especially) then
 * splits the statement that follows and drops it from the harvest.
 *
 * An unterminated comment consumes the remainder, as Postgres itself would.
 */
function endOfBlockComment(sql: string, start: number): number {
  let depth = 1;
  let scan = start + 2;
  while (depth > 0) {
    const close = sql.indexOf('*/', scan);
    if (close === -1) return sql.length;
    const open = sql.indexOf('/*', scan);
    if (open !== -1 && open < close) {
      depth += 1;
      scan = open + 2;
    } else {
      depth -= 1;
      scan = close + 2;
    }
  }
  return scan;
}

/**
 * Strip SQL comments while leaving dollar-quoted spans (`$$…$$`,
 * `$tag$…$tag$`) byte-for-byte intact.
 *
 * A blind whole-file comment regex is safe for the short ALTER/CREATE DDL the
 * constraint harvests read, but plpgsql function bodies are arbitrary text: a
 * body containing `--` or `/*` inside a string literal (a URL, example text)
 * would have the rest of that line — or everything up to the next `*` + `/` —
 * deleted, silently corrupting the harvested function or dropping it from the
 * generated schema entirely. A missing trigger means component tests stop
 * exercising production behaviour while still passing, so the corruption is
 * invisible at exactly the layer meant to catch it.
 *
 * An unterminated BLOCK COMMENT consumes the remainder of the input, matching
 * how Postgres itself would read the file. An unmatched dollar-tag does NOT —
 * see the reasoning at the dollar-quote branch below.
 *
 * KNOWN LIMITATION — ordinary single-quoted string literals are NOT tracked,
 * which has two consequences, both bounded:
 *
 * 1. A comment token inside one that sits OUTSIDE any dollar-quoted span (say
 *    a `DEFAULT 'foo--bar'` on a plain `ALTER TABLE`) is read as a real
 *    comment start, losing the rest of that line or block.
 * 2. A `$word$`-shaped run inside such a literal is read as a dollar-tag. If
 *    the same run appears again later it opens a bogus "span" and the text
 *    between them survives un-stripped; if it does not appear again the tag is
 *    treated as ordinary text (see the dollar-quote branch), so the damage
 *    cannot extend past the second occurrence.
 *
 * Both predate this scanner — the blind regex it replaced mis-handled every
 * comment in a literal — and the plpgsql bodies that motivated the rewrite are
 * all dollar-quoted, which is why the fix stops here. Widening to full literal
 * tracking means a real SQL tokenizer; do that only when a migration actually
 * trips this, not preemptively.
 */
function stripSqlComments(sql: string): string {
  const out: string[] = [];
  let cursor = 0;
  SQL_COMMENT_OR_DOLLAR_TAG_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = SQL_COMMENT_OR_DOLLAR_TAG_REGEX.exec(sql)) !== null) {
    const token = match[0];
    const start = match.index;
    out.push(sql.slice(cursor, start));

    if (token === '--') {
      const newline = sql.indexOf('\n', start);
      cursor = newline === -1 ? sql.length : newline;
    } else if (token === '/*') {
      cursor = endOfBlockComment(sql, start);
    } else {
      // Dollar-quoted span: copy it through verbatim, closing tag included.
      //
      // An UNMATCHED tag is treated as ordinary text (advance past it and
      // keep scanning) rather than as a span running to end-of-file. Every
      // migration under prisma/migrations has been applied by Postgres, so it
      // is valid SQL — a tag with no closing partner was therefore never a
      // real dollar-quote, but a `$word$`-shaped run of characters inside
      // something else (a string literal, a regex in a CHECK expression).
      // Consuming to end-of-file on that guess would silently discard every
      // constraint, index, and trigger declared after it, and the harvest
      // reports no error when it simply sees less input — the exact
      // silent-under-collection failure this scanner exists to prevent.
      const close = sql.indexOf(token, start + token.length);
      cursor = close === -1 ? start + token.length : close + token.length;
      out.push(sql.slice(start, cursor));
    }

    SQL_COMMENT_OR_DOLLAR_TAG_REGEX.lastIndex = cursor;
  }

  out.push(sql.slice(cursor));
  return out.join('');
}

/**
 * Parse one migration.sql file and emit the add/drop operations matched by
 * the spec's regex pair. Strips line-comments and block-comments (outside
 * dollar-quoted spans — see `stripSqlComments`) before splitting on `;`:
 * block comments matter because a block-comment body can contain a raw `;`
 * that would split the surrounding statement in half and silently drop the
 * statement that followed.
 *
 * Prisma migrations use `;` as the unambiguous statement terminator even
 * across line breaks. Harvested expressions can contain nested parens but
 * never a raw `;`, so splitting here is safer than a multi-line regex that
 * has to balance parens.
 *
 * Drops are emitted alongside adds so the last-wins dedup in
 * `harvestLastWins` can remove a previously-added statement when a later
 * migration retires it without re-adding (else PGLite would enforce DDL that
 * prod Postgres no longer has, producing confusing test false positives).
 */
function extractOpsFromFile(sqlPath: string, spec: HarvestSpec): ExtractedOp[] {
  const raw = readFileSync(sqlPath, 'utf-8');
  const uncommented = stripSqlComments(raw);
  const results: ExtractedOp[] = [];

  for (const stmt of uncommented.split(';')) {
    const trimmed = stmt.trim();
    if (trimmed.length === 0) continue;

    const addMatch = spec.addRegex.exec(trimmed);
    if (addMatch !== null) {
      const key = dedupKeyFor(addMatch, spec.tableScoped);
      // Unreachable per the regexes (`"[^"]+"` requires the capture), but TS
      // sees the groups as string | undefined.
      if (key === undefined) continue;
      results.push({
        kind: 'add',
        key,
        statement: normalizeStatement(trimmed) + ';',
      });
      continue;
    }

    const dropMatch = spec.dropRegex.exec(trimmed);
    if (dropMatch !== null) {
      const key = dedupKeyFor(dropMatch, spec.tableScoped);
      // Unreachable per the regexes; guard satisfies TS's view of the groups.
      if (key === undefined) continue;
      results.push({ kind: 'drop', key });
    }
  }
  return results;
}

/**
 * Extract all statements matching the spec's add regex from every
 * `migration.sql` under `migrationsDir`, applying last-wins dedup by the
 * spec's key (see `HarvestSpec`). When the same key appears in multiple
 * migrations (drop + re-add across two files, or a same-file drop-then-add
 * pair), the **last** definition wins — this matches Postgres's own
 * semantics: after migration B drops and re-adds a constraint, prod enforces
 * migration B's definition, not migration A's. First-wins would silently ship
 * the stale definition into PGLite while prod runs the latest one,
 * re-introducing the fidelity gap the harvest exists to eliminate. A drop
 * without re-add removes the entry entirely.
 */
function harvestLastWins(migrationsDir: string, spec: HarvestSpec): string[] {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  const migrationFolders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    // Prisma prefixes folders with `YYYYMMDDHHMMSS_`, so lexicographic sort
    // matches chronological sort — essential for the last-wins dedup below.
    .sort();

  // Map.set overwrites existing entries while preserving insertion order.
  // Iterating chronologically means later migrations replace earlier ones
  // by key while the overall emission order stays deterministic.
  const byKey = new Map<string, string>();

  for (const folder of migrationFolders) {
    const sqlPath = join(migrationsDir, folder, 'migration.sql');
    if (!existsSync(sqlPath)) continue;

    for (const op of extractOpsFromFile(sqlPath, spec)) {
      if (op.kind === 'add') {
        byKey.set(op.key, op.statement);
      } else {
        // Drop without subsequent re-add must remove the prior definition.
        // A drop-then-re-add pair (across files or within one) is handled
        // correctly by the natural sequence: this delete fires, then the
        // following add repopulates with the new statement.
        byKey.delete(op.key);
      }
    }
  }

  return Array.from(byKey.values());
}

/** All `ADD CONSTRAINT ... CHECK (...)` statements, last-wins deduped. */
export function extractCheckConstraints(migrationsDir: string): string[] {
  return harvestLastWins(migrationsDir, CHECK_CONSTRAINT_SPEC);
}

/** All partial `CREATE UNIQUE INDEX ... WHERE ...` statements, last-wins deduped. */
export function extractPartialUniqueIndexes(migrationsDir: string): string[] {
  return harvestLastWins(migrationsDir, PARTIAL_UNIQUE_INDEX_SPEC);
}

/** All `ALTER CONSTRAINT ... DEFERRABLE ...` statements, last-wins deduped. */
export function extractDeferrableConstraints(migrationsDir: string): string[] {
  return harvestLastWins(migrationsDir, DEFERRABLE_CONSTRAINT_SPEC);
}

/**
 * plpgsql function definitions can't go through the `;`-split path — their
 * dollar-quoted bodies contain raw `;`. These regexes run against the WHOLE
 * uncommented file text instead. Trigger statements never contain `;`, so
 * the non-greedy terminator match is safe for them.
 */
// Linear-time by construction (regexp/no-super-linear-backtracking): the
// header segment excludes '$' outright, and the body matcher only lets a
// lone '$' through when it is NOT opening the closing '$$' — no two
// quantifiers can exchange characters.
const CREATE_FUNCTION_REGEX =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)[^$]*\$\$(?:[^$]|\$(?!\$))*\$\$\s+LANGUAGE\s+plpgsql\s*;/gi;
const DROP_FUNCTION_REGEX = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi;
/**
 * Trigger add/drop, each capturing (name, table) — trigger names are unique
 * only WITHIN a table (the same rule as constraints, see `HarvestSpec`), so
 * the harvest keys on both.
 *
 * The optional quotes around the table are OUTSIDE the capture group on
 * purpose. Both forms appear in this repo's own migrations — Prisma emits
 * `ON "conversation_history"` while the hand-written cache-invalidation
 * migrations use `ON personalities` — and a `DROP TRIGGER x ON t` must key
 * identically to the `CREATE TRIGGER x ... ON "t"` it retires. Capturing the
 * quotes would make those two keys differ, so the drop would stop matching
 * its add and the retired trigger would survive into the generated schema.
 *
 * `[^;]*?` before `ON` is non-greedy so the FIRST `ON` after the trigger name
 * is taken as the table's — the timing clause (`AFTER INSERT OR UPDATE`,
 * `AFTER UPDATE OF col`) never contains one, and `WHEN (...)` follows.
 */
// Linear-time by construction (regexp/no-super-linear-backtracking): each
// identifier group is followed by `(?![A-Za-z0-9_])`, which forces it to
// consume every word character it can. Without that, the group could give a
// character back to the adjoining `[^;]*` gap and the two would exchange
// characters — polynomial backtracking on a long statement. A bare `\b` does
// not fix it: `\b` still holds at the shortened split point.
const CREATE_TRIGGER_REGEX =
  /CREATE\s+TRIGGER\s+([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_])[^;]*?\bON\s+"?([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_])"?[^;]*;/gi;
const DROP_TRIGGER_REGEX =
  /DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_])\s+ON\s+"?([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_])"?/gi;

/**
 * Whole-file variant of the harvest: collects add/drop matches WITH their
 * file positions so within-file ordering holds — trigger migrations use the
 * idempotent `DROP TRIGGER IF EXISTS x; CREATE TRIGGER x ...` pattern, and a
 * position-blind pass would apply the drop after the add and lose it.
 * Last-wins by name across chronologically-sorted migration files, exactly
 * like `harvestLastWins`.
 */
function harvestWholeFileLastWins(
  migrationsDir: string,
  addRegex: RegExp,
  dropRegex: RegExp,
  tableScoped = false
): string[] {
  if (!existsSync(migrationsDir)) {
    return [];
  }
  const migrationFolders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  // Same separator rationale as `dedupKeyFor`: every group here is an
  // identifier charset that cannot contain a quote, so no two (table, name)
  // pairs can collide by concatenation.
  const keyOf = (match: RegExpMatchArray): string =>
    tableScoped ? `${match[2]}"${match[1]}` : match[1];

  const byKey = new Map<string, string>();
  for (const folder of migrationFolders) {
    const sqlPath = join(migrationsDir, folder, 'migration.sql');
    if (!existsSync(sqlPath)) continue;
    const raw = readFileSync(sqlPath, 'utf-8');
    // Dollar-quote-aware: a plpgsql body's own string literals may contain
    // `--` or `/*`, and blind stripping would truncate the harvested body.
    const uncommented = stripSqlComments(raw);

    const ops: { index: number; kind: 'add' | 'drop'; key: string; statement?: string }[] = [];
    for (const match of uncommented.matchAll(addRegex)) {
      ops.push({
        index: match.index ?? 0,
        kind: 'add',
        key: keyOf(match),
        statement: match[0].trim(),
      });
    }
    for (const match of uncommented.matchAll(dropRegex)) {
      ops.push({ index: match.index ?? 0, kind: 'drop', key: keyOf(match) });
    }
    ops.sort((a, b) => a.index - b.index);
    for (const op of ops) {
      if (op.kind === 'add' && op.statement !== undefined) {
        byKey.set(op.key, op.statement);
      } else {
        byKey.delete(op.key);
      }
    }
  }
  return Array.from(byKey.values());
}

/** All plpgsql `CREATE FUNCTION` bodies, last-wins deduped by function name. */
export function extractPlpgsqlFunctions(migrationsDir: string): string[] {
  return harvestWholeFileLastWins(migrationsDir, CREATE_FUNCTION_REGEX, DROP_FUNCTION_REGEX);
}

/** All `CREATE TRIGGER` statements, last-wins deduped by trigger name. */
export function extractTriggers(migrationsDir: string): string[] {
  // Table-scoped: trigger names are unique per table, not per schema, so two
  // tables may legitimately carry the same trigger name (a repeated
  // `set_updated_at` convention). Functions above stay name-keyed — THEIR
  // names are schema-scoped.
  return harvestWholeFileLastWins(migrationsDir, CREATE_TRIGGER_REGEX, DROP_TRIGGER_REGEX, true);
}

/**
 * Generate PGLite-compatible SQL schema from Prisma
 */
export async function generateSchema(options: GenerateSchemaOptions = {}): Promise<void> {
  const rootDir = process.cwd();
  const outputPath =
    options.output ?? join(rootDir, 'packages', 'test-utils', 'schema', 'pglite-schema.sql');
  const migrationsDir = join(rootDir, 'prisma', 'migrations');

  console.log(chalk.cyan('Generating PGLite schema from Prisma...'));

  try {
    // Set dummy DATABASE_URL if not already set
    const env = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? DUMMY_DATABASE_URL,
    };

    // Run prisma migrate diff using execFileSync (no shell injection)
    const schemaPath = join(rootDir, 'prisma', 'schema.prisma');
    const baseSql = execFileSync(
      'npx',
      ['prisma', 'migrate', 'diff', '--from-empty', '--to-schema', schemaPath, '--script'],
      {
        encoding: 'utf-8',
        env,
        cwd: rootDir,
        stdio: ['pipe', 'pipe', 'pipe'], // Capture stderr
      }
    );

    // Append the DDL Prisma's schema-level diff can't represent, harvested
    // from the hand-written migration SQL: CHECK constraints, partial-unique
    // indexes, and DEFERRABLE-constraint ALTERs. Without the merge, PGLite-
    // backed tests silently diverge from prod Postgres on each front.
    const checkStatements = extractCheckConstraints(migrationsDir);
    const partialUniqueStatements = extractPartialUniqueIndexes(migrationsDir);
    // Appended AFTER the base diff, which contains every ADD CONSTRAINT the
    // ALTERs reference — so the harvested statements always find their target.
    const deferrableStatements = extractDeferrableConstraints(migrationsDir);
    // Functions BEFORE triggers — triggers reference them.
    const functionStatements = extractPlpgsqlFunctions(migrationsDir);
    const triggerStatements = extractTriggers(migrationsDir);

    const harvestedSections: string[] = [];
    if (checkStatements.length > 0) {
      harvestedSections.push(`${CHECK_CONSTRAINT_BANNER}\n${checkStatements.join('\n')}`);
    }
    if (partialUniqueStatements.length > 0) {
      harvestedSections.push(
        `${PARTIAL_UNIQUE_INDEX_BANNER}\n${partialUniqueStatements.join('\n')}`
      );
    }
    if (deferrableStatements.length > 0) {
      harvestedSections.push(`${DEFERRABLE_CONSTRAINT_BANNER}\n${deferrableStatements.join('\n')}`);
    }
    if (functionStatements.length > 0 || triggerStatements.length > 0) {
      harvestedSections.push(
        `${TRIGGER_BANNER}\n${[...functionStatements, ...triggerStatements].join('\n\n')}`
      );
    }

    // Only reshape the base SQL when there's something to append — otherwise
    // emit Prisma's diff verbatim (preserving its existing trailing-newline
    // shape). Each harvested section is separated by a blank line and the file
    // ends with a single trailing newline.
    const sql =
      harvestedSections.length > 0
        ? `${baseSql.trimEnd()}\n\n${harvestedSections.join('\n\n')}\n`
        : baseSql;

    // Write output
    writeFileSync(outputPath, sql);

    // Count lines
    const lines = sql.split('\n').length;

    console.log(
      chalk.green(
        `Generated ${outputPath} (${lines} lines, ${checkStatements.length} CHECK constraints, ` +
          `${partialUniqueStatements.length} partial-UNIQUE indexes, ` +
          `${deferrableStatements.length} DEFERRABLE constraints preserved)`
      )
    );
    console.log(chalk.dim('Remember to commit the updated schema file.'));
  } catch (error) {
    console.error(chalk.red('Failed to generate schema'));

    if (error instanceof Error) {
      // Check for common issues
      if (error.message.includes('prisma')) {
        console.error(chalk.dim('Make sure Prisma is installed: pnpm install'));
      }
      console.error(chalk.dim(error.message));
    }

    process.exitCode = 1;
  }
}
