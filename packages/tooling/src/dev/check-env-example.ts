/**
 * Guard: `.env` and `.env.example` must declare the same ACTIVE keys.
 *
 * `.env.example` is the tracked template for the gitignored `.env`; the two
 * should differ only in their values. Nothing else notices when a key is added
 * to one and not the other, because `.env` never reaches a commit or CI — so
 * this runs from `.husky/pre-push` only, and skips cleanly wherever `.env` is
 * absent (CI, agent worktrees, fresh clones).
 *
 * A key is ACTIVE when its line is `KEY=...` or `export KEY=...`. A commented
 * row (`# KEY=`) documents an optional key and is ignored, as are blank lines;
 * values and inline comments are irrelevant to the comparison.
 *
 * SECURITY: `.env` holds real secrets. This module only ever surfaces key
 * NAMES — never a value, never a raw line (pinned by the sentinel test in
 * `check-env-example.test.ts`). A quoted value that spans several lines is
 * tracked to its closing quote so a continuation line shaped like `ABC=` (a
 * base64 chunk ending in padding, say) is never mistaken for a key and echoed.
 *
 * Binary sync-check (like guard:monitor-command), NOT audit-class: no
 * threshold, no WHY.md, no --summary.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ENV_FILE = '.env';
export const ENV_EXAMPLE_FILE = '.env.example';

/**
 * An active assignment line. The `^\s*` anchor is also what ignores commented
 * rows: `#` is not whitespace, so `# KEY=` can never match. Group 1 is the key;
 * group 2 is the raw value (leading whitespace included, trimmed by the caller),
 * read only to detect an unterminated opening quote. No `\s*` sits after the
 * `=`: next to `(.*)` it would make the match ambiguous (regexp lint rule).
 */
const ACTIVE_KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

const QUOTE_CHARS = new Set(['"', "'", '`']);

/** True when `text` contains `quote` not preceded by a backslash escape. */
function containsClosingQuote(text: string, quote: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
    } else if (text[i] === quote) {
      return true;
    }
  }
  return false;
}

/** The quote a value opens and does not close on its own line, if any. */
function unterminatedQuote(value: string): string | null {
  const first = value.charAt(0);
  if (!QUOTE_CHARS.has(first)) {
    return null;
  }
  return containsClosingQuote(value.slice(1), first) ? null : first;
}

/** The set of active key names declared by one env file's contents. */
export function parseEnvKeys(contents: string): Set<string> {
  const keys = new Set<string>();
  let openQuote: string | null = null;

  for (const line of contents.split(/\r?\n/)) {
    if (openQuote !== null) {
      if (containsClosingQuote(line, openQuote)) {
        openQuote = null;
      }
      continue;
    }
    const match = ACTIVE_KEY_LINE.exec(line);
    if (match === null) {
      continue;
    }
    keys.add(match[1]);
    openQuote = unterminatedQuote(match[2].trimStart());
  }

  return keys;
}

export interface EnvKeyDrift {
  /** Keys active in `.env` with no active row in `.env.example`, sorted. */
  envOnly: string[];
  /** Keys active in `.env.example` with no active row in `.env`, sorted. */
  exampleOnly: string[];
}

export function diffEnvKeys(envKeys: Set<string>, exampleKeys: Set<string>): EnvKeyDrift {
  return {
    envOnly: [...envKeys].filter(key => !exampleKeys.has(key)).sort(),
    exampleOnly: [...exampleKeys].filter(key => !envKeys.has(key)).sort(),
  };
}

export function checkEnvExample(): void {
  const rootDir = process.cwd();
  const envPath = join(rootDir, ENV_FILE);
  const examplePath = join(rootDir, ENV_EXAMPLE_FILE);

  if (!existsSync(examplePath)) {
    console.error(`❌ ${ENV_EXAMPLE_FILE} not found at the repo root; it is a tracked file.`);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(envPath)) {
    console.log(`⏭️  guard:env-example skipped: no ${ENV_FILE} at the repo root.`);
    return;
  }

  const exampleKeys = parseEnvKeys(readFileSync(examplePath, 'utf-8'));
  const drift = diffEnvKeys(parseEnvKeys(readFileSync(envPath, 'utf-8')), exampleKeys);

  if (drift.envOnly.length === 0 && drift.exampleOnly.length === 0) {
    console.log(`✓ ${ENV_FILE} and ${ENV_EXAMPLE_FILE} declare the same ${exampleKeys.size} keys.`);
    return;
  }

  console.error(`❌ ${ENV_FILE} and ${ENV_EXAMPLE_FILE} declare different active keys.`);
  if (drift.envOnly.length > 0) {
    console.error(`  in ${ENV_FILE} but not ${ENV_EXAMPLE_FILE}: ${drift.envOnly.join(', ')}`);
  }
  if (drift.exampleOnly.length > 0) {
    console.error(`  in ${ENV_EXAMPLE_FILE} but not ${ENV_FILE}: ${drift.exampleOnly.join(', ')}`);
  }
  console.error(
    `\nGive every key an active row in both files (a placeholder or blank value in ` +
      `${ENV_EXAMPLE_FILE}, never a real one). An optional key the template only ` +
      'documents stays commented out (`# KEY=`), which this check ignores.'
  );
  process.exitCode = 1;
}
