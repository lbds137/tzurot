/**
 * Load, select, and validate character cards from `--dir` for
 * `pnpm ops characters:import` — entirely offline (no gateway calls). Split
 * out of `import.ts` (which orchestrates the gateway-facing half) to keep
 * that file under the repo's `max-lines` limit.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import { SLUG_PATTERN, SLUG_MIN_LENGTH } from '@tzurot/common-types/schemas/api/personality';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import {
  buildImportPayload,
  getImportPayloadIssues,
} from '@tzurot/common-types/utils/characterImportPayload';
import { type Environment } from '../utils/env-runner.js';
import { type CardInput } from './classify.js';

export interface CharactersImportOptions {
  env: Environment;
  dir: string;
  apply?: boolean;
  renameMap?: string;
  avatars?: string;
  createNew?: string;
  allowForeign?: string;
  only?: string;
  asUser?: string;
  force?: boolean;
}

/** Every `.json` file under `dir`, as paths relative to `dir`, sorted. When
 *  `--rename-map` points at a file inside `dir`, the scan is recursive and
 *  would otherwise read that map as a malformed card — excluded by resolved
 *  path so it's never treated as one. */
function collectJsonFiles(dir: string, renameMapPath: string | undefined): string[] {
  const excluded = renameMapPath !== undefined ? resolve(renameMapPath) : undefined;
  const entries = readdirSync(dir, { recursive: true }) as string[];
  return entries
    .filter(entry => entry.endsWith('.json'))
    .filter(entry => statSync(join(dir, entry)).isFile())
    .filter(entry => resolve(join(dir, entry)) !== excluded)
    .sort();
}

/** Split a comma list into a trimmed, non-empty-entry set. */
export function parseListFlag(value: string | undefined): Set<string> {
  if (value === undefined) {
    return new Set();
  }
  return new Set(
    value
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
  );
}

/** `SLUG_PATTERN` alone doesn't bound length — the update route's slug
 *  schema also enforces `SLUG_MIN_LENGTH`..`DISCORD_LIMITS.SLUG_MAX_LENGTH`. */
export function isValidSlugLength(slug: string): boolean {
  return slug.length >= SLUG_MIN_LENGTH && slug.length <= DISCORD_LIMITS.SLUG_MAX_LENGTH;
}

/** Load `--rename-map`: a JSON object of old-slug -> new-slug. Rejects two
 *  keys mapping to the same value — the target row can only be written by
 *  one of them, so the map is ambiguous. */
