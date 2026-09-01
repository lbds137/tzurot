/**
 * Migration-file scanning for `release:premigrate`.
 *
 * Extracted from `premigrate.ts` (which orchestrates the gates and the
 * actual `prisma migrate deploy`) purely to keep that file under the
 * `max-lines` ESLint cap — this module owns no orchestration of its own, it
 * only reads migration `.sql` files and classifies them: destructive shapes
 * (`scanDestructive`) and the apply-after-deploy marker (`scanMarked`,
 * `hasApplyAfterDeployMarker`).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';

/**
 * Opt-in SQL comment declaring "this migration must run AFTER the new code is
 * live." Its use case is a migration whose SQL reads additive to the keyword
 * scan but whose EFFECT breaks the still-live old code — typically a pure-DML
 * reshape of data the old code still reads (a JSONB key rename, a value
 * re-encoding). The scan cannot infer that from the DDL, so the author
 * declares it.
 *
 * Written on its own line in the migration's `.sql`.
 */
export const APPLY_AFTER_DEPLOY_MARKER = '-- tzurot:apply-after-deploy';

/**
 * Line-anchored and comment-anchored, so the marker only counts as a
 * declaration when it IS the comment — a migration that merely mentions the
 * token inside a statement or in prose does not trip it. Case-sensitive, and
 * end-anchored so ANY continuation after the token (`...-deployX`,
 * `...-deploy-staging`) falls through to the near-miss warning instead of
 * silently counting as the exact marker. Kept deliberately
 * outside the statement-splitting machinery: for the marker's intended
 * single-line-comment use the `^--` anchor rules out string-literal false
 * positives — with one accepted caveat: a MULTI-line string literal whose
 * payload contains a marker-shaped line would still match. That direction
 * fails safe (over-refusal the operator resolves, never a silently-missed
 * real marker), so it stays raw-text rather than statement-aware.
 *
 * The indent classes are HORIZONTAL whitespace only, never `\s`: under `/m`,
 * a `\s*` that can consume newlines lets the same match be retried from every
 * preceding line start, which is super-linear on input that never matches
 * (`regexp/no-super-linear-move` flags it). A marker's own indentation is
 * spaces or tabs, so nothing is lost.
 */
const APPLY_AFTER_DEPLOY_RE = /^[ \t]*--[ \t]*tzurot:apply-after-deploy[ \t]*\r?$/m;

/** Whether the migration SQL carries the apply-after-deploy declaration. */
export function hasApplyAfterDeployMarker(sql: string): boolean {
  return APPLY_AFTER_DEPLOY_RE.test(sql);
}

/**
 * Heuristic markers for migration SQL that breaks the still-live old code when
 * applied before the merge. Fallible by design — this gates and warns; the
 * human makes the final call (a complex CHECK-constraint tighten or a data
 * rewrite the patterns don't match still needs operator judgment).
 */
const DESTRUCTIVE_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'DROP COLUMN', re: /\bDROP\s+COLUMN\b/i },
  { label: 'DROP TABLE', re: /\bDROP\s+TABLE\b/i },
  { label: 'RENAME COLUMN', re: /\bRENAME\s+COLUMN\b/i },
  { label: 'RENAME TO', re: /\bRENAME\s+TO\b/i },
  // May false-positive on a new-column backfill-then-constrain (the new column
  // is additive-in-spirit, so old code never writes a null) — operator overrides
  // with --allow-destructive.
  { label: 'SET NOT NULL', re: /\bSET\s+NOT\s+NULL\b/i },
  { label: 'DROP CONSTRAINT', re: /\bDROP\s+CONSTRAINT\b/i },
  // A type change can break old writes (e.g. TEXT→INTEGER); a widening
  // (INT→BIGINT) is benign but flags anyway — over-warning is the safe
  // direction. `[^;]` bounds the match to a single statement (no greedy span).
  { label: 'ALTER COLUMN TYPE', re: /\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i },
];

/** A possibly-quoted, possibly-schema-qualified table reference in DDL. */
const TABLE_REF = String.raw`(?:"[^"]+"|\w+)(?:\.(?:"[^"]+"|\w+))?`;

const CREATE_TABLE_RE = new RegExp(
  String.raw`\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${TABLE_REF})`,
  'i'
);

// Captures the FULL comma-separated table list: `DROP TABLE a, b;` is one
// statement targeting several tables (ALTER TABLE only ever targets one).
const TARGET_TABLES_RE = new RegExp(
  String.raw`\b(?:ALTER|DROP)\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${TABLE_REF}(?:\s*,\s*${TABLE_REF})*)`,
  'i'
);

