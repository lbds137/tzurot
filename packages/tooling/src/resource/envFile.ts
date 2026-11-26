/**
 * Key-scoped .env reader for the resource profile.
 *
 * Reads ONLY `RESOURCE_PROFILE` and `LOW_RESOURCE_MODE` from `<cwd>/.env` —
 * never the whole file into process.env. That is the deliberate opposite of
 * `cli.ts`'s loadEnv.ts: the wrapper fronts `pnpm lint` / `pnpm test`, and
 * wholesale loading would leak every operator secret into lint/test processes.
 *
 * Per key, when the working directory's .env does not carry the key, it falls
 * back to the main checkout's .env (the parent of the common git dir) — a
 * linked worktree's .env is gitignored and often absent or missing these keys.
 * Value parsing mirrors .husky/pre-push's shell reader so the shell layer and
 * this one agree: last matching line wins, every CR stripped, an inline ` #` comment
 * and surrounding whitespace trimmed, one layer of matching quotes removed,
 * and an empty value reads as unset (which enables the per-key fallback).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface EnvFileValues {
  RESOURCE_PROFILE?: string;
  LOW_RESOURCE_MODE?: string;
}

const PROFILE_KEYS: readonly (keyof EnvFileValues)[] = ['RESOURCE_PROFILE', 'LOW_RESOURCE_MODE'];

export function readEnvFileValues(cwd: string): EnvFileValues {
  const values: EnvFileValues = {};
  const localPath = join(cwd, '.env');
  // The main-checkout lookup spawns git, so it runs only once a key is still
  // missing after the local read (pinned by envFile.test.ts's no-spawn case).
  // A checkout with no .env (CI, a fresh clone) is always missing, so the spawn
  // happens on every load there; it is not a rare path.
  let fallbackPath: string | undefined = undefined;
  let fallbackResolved = false;
  for (const key of PROFILE_KEYS) {
    let value = readEnvFileKey(localPath, key);
    if (value === undefined) {
      if (!fallbackResolved) {
        fallbackPath = mainCheckoutEnvPath(cwd);
        fallbackResolved = true;
      }
      value = fallbackPath === undefined ? undefined : readEnvFileKey(fallbackPath, key);
    }
    if (value !== undefined) {
      values[key] = value;
    }
  }
  return values;
}

/** One key's last value in `path`, or undefined when the file, the key or the value is absent/empty. */
function readEnvFileKey(path: string, key: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const keyPattern = new RegExp(`^${key}=(.*)$`);
  let found: string | undefined = undefined;
  for (const rawLine of readFileSync(path, 'utf-8').split('\n')) {
    // Every CR, not just a trailing one: the shell reader runs `tr -d '\r'`.
    const line = rawLine.replaceAll('\r', '');
    const match = keyPattern.exec(line);
    if (match !== null) {
      found = match[1];
    }
  }
  if (found === undefined) return undefined;
  const trimmed = found.replace(/\s#.*$/, '').trim();
  const unquoted = unquoteValue(trimmed);
  return unquoted === '' ? undefined : unquoted;
}

/** Strip one layer of fully-wrapping matching quotes, mirroring the shell reader's sed pair. */
function unquoteValue(value: string): string {
  const first = value.charAt(0);
  const last = value.charAt(value.length - 1);
  if (value.length >= 2 && ((first === '"' && last === '"') || (first === "'" && last === "'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/** The main checkout's .env path (parent of the common git dir), or undefined outside a repo. */
function mainCheckoutEnvPath(cwd: string): string | undefined {
  let gitCommonDir: string;
  try {
    gitCommonDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    ).trim();
  } catch {
    return undefined;
  }
  // Only an absolute path enables the fallback: an older git echoes the
  // unknown flag back, which is a relative string (same guard as the shell).
  if (gitCommonDir.startsWith('/') !== true) return undefined;
  const envPath = join(dirname(gitCommonDir), '.env');
  return existsSync(envPath) ? envPath : undefined;
}
