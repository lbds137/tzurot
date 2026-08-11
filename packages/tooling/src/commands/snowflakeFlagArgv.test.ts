/**
 * Guard: id-valued CLI flags must be read from raw argv, not cac's options.
 *
 * cac parses via mri, which coerces an all-digit value to a Number. A Discord
 * snowflake or BullMQ job id exceeds 2^53, so the coercion silently rewrites
 * its low digits into a different-but-still-plausible id. Stringifying the
 * parsed value does not help — the digits are gone before cac hands it over —
 * so such flags must go through `rawOptionValue(process.argv, flag)`.
 *
 * This has bitten twice: `--channel`/`--user-id` (fixed at introduction) and
 * `--job-id`, which read the parsed value for months and made one prod
 * incident dig report a false-empty across all three services.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const COMMANDS_DIR = dirname(fileURLToPath(import.meta.url));

/** `.option('--flag <placeholder>'` — the declaration, wherever it is wrapped. */
const OPTION_DECLARATION = /'(--[a-z][a-z0-9-]*) <([^>]+)>'/g;

/**
 * How far past a declaration to scan for a UUID annotation. The scan also
 * stops at the next flag literal — options are declared back to back, so an
 * unbounded window reads the NEXT option's `<uuid>` and wrongly exempts this
 * one (`--channel <channelId>` is followed by `--personality <uuid>`).
 */
const ANNOTATION_WINDOW = 300;

interface IdFlag {
  file: string;
  flag: string;
}

/**
 * A flag holds an id when its name ends in `-id`/`-ids` or its placeholder
 * does (`<id>`, `<ids>`, `<channelId>`, `<discordId>`).
 *
 * The plural matters: `--exclude <ids>` takes a comma-separated list, and a
 * list of ONE is a bare all-digit value that coerces like any other. An
 * earlier `/id$/i` test missed it, because "ids" does not end in "id".
 */
function isIdShaped(flag: string, placeholder: string): boolean {
  return /-ids?$/.test(flag) || /ids?$/i.test(placeholder);
}

/**
 * Flags that hold a long digit-capable value without an id-shaped name, so the
 * heuristic cannot see them. Listed explicitly so reverting one of their fixes
 * fails this guard instead of passing silently.
 */
const EXTRA_GUARDED_FLAGS: readonly IdFlag[] = [
  // A 40-char SHA is hex, so an all-digit one is rare but perfectly legal.
  { file: 'gh.ts', flag: '--sha' },
];

function collectIdFlags(): IdFlag[] {
  const found: IdFlag[] = [...EXTRA_GUARDED_FLAGS];

  for (const file of readdirSync(COMMANDS_DIR).filter(
    name => name.endsWith('.ts') && !name.endsWith('.test.ts')
  )) {
    const source = readFileSync(join(COMMANDS_DIR, file), 'utf-8');

    for (const match of source.matchAll(OPTION_DECLARATION)) {
      const [, flag, placeholder] = match;
      if (!isIdShaped(flag, placeholder)) continue;

      // UUIDs carry hyphens, so mri never coerces them — exempt when the
      // declaration or its description says so.
      const after = source.slice(match.index + match[0].length);
      const nextFlag = after.search(/'--[a-z]/);
      const window =
        match[0] +
        after.slice(0, nextFlag === -1 ? ANNOTATION_WINDOW : Math.min(nextFlag, ANNOTATION_WINDOW));
      if (/uuid/i.test(window)) continue;

      found.push({ file, flag });
    }
  }

  // The same flag is declared by more than one subcommand (memory.ts declares
  // --personality-id twice), which would otherwise run identical, identically
  // named cases.
  return found.filter(
    (entry, index) =>
      found.findIndex(other => other.file === entry.file && other.flag === entry.flag) === index
  );
}

describe('id-valued CLI flags', () => {
  const idFlags = collectIdFlags();

  it('finds the id-shaped flags it is meant to guard', () => {
    // A regex that silently matches nothing would make every case below pass.
    expect(idFlags.length).toBeGreaterThanOrEqual(6);
    expect(idFlags).toContainEqual({ file: 'deploy.ts', flag: '--job-id' });
    // Pinned because a neighbouring `<uuid>` option once exempted this one.
    expect(idFlags).toContainEqual({ file: 'cache.ts', flag: '--channel' });
    // Pinned because an id-suffix-only heuristic missed this plural one.
    expect(idFlags).toContainEqual({ file: 'retention.ts', flag: '--exclude' });
    // Pinned because no naming heuristic can see it — it rides the explicit list.
    expect(idFlags).toContainEqual({ file: 'gh.ts', flag: '--sha' });
    expect(new Set(idFlags.map(f => `${f.file} ${f.flag}`)).size).toBe(idFlags.length);
  });

  it.each(idFlags)('$file $flag reads its value from raw argv', ({ file, flag }) => {
    const source = readFileSync(join(COMMANDS_DIR, file), 'utf-8');

    expect(
      source.includes(`rawOptionValue(process.argv, '${flag}')`),
      `${file} declares ${flag}, whose value can exceed 2^53. Read it with ` +
        `rawOptionValue(process.argv, '${flag}') — cac truncates it, and ` +
        `String()-ing the parsed value is too late to recover the digits.`
    ).toBe(true);
  });
});