/** Strip quotes + schema qualifier so `"public"."memory_facts"` ≡ `memory_facts`. */
function normalizeTableRef(ref: string): string {
  const parts = ref.split('.').map(p => p.replace(/"/g, '').toLowerCase());
  return parts[parts.length - 1];
}

/**
 * Every table the statement targets, or null when none is identifiable
 * (no-target → the caller keeps the hit; over-warning is the safe direction).
 */
function statementTargetTables(statement: string): string[] | null {
  const match = TARGET_TABLES_RE.exec(statement);
  if (match === null) {
    return null;
  }
  return match[1].split(',').map(ref => normalizeTableRef(ref.trim()));
}

/**
 * Split migration SQL into comment-stripped statements, so a `--` or
 * `/* *\/` comment that merely MENTIONS a destructive keyword (a migration
 * header explaining why it looks destructive, for instance) doesn't trip the
 * scan, and a `;` that only appears inside a string or dollar-quoted body
 * doesn't fracture one real statement into two.
 *
 * String-literal aware for both quote kinds SQL uses: `'...'` (string
 * literals) and `"..."` (quoted identifiers, e.g. `"foo--bar"` naming a
 * column) each track their OWN quote character as the active context — a
 * `"` inside a `'...'` string, or vice versa, is just data. Both kinds use
 * the same doubled-quote escape for an embedded literal quote (`''` inside a
 * string, `""` inside an identifier), and both get it "for free" from the
 * same toggle: closing then immediately reopening the SAME quote character
 * leaves no character in between for a comment marker to land on, so the net
 * effect is the same as never leaving the quoted context.
 *
 * Also recognizes dollar-quoted strings (`$$...$$` / `$tag$...$tag$`, used
 * for several existing PL/pgSQL trigger-function and `DO` bodies in this
 * repo's migrations — at least one contains a `'` inside, e.g. a
 * `RAISE EXCEPTION` message literal). The whole quoted span, opener through
 * matching closer, is kept as ONE UNIT — including any `;` inside it, which
 * is why it can't fracture a statement — because it's PL/pgSQL source, not
 * top-level SQL for THIS pass to split. But comments are comments in
 * PL/pgSQL too: `--`/`/* *\/` comments inside the span's inner content ARE
 * stripped (recursively, through any nested dollar spans), while quoted
 * (`'...'`/`"..."`) content and everything else survives untouched. A
 * DIFFERENT tag nested inside (e.g. `$inner$` inside `$outer$...$outer$`) is
 * itself walked the same way, one level at a time — only the matching closer
 * for the OPENING tag ends the OUTER span. An unterminated dollar-quote (no
 * matching closer before end of input) runs to end of input, same handling
 * as an unterminated block comment. Non-comment content INSIDE a
 * dollar-quoted span is still scanned for destructive keywords by the caller
 * (it's real SQL that could genuinely execute) — this pass only removes
 * comments and protects the span's OWN boundaries and surrounding context.
 *
 * Without the quote tracking, an odd (unbalanced) quote count inside a
 * dollar-quoted body leaves the tracker stuck "inside a string" for the rest
 * of the file, which does NOT delete any code — every character is still
 * copied through — but it DOES stop later `--`/`/* *\/` comments from being
 * recognized and stripped, or the following `;` from splitting statements.
 * A leftover, unstripped comment mentioning `CREATE TABLE <name>` can then
 * satisfy `scanSqlForDestructive`'s created-earlier-in-file exemption for a
 * table name that was never actually created, silently exempting a REAL
 * later `DROP`/`RENAME`/etc. on that same table — the concrete fail-open
 * path, not a merely theoretical one. Same reasoning for double-quoted
 * identifiers: without tracking them, `"foo--bar"` strips from the `--` to
 * end of line, deleting real DDL from the scan. Without stripping comments
 * INSIDE a dollar body specifically, even a perfectly BALANCED body (no
 * quote-parity desync at all) leaks a comment mentioning `CREATE TABLE
 * <name>` straight into the scanned statement — the same exemption bug via a
 * third route, needing no unbalanced quote to trigger it.
 *
 * One known gap, fail-closed direction (consistent with this file's
 * over-warning-is-safe stance): nested block comments (`/* /* *\/ *\/`,
 * Postgres-legal) aren't handled — the inner `*\/` ends the tracked comment
 * early, so the outer `*\/` and anything after briefly reads as live SQL
 * until the next real comment or string context, which can only cause
 * OVER-flagging, never a miss. Same direction for an UNQUOTED identifier
 * containing two `$`s (`col$tag$suffix`, Postgres-legal): the first `$`
 * can be misread as a dollar-quote opener, and with no real closer the
 * "span" runs to end of input, folding the rest of the file into one
 * statement — again over-flagging, never a miss.
 *
 * Returns each statement TWICE: `text` (comment-stripped, everything else
 * intact — what `DESTRUCTIVE_PATTERNS`/`statementTargetTables` scan) and
 * `masked` (comments stripped AND single-quoted literal content AND
 * dollar-quoted span inner content blanked to spaces — what
 * `CREATE_TABLE_RE`'s created-earlier registration scans). The split exists
 * because a `'...'` literal or a dollar body can contain arbitrary TEXT that
 * happens to read as `CREATE TABLE <name>` without creating anything real —
 * e.g. `INSERT INTO changelog (msg) VALUES ('...like a CREATE TABLE
 * staging_data...')` — and registering that name would wrongly exempt a
 * REAL later `DROP TABLE staging_data;`. Double-quoted identifier content is
 * deliberately NOT blanked in `masked`: Prisma emits real DDL as `CREATE
 * TABLE "name"`, so blanking identifiers would break the created-earlier
 * exemption for every actual Prisma migration — the exact false-positive
 * class the exemption exists to prevent. `DESTRUCTIVE_PATTERNS` and
 * `statementTargetTables` deliberately keep scanning the UNMASKED `text`:
 * fail-closed (a literal mentioning a destructive keyword still over-flags),
 * and a literal-sourced target can only ever be EXEMPTED by a REAL create
 * (masked strips the literal from THAT side), never the reverse.
 *
 * Accepted residual: a pathological double-quoted IDENTIFIER whose own name
 * literally contains `CREATE TABLE x` text could still register — masking
 * can't blank identifier content (that's the load-bearing exception above),
 * and an identifier is structurally part of DDL either way. Narrow and
 * contrived; not addressed.
 */
function splitSqlStatements(sql: string): { text: string; masked: string }[] {
  const statements: { text: string; masked: string }[] = [];
  let text = '';
  let masked = '';
  let activeQuote: QuoteChar | null = null;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (activeQuote !== null) {
      text += ch;
      masked += activeQuote === "'" ? ' ' : ch;
      if (ch === activeQuote) activeQuote = null;
      i++;
      continue;
    }
    if (ch === ';') {
      statements.push({ text, masked });
      text = '';
      masked = '';
      i++;
      continue;
    }
    const step = stepOutsideString(sql, i);
    text += step.append;
    masked += step.maskedAppend;
    i = step.next;
    if (step.opensQuote !== null) activeQuote = step.opensQuote;
  }
  statements.push({ text, masked });
  return statements;
}

/** A SQL quote character tracked as an active string/identifier context. */
type QuoteChar = "'" | '"';

/** Index just past the end of a `--` line comment starting at `i` (the newline itself is left for the caller to copy through). */
function skipLineComment(sql: string, i: number): number {
  let j = i;
  while (j < sql.length && sql[j] !== '\n') j++;
  return j;
}

/** Index just past the closing delimiter of a block comment starting at `i`. */
function skipBlockComment(sql: string, i: number): number {
  let j = i + 2;
  while (j < sql.length && !(sql[j] === '*' && sql[j + 1] === '/')) j++;
  return j + 2;
}

/** A dollar-quote opener/closer tag: `$$` or `$name$` (name starts with a letter/underscore). */
const DOLLAR_QUOTE_TAG_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * Comments are comments in PL/pgSQL too, so a `--`/`/* *\/` comment inside a
 * dollar-quoted body is stripped just like one outside — the SAME walk as
 * `splitSqlStatements`, minus the `;`-splitting (a dollar body's own `;` is
 * never a statement boundary). Quoted content (`'...'`, `"..."`) and OTHER
 * dollar-quoted spans nested inside are preserved untouched: `matchDollarQuote`
 * calls this function on ITS OWN inner content before returning, so a nested
 * span gets its comments stripped recursively, one level at a time, the same
 * way the outer one does — each level's search is strictly inside its
 * parent's already-shorter substring, so this always terminates.
 */
function stripCommentsPreservingQuotes(sql: string): string {
  let result = '';
  let activeQuote: QuoteChar | null = null;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (activeQuote !== null) {
      result += ch;
      if (ch === activeQuote) activeQuote = null;
      i++;
      continue;
    }
    const step = stepOutsideString(sql, i);
    result += step.append;
    i = step.next;
    if (step.opensQuote !== null) activeQuote = step.opensQuote;
  }
  return result;
}

