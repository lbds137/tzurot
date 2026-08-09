/**
 * Pre-bump gate: CURRENT.md must already have been reset for the PREVIOUS release.
 *
 * Every release starts with `pnpm bump-version`, which makes the bump the one
 * deterministic moment where the previous release's close-out can still be
 * checked. "CURRENT.md's version header ≠ package.json's current version" is
 * exactly the signature of a skipped reset step: the file still declares the
 * release before last and carries two releases of content, which surfaces later
 * as a context-budget breach rather than as the missed release step it is.
 *
 * Only the "did it happen" half is mechanical. Deciding WHAT outlives a release
 * is human judgment, and this gate does not touch the file — it refuses, names
 * the step, and gets out of the way.
 *
 * Fail-CLOSED by construction: an unreadable file or an unparseable header
 * refuses. A gate that passes on data it could not read is not a gate, and the
 * bypass flag exists for the legitimate exceptional flow.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Escape hatch for a legitimate exceptional flow; named in every refusal. */
export const ALLOW_STALE_CURRENT_FLAG = '--allow-stale-current';

/** The release step whose omission this gate detects. Named in the refusal. */
const RESET_STEP = 'release step 9 (CURRENT.md reset)';

/**
 * CURRENT.md's version header, e.g.
 * `> **Version**: v3.0.0-beta.196 — summary…`
 *
 * The version is captured up to the first space, so the trailing summary (which
 * is free prose and changes every release) is not part of the comparison.
 */
const CURRENT_MD_HEADER = /^>\s*\*\*Version\*\*:\s*v([^\s]+)/m;

export type CurrentMdVerdict = { ok: true } | { ok: false; reason: string };

/** The version CURRENT.md declares, or undefined when no header parses. */
export function parseCurrentMdVersion(text: string): string | undefined {
  return CURRENT_MD_HEADER.exec(text)?.[1];
}

export interface CurrentMdGateDeps {
  /** Injectable file read; defaults to a UTF-8 `readFileSync`. */
  readonly readFile?: (path: string) => string;
}

/** Read a file, or undefined when it cannot be read at all. */
function tryRead(readFile: (path: string) => string, path: string): string | undefined {
  try {
    return readFile(path);
  } catch {
    return undefined;
  }
}

/** The root package.json's `version`, or undefined when it cannot be established. */
function readPackageVersion(
  readFile: (path: string) => string,
  rootDir: string
): string | undefined {
  const raw = tryRead(readFile, join(rootDir, 'package.json'));
  if (raw === undefined) return undefined;
  try {
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compare CURRENT.md's declared version against package.json's CURRENT version
 * (i.e. before the bump this call precedes).
 */
export function checkCurrentMdReset(
  rootDir: string,
  deps: CurrentMdGateDeps = {}
): CurrentMdVerdict {
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, 'utf-8'));

  const currentMd = tryRead(readFile, join(rootDir, 'CURRENT.md'));
  if (currentMd === undefined) {
    return { ok: false, reason: `CURRENT.md could not be read from ${rootDir}` };
  }
  const declared = parseCurrentMdVersion(currentMd);
  if (declared === undefined) {
    return {
      ok: false,
      reason:
        'CURRENT.md has no parseable `> **Version**: vX.Y.Z` header, so whether ' +
        `${RESET_STEP} happened cannot be established`,
    };
  }

  const version = readPackageVersion(readFile, rootDir);
  if (typeof version !== 'string') {
    return { ok: false, reason: `no string version field in ${join(rootDir, 'package.json')}` };
  }

  if (declared !== version) {
    return {
      ok: false,
      reason:
        `CURRENT.md still says v${declared} but package.json is at v${version} — ` +
        `${RESET_STEP} was skipped for the previous release. Reset CURRENT.md first ` +
        `(deciding what outlives the release is yours to make), or pass ` +
        `${ALLOW_STALE_CURRENT_FLAG} if this bump is a deliberate exception.`,
    };
  }
  return { ok: true };
}
