/**
 * Deferred-Backlog Tripwire
 *
 * A large share of `backlog/deferred.md` entries are gated on "opportunistic
 * when next touching <file>" — a trigger that only fires if whoever is editing
 * the file REMEMBERS the entry exists. In practice that means it never fires:
 * entries with concrete, cheap fix shapes sit for months while the referenced
 * files get edited around them.
 *
 * This tool makes those triggers structural: given a set of files (typically
 * the staged set at commit time), it greps deferred.md for entries whose text
 * references any of them and prints the matches INFORMATIONALLY. It never
 * fails — this is a reminder surface, not a gate, so a developer who decides
 * "not this PR" loses nothing. Wired into .husky/pre-commit.
 *
 * Entries with no file path in their text (the genuinely event-gated ones)
 * are invisible to this tool by design.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

const DEFERRED_PATH = 'backlog/deferred.md';

/** Max characters of the entry title shown per match */
const TITLE_PREVIEW_LENGTH = 90;

/** @internal Exported for testing */
export interface DeferredRef {
  /** Normalized path token from the entry text, e.g. 'services/x/src/y.ts' or 'services/x/' */
  pathToken: string;
  /** True when the token is a directory/glob prefix rather than an exact file */
  isPrefix: boolean;
  /** First-cell entry title (truncated) */
  title: string;
  /** 1-based line number of the entry row in deferred.md */
  line: number;
}

/** @internal Exported for testing */
export interface DeferredMatch {
  file: string;
  refs: DeferredRef[];
}

/**
 * Path-like tokens inside entry prose: `services/...`, `packages/...`, or
 * `prisma/...` (schema + migration entries reference it), optionally wrapped
 * in backticks, possibly carrying `:123`-style line refs or globs. Captured
 * liberally, then normalized.
 */
const PATH_TOKEN_PATTERN = /(?:services|packages|prisma)\/[\w.\-/*]+/g;

/**
 * Normalize a raw path token from prose into a matchable form.
 * Returns null for tokens too short to be meaningful (bare 'services/x').
 */
/** @internal Exported for testing */
export function normalizePathToken(raw: string): { pathToken: string; isPrefix: boolean } | null {
  // Strip trailing punctuation that prose attaches (periods, commas, colons
  // with line numbers like `file.ts:231-234` keep only the path part).
  // Char-by-char trim instead of a `+$` quantifier — appeases the
  // regexp/no-super-linear-move ReDoS rule on prose-derived input.
  let token = raw.replace(/:[\d~,-]*$/, '');
  while (token.length > 0 && '.,;)'.includes(token[token.length - 1])) {
    token = token.slice(0, -1);
  }

  let isPrefix = false;
  const starIndex = token.indexOf('*');
  if (starIndex !== -1) {
    // Glob like services/voice-engine/*.py → prefix match on the static part
    token = token.slice(0, starIndex);
    isPrefix = true;
  }
  if (token.endsWith('/')) {
    isPrefix = true;
  }

  const segments = token.split('/').filter(s => s.length > 0);
  if (segments.length < 2) {
    return null;
  }

  // Extension-bearing tokens are exact files — 2 segments is enough
  // (`prisma/schema.prisma` is a real path at that depth).
  const last = segments[segments.length - 1];
  if (!isPrefix && last.includes('.')) {
    return { pathToken: token, isPrefix: false };
  }

  // Everything else is directory-ish. Globs and trailing slashes already
  // declared themselves prefixes; bare extension-less prose tokens need
  // group/package/sub depth so a passing mention of 'services/ai-worker'
  // doesn't become a match-everything prefix.
  if (!isPrefix) {
    if (segments.length < 3) {
      return null;
    }
    isPrefix = true;
    token = `${token}/`;
  }

  return { pathToken: token, isPrefix };
}

/**
 * Parse deferred.md table rows into path-keyed references.
 */
/** @internal Exported for testing */
export function extractDeferredRefs(markdown: string): DeferredRef[] {
  const refs: DeferredRef[] = [];
  const lines = markdown.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Table rows only; skip the header and the separator row. The separator
    // test requires the full `| --- |` cell shape so a future entry whose
    // title happens to start with a dash isn't misclassified.
    if (!line.startsWith('|') || /^\|\s*[-:]+\s*\|/.test(line) || /^\|\s*Item\s*\|/i.test(line)) {
      continue;
    }

    const title = line.split('|')[1]?.replace(/`/g, '').trim().slice(0, TITLE_PREVIEW_LENGTH);
    if (title === undefined || title.length === 0) {
      continue;
    }

    const seen = new Set<string>();
    for (const raw of line.match(PATH_TOKEN_PATTERN) ?? []) {
      const normalized = normalizePathToken(raw);
      if (normalized === null || seen.has(normalized.pathToken)) {
        continue;
      }
      seen.add(normalized.pathToken);
      refs.push({ ...normalized, title, line: i + 1 });
    }
  }

  return refs;
}

/**
 * Match a set of files against the parsed references.
 */
/** @internal Exported for testing */
export function matchFiles(files: string[], refs: DeferredRef[]): DeferredMatch[] {
  const matches: DeferredMatch[] = [];

  for (const file of files) {
    const hits = refs.filter(ref =>
      ref.isPrefix ? file.startsWith(ref.pathToken) : file === ref.pathToken
    );
    if (hits.length > 0) {
      matches.push({ file, refs: hits });
    }
  }

  return matches;
}

/** Resolve the staged file list from git */
function getStagedFiles(): string[] {
  const output = execFileSync('git', ['diff', '--cached', '--name-only'], {
    encoding: 'utf-8',
  });
  return output.split('\n').filter(line => line.length > 0);
}

interface CheckOptions {
  /** Read the file list from git's staged set */
  staged?: boolean;
  /** Explicit file list (used when staged is false) */
  files?: string[];
}

/**
 * CLI entry point. ALWAYS exits 0 — informational, never a gate. The
 * catch-all makes that contract hold even when git or the filesystem
 * misbehaves: errors are logged to stderr and swallowed, because a broken
 * reminder tool must never break a commit or a script that calls it.
 */
export async function checkDeferredRefs(options: CheckOptions = {}): Promise<void> {
  try {
    const rootDir = process.cwd();
    const deferredFile = join(rootDir, DEFERRED_PATH);
    if (!existsSync(deferredFile)) {
      return;
    }

    const files = options.staged === true ? getStagedFiles() : (options.files ?? []);
    if (files.length === 0) {
      return;
    }

    const refs = extractDeferredRefs(readFileSync(deferredFile, 'utf-8'));
    const matches = matchFiles(files, refs);
    if (matches.length === 0) {
      return;
    }

    console.log('');
    console.log(chalk.yellow.bold('📌 Deferred backlog entries reference files in this change:'));
    for (const match of matches) {
      console.log(chalk.white(`   ${match.file}`));
      for (const ref of match.refs) {
        console.log(chalk.dim(`     • ${ref.title} (${DEFERRED_PATH}:${ref.line})`));
      }
    }
    console.log(chalk.dim('   Reminder only — fold one in if it fits, or carry on. Never blocks.'));
    console.log('');
  } catch (error) {
    console.error(
      chalk.dim(
        `deferred-refs check skipped (${error instanceof Error ? error.message : String(error)})`
      )
    );
  }
}