/**
 * If `sql[i]` starts a dollar-quoted string, the whole span (opener through
 * matching closer, or to end of input if unterminated), with any comments in
 * its INNER content stripped; otherwise `null` so the caller treats `$` as an
 * ordinary character. Two replacement forms: `text` keeps quoted content and
 * nested dollar spans intact (comments are the only thing removed); `masked`
 * additionally blanks the ENTIRE inner content to spaces — a dollar body is
 * PL/pgSQL source that could contain anything, so `masked` treats it the
 * same as a single-quoted literal for created-earlier registration purposes
 * (see `splitSqlStatements`). `text` can be SHORTER than the source span
 * whenever a comment was removed, so the source extent is returned
 * separately as `sourceLength` — the caller must advance by THAT, never by
 * `text.length`, or it resumes mid-span and re-walks the tail.
 */
function matchDollarQuote(
  sql: string,
  i: number
): { text: string; masked: string; sourceLength: number } | null {
  if (sql[i] !== '$') return null;
  const openerMatch = DOLLAR_QUOTE_TAG_RE.exec(sql.slice(i));
  if (openerMatch === null) return null;
  const tag = openerMatch[0];
  const innerStart = i + tag.length;
  const closerIndex = sql.indexOf(tag, innerStart);
  const hasCloser = closerIndex !== -1;
  const sourceEnd = hasCloser ? closerIndex + tag.length : sql.length;
  const rawInner = sql.slice(innerStart, hasCloser ? closerIndex : sql.length);
  const strippedInner = stripCommentsPreservingQuotes(rawInner);
  const closer = hasCloser ? tag : '';
  return {
    text: tag + strippedInner + closer,
    masked: tag + ' '.repeat(strippedInner.length) + closer,
    sourceLength: sourceEnd - i,
  };
}