function loadRenameMap(path: string | undefined): Map<string, string> {
  if (path === undefined) {
    return new Map();
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    throw new Error(`--rename-map: cannot read ${path}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`--rename-map: ${path} is not valid JSON`);
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(`--rename-map: ${path} must be a JSON object of old slug -> new slug`);
  }
  const map = new Map<string, string>();
  const sourceForTarget = new Map<string, string>();
  for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
    if (
      !SLUG_PATTERN.test(key) ||
      typeof value !== 'string' ||
      !SLUG_PATTERN.test(value) ||
      !isValidSlugLength(key) ||
      !isValidSlugLength(value)
    ) {
      throw new Error(
        `--rename-map: every key and value must be a valid slug (offending key: ${key})`
      );
    }
    if (sourceForTarget.has(value)) {
      throw new Error(`--rename-map: two entries map to ${value}`);
    }
    sourceForTarget.set(value, key);
    map.set(key, value);
  }
  return map;
}

interface ParsedCardFile {
  file: string;
  data: Record<string, unknown>;
}

/** A file that could not be turned into a parsed card, before slug-based
 *  `--only` selection is possible. */
interface ParseFailure {
  file: string;
  reason: 'unreadable' | 'invalid JSON';
}

function formatParseFailure(f: ParseFailure): string {
  return f.reason === 'unreadable' ? `${f.file}: cannot read file` : `${f.file}: invalid JSON`;
}

/** Read + JSON.parse every candidate file, collecting parse failures
 *  separately from validation failures — a file that fails here has no
 *  slug, so `--only` cannot tell whether it was selected. */
function readCardFiles(
  dir: string,
  files: string[]
): { parsed: ParsedCardFile[]; failures: ParseFailure[] } {
  const parsed: ParsedCardFile[] = [];
  const failures: ParseFailure[] = [];
  for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(join(dir, file), 'utf-8');
    } catch {
      failures.push({ file, reason: 'unreadable' });
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      failures.push({ file, reason: 'invalid JSON' });
      continue;
    }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      failures.push({ file, reason: 'invalid JSON' });
      continue;
    }
    parsed.push({ file, data: json as Record<string, unknown> });
  }
  return { parsed, failures };
}

/** Apply `--only`, warning (not failing) for a name that matched nothing, or
 *  for a parsed card whose slug isn't a string (it can't be matched against
 *  `--only`, but without `--only` it still fails validation normally). */
function applyOnlyFilter(cards: ParsedCardFile[], only: Set<string>): ParsedCardFile[] {
  if (only.size === 0) {
    return cards;
  }
  for (const card of cards) {
    if (typeof card.data.slug !== 'string') {
      console.warn(chalk.yellow(`skipped (no string slug, cannot match --only): ${card.file}`));
    }
  }
  const selected = cards.filter(c => typeof c.data.slug === 'string' && only.has(c.data.slug));
  const found = new Set(selected.map(c => c.data.slug as string));
  for (const slug of only) {
    if (!found.has(slug)) {
      console.warn(chalk.yellow(`--only ${slug} matched no card`));
    }
  }
  return selected;
}

/** Validate every selected card and build its import payload. Failures here
 *  mean zero gateway calls are made — validation runs entirely offline. */
function validateAndBuildCards(parsedCards: ParsedCardFile[], failures: string[]): CardInput[] {
  const seenSlugs = new Map<string, string>();
  const cards: CardInput[] = [];
  for (const { file, data } of parsedCards) {
    if (typeof data.slug !== 'string' || data.slug.length === 0) {
      failures.push(`${file}: slug: must be a string`);
      continue;
    }
    const slug = data.slug;
    const payload = buildImportPayload(data, slug, undefined, undefined);
    const issues = getImportPayloadIssues(payload);
    if (issues.length > 0) {
      for (const issue of issues) {
        failures.push(`${file}: ${issue.field}: ${issue.message}`);
      }
      continue;
    }
    const firstFile = seenSlugs.get(slug);
    if (firstFile !== undefined) {
      failures.push(`${file}: duplicate slug '${slug}' (also in ${firstFile})`);
      continue;
    }
    seenSlugs.set(slug, file);
    cards.push({ slug, file, payload });
  }
  return cards;
}

export interface LoadResult {
  cards: CardInput[];
  renameMap: Map<string, string>;
}

/** Load, select, and validate every card. Prints its own failures — a null
 *  return means the caller aborts with zero gateway calls. */
export function loadAndValidateCards(opts: CharactersImportOptions): LoadResult | null {
  let files: string[];
  try {
    files = collectJsonFiles(opts.dir, opts.renameMap);
  } catch {
    console.error(chalk.red(`--dir: cannot read ${opts.dir}`));
    return null;
  }

  const only = parseListFlag(opts.only);
  const { parsed: parsedCards, failures: parseFailures } = readCardFiles(opts.dir, files);
  const selected = applyOnlyFilter(parsedCards, only);

  let renameMap: Map<string, string>;
  try {
    renameMap = loadRenameMap(opts.renameMap);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    return null;
  }

  const validationFailures: string[] = [];
  const cards = validateAndBuildCards(selected, validationFailures);

  // With --only, a file that couldn't even be parsed has no slug to match
  // against — it can't be told apart from a file the operator didn't select,
  // so it's a warning rather than a run-blocking failure. Without --only,
  // every file in --dir is implicitly selected, so the old fail-the-run
  // behavior is unchanged.
  let failures: string[];
  if (only.size > 0) {
    for (const f of parseFailures) {
      console.warn(
        chalk.yellow(`skipped (unreadable/invalid JSON, cannot match --only): ${f.file}`)
      );
    }
    failures = validationFailures;
  } else {
    failures = [...parseFailures.map(formatParseFailure), ...validationFailures];
  }

  if (failures.length > 0) {
    console.error(chalk.red(`${String(failures.length)} card(s) failed validation:`));
    for (const line of failures) {
      console.error(`  ${line}`);
    }
    return null;
  }
  return { cards, renameMap };
}