/**
 * One step outside any active quoted context: recognizes the start of a
 * `'...'` string or `"..."` quoted identifier, `--`/`/*` comments, and
 * dollar-quotes, falling back to copying an ordinary character. Returns two
 * replacement forms (`append` for `text`, `maskedAppend` for `masked` — see
 * `splitSqlStatements`) and the index to resume from, plus which quote
 * character (if any) the appended character opens — the only case the
 * caller's `activeQuote` state needs to change here; closing an active quote
 * is handled on the caller's own active-quote branch.
 */
function stepOutsideString(
  sql: string,
  i: number
): { append: string; maskedAppend: string; next: number; opensQuote: QuoteChar | null } {
  const ch = sql[i];
  if (ch === "'" || ch === '"') {
    // The single-quote delimiter itself is blanked too, for symmetry with
    // the interior chars the caller's active-quote branch blanks; harmless
    // either way since a lone quote can't form part of a keyword match.
    return { append: ch, maskedAppend: ch === "'" ? ' ' : ch, next: i + 1, opensQuote: ch };
  }
  if (ch === '-' && sql[i + 1] === '-') {
    const next = skipLineComment(sql, i);
    return { append: '', maskedAppend: '', next, opensQuote: null };
  }
  if (ch === '/' && sql[i + 1] === '*') {
    // preserve a token boundary where the comment stood
    const next = skipBlockComment(sql, i);
    return { append: ' ', maskedAppend: ' ', next, opensQuote: null };
  }
  const dollarQuote = matchDollarQuote(sql, i);
  if (dollarQuote !== null) {
    return {
      append: dollarQuote.text,
      maskedAppend: dollarQuote.masked,
      next: i + dollarQuote.sourceLength,
      opensQuote: null,
    };
  }
  return { append: ch, maskedAppend: ch, next: i + 1, opensQuote: null };
}

/**
 * Scan one migration file's SQL statement-by-statement for destructive shapes.
 *
 * A destructive statement targeting a table CREATEd **earlier in the same
 * file** is exempt: prod doesn't have that table until this migration runs,
 * so nothing live can break (e.g. CREATE TABLE + ALTER COLUMN TYPE on the new
 * table in one file — a false positive that previously forced
 * --allow-destructive). Order matters deliberately: DROP-then-reCREATE of the
 * same name destroys prod data, and stays flagged because the CREATE comes
 * after the DROP.
 *
 * The CREATE-registration check runs on `masked` (blanks literal/dollar-body
 * content); `DESTRUCTIVE_PATTERNS` and `statementTargetTables` run on `text`
 * (unmasked) — see `splitSqlStatements` for why the two differ.
 */
function scanSqlForDestructive(sql: string): string[] {
  const labels: string[] = [];
  const createdEarlier = new Set<string>();
  for (const { text, masked } of splitSqlStatements(sql)) {
    const created = CREATE_TABLE_RE.exec(masked);
    for (const { label, re } of DESTRUCTIVE_PATTERNS) {
      if (!re.test(text)) continue;
      // Exempt ONLY when every targeted table was created earlier in this
      // file — `DROP TABLE new_one, live_one;` must keep its hit for the
      // table that exists in prod.
      const targets = statementTargetTables(text);
      if (targets?.every(t => createdEarlier.has(t)) === true) continue;
      if (!labels.includes(label)) labels.push(label);
    }
    // Register AFTER scanning the statement itself, so a hypothetical
    // single-statement create+destroy can't self-exempt.
    if (created !== null) createdEarlier.add(normalizeTableRef(created[1]));
  }
  return labels;
}

/**
 * Extract a Node.js filesystem error's `code` (e.g. `ENOENT`, `EACCES`), or
 * `undefined` when the thrown value isn't a code-bearing error object — a
 * caught value is `unknown` by design (`strict: true`), and a bare
 * `new Error('EACCES')` (a message, not a code) is exactly the code-less
 * shape that must be treated as unidentified, not as a positive ENOENT match.
 */
function readErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const code = err.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Read one migration file for a scan, or return null with a warning — but
 * only for `ENOENT`. That specific case is legitimate: the release-range git
 * diff can list a path the local checkout lacks (checkout behind the range),
 * so warn-and-skip is the right degrade. Any OTHER error (`EACCES`, `EISDIR`,
 * a corrupt tree) THROWS instead: an unreadable migration is invisible to
 * BOTH the destructive scan and the apply-after-deploy marker scan, so
 * silently downgrading it to "safe" on a console warning alone would let an
 * unreviewed migration premigrate. Shared by both scans for the read-and-warn
 * shape alone — each scan still performs its own read, so a release's files
 * are read once per scan (twice per run), acceptable at a handful of
 * migration files per release.
 *
 * Pinned by `premigrate.test.ts`: the ENOENT case ("warns and skips an
 * unreadable migration file...") and the hard-fail case (EACCES and a
 * code-less error, both for the destructive scan and the apply-after-deploy
 * scan).
 */
function readMigrationFile(repoRoot: string, file: string, scanLabel: string): string | null {
  try {
    return readFileSync(resolve(repoRoot, file), 'utf-8');
  } catch (err) {
    const code = readErrorCode(err);
    if (code === 'ENOENT') {
      console.warn(
        chalk.yellow(
          `  ⚠️  ${file} not found in the local checkout (likely behind the release range) — skipping the ${scanLabel} scan for this file`
        )
      );
      return null;
    }
    throw new Error(
      `Could not read ${file} for the ${scanLabel} scan (${String(code ?? 'unknown error')}). ` +
        'This file would then be scanned by NEITHER safety gate, so premigrating it would apply ' +
        'an unreviewed migration. Fix the read failure (check permissions) and re-run.',
      { cause: err }
    );
  }
}

/** Scan the given migration files for destructive SQL shapes. */
export function scanDestructive(
  repoRoot: string,
  files: string[]
): { file: string; label: string }[] {
  const hits: { file: string; label: string }[] = [];
  for (const file of files) {
    const sql = readMigrationFile(repoRoot, file, 'destructive');
    if (sql === null) continue;
    for (const label of scanSqlForDestructive(sql)) {
      hits.push({ file, label });
    }
  }
  return hits;
}

/**
 * Loose companion to the strict matcher: anything containing the phrase at
 * all. When this fires and the strict form does not, the author almost
 * certainly TRIED to mark the migration and got the format wrong — and a
 * silent false negative here premigrates exactly the migration the marker
 * exists to hold back. Case-insensitive on purpose: an echo of the phrase in
 * ordinary prose is rare enough that a spurious warning is the cheap side of
 * this trade.
 */
const APPLY_AFTER_DEPLOY_LOOSE_RE = /apply-after-deploy/i;

/** The subset of the given migration files carrying the apply-after-deploy marker. */
export function scanMarked(repoRoot: string, files: string[]): string[] {
  const marked: string[] = [];
  for (const file of files) {
    const sql = readMigrationFile(repoRoot, file, 'apply-after-deploy');
    if (sql === null) continue;
    if (hasApplyAfterDeployMarker(sql)) {
      marked.push(file);
    } else if (APPLY_AFTER_DEPLOY_LOOSE_RE.test(sql)) {
      console.warn(
        chalk.yellow(
          `  ⚠️  ${file} mentions apply-after-deploy but not in the recognized form — ` +
            `the marker is exactly \`${APPLY_AFTER_DEPLOY_MARKER}\` on its own comment line. ` +
            'Treating this migration as UNMARKED.'
        )
      );
    }
  }
  return marked;
}
