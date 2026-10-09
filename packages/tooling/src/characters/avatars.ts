/**
 * Avatar carrying for `pnpm ops characters:import --avatars <manifest>`.
 *
 * The manifest is a flat JSON object of slug -> image path (relative to the
 * manifest's own directory). A card whose slug is in the manifest has its
 * image sent as a bare-base64 `avatarData` — but only when the sha256 of the
 * SOURCE file differs from the hash recorded for that slug the last time this
 * importer applied it. The gateway re-encodes the image, so stored bytes can
 * never be compared to the source file; a locally recorded source hash is the
 * only comparable signal. A slug absent from the manifest is never touched,
 * and the importer never sends `clearAvatar` or a null `avatarData` (pinned by
 * the "never a data URI" test in `import.test.ts`, which asserts no
 * `clearAvatar` property).
 *
 * The gate sees only this importer's own applies: an avatar changed or cleared
 * elsewhere (the dashboard, the API) is not detected and will not be restored.
 * A row that classifies as `new` (deleted and recreated) is the one exception:
 * its image is re-sent even when the hash matches, because a fresh row has no
 * avatar. Deleting a slug's entry in the state file forces a re-send.
 *
 * Every selected manifest image's base64 payload is held resident through
 * classify and write — accepted at the current roster scale, because classify
 * needs the string `avatarData` to count the change.
 *
 * Output prints slugs, relative manifest paths, counts, and the avatar-state
 * path (an operator path, not card data) — never image bytes or card field
 * values.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import chalk from 'chalk';
import { SLUG_PATTERN } from '@tzurot/common-types/schemas/api/personality';
import { type Environment } from '../utils/env-runner.js';
import { type CardInput, type Verdict } from './classify.js';
import { isValidSlugLength } from './load-cards.js';

/** Where applied-source hashes live; relative to the working directory (the
 *  ops CLI runs from the repo root, where `docs/local/` is gitignored). */
export const DEFAULT_AVATAR_STATE_PATH = 'docs/local/avatar-import-state.json';

/** env -> slug -> sha256 hex of the last source file the importer applied. */
export type AvatarState = Record<string, Record<string, string>>;

/** Longest base64 string `planOne` will carry: the gateway's JSON body limit is
 *  20mb (`express.json` in api-gateway `index.ts` — not pinned by a test here),
 *  and this leaves ~2 MB for the card's other fields. */
const MAX_AVATAR_BASE64_CHARS = 14_000_000;

export type AvatarPlan =
  | { kind: 'apply'; hash: string; base64: string }
  | { kind: 'unchanged'; hash: string }
  | { kind: 'refused'; reason: string };

/** Load `--avatars`: a JSON object of slug -> non-empty relative image path.
 *  Mirrors `loadRenameMap`'s validation: any violation throws. */
export function loadAvatarManifest(path: string): Map<string, string> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    throw new Error(`--avatars: cannot read ${path}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`--avatars: ${path} is not valid JSON`);
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(`--avatars: ${path} must be a JSON object of slug -> image path`);
  }
  const manifest = new Map<string, string>();
  for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
    if (!SLUG_PATTERN.test(key) || !isValidSlugLength(key)) {
      throw new Error(`--avatars: every key must be a valid slug (offending key: ${key})`);
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`--avatars: every value must be a non-empty path string (key: ${key})`);
    }
    manifest.set(key, value);
  }
  return manifest;
}

/** Null-prototype map, so a hand-edited `__proto__` key becomes an own
 *  property instead of replacing the object's prototype. */
function emptyMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** Read the applied-hash state. A missing file reads as empty; a file that is
 *  unparsable or the wrong shape also reads as empty but warns, because the
 *  worst outcome is that avatars are re-applied once. */
export function readAvatarState(statePath: string): AvatarState {
  let raw: string;
  try {
    raw = readFileSync(statePath, 'utf-8');
  } catch {
    return emptyMap();
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = undefined;
  }
  const state: AvatarState = emptyMap();
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    console.warn(
      chalk.yellow(
        `Avatar state ${statePath} is unreadable; treating it as empty (avatars re-send).`
      )
    );
    return state;
  }
  for (const [env, entries] of Object.entries(json as Record<string, unknown>)) {
    if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
      continue;
    }
    state[env] = emptyMap();
    for (const [slug, hash] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof hash === 'string') {
        state[env][slug] = hash;
      }
    }
  }
  return state;
}

function writeAvatarState(statePath: string, state: AvatarState): void {
  mkdirSync(dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  renameSync(tmpPath, statePath);
}

/** Decide one slug's avatar: refuse an unreadable/out-of-tree/oversized image,
 *  skip when the recorded hash matches, otherwise apply.
 *
 *  Containment is lexical: the resolved path is compared with the manifest
 *  directory by string, so a symlink inside the tree that points outside it
 *  would be followed and NOT checked (symlink following is not verified by a
 *  test). The manifest is owner-authored on the operator's own machine, and a
 *  realpath check would refuse a deliberately symlinked image. */
function planOne(
  manifestDir: string,
  relPath: string,
  recordedHash: string | undefined
): AvatarPlan {
  const absolute = resolve(manifestDir, relPath);
  const fromDir = relative(manifestDir, absolute);
  if (fromDir === '..' || fromDir.startsWith(`..${sep}`) || isAbsolute(fromDir)) {
    return {
      kind: 'refused',
      reason: `avatar image path leaves the manifest directory: ${relPath}`,
    };
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(absolute);
  } catch {
    return { kind: 'refused', reason: `avatar image not found: ${relPath}` };
  }
  if (bytes.length === 0) {
    return { kind: 'refused', reason: `avatar image is empty: ${relPath}` };
  }
  // Base64 expands 3 bytes to 4 chars, so this estimates the encoded length
  // (within padding) without paying for the encode on an image that is about
  // to be refused. It runs before the hash comparison so no path, a re-send
  // for a recreated row included, can carry an oversized body.
  if (Math.ceil((bytes.length * 4) / 3) > MAX_AVATAR_BASE64_CHARS) {
    const megabytes = (bytes.length / (1024 * 1024)).toFixed(1);
    return {
      kind: 'refused',
      reason: `avatar image too large (${megabytes} MB): the gateway JSON body limit is 20mb`,
    };
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash === recordedHash) {
    return { kind: 'unchanged', hash };
  }
  return { kind: 'apply', hash, base64: bytes.toString('base64') };
}

/** One run's avatar handling: plans per selected manifest slug, plus the
 *  hooks `import.ts` calls at each phase. */
export interface AvatarRun {
  /** Cards with `avatarData` injected where the hash gate says apply. */
  cards: CardInput[];
  /** Replace the verdict of every avatar-refused card with a refusal. */
  applyRefusals(verdicts: Verdict[]): Verdict[];
  /** Re-send the image for every card the final verdicts classify as `new`
   *  whose hash gate said unchanged: a recreated row has no avatar. Returns
   *  the cards to write (index-aligned with the input); call before
   *  `printSummary` and `writeCards`. */
  resendForNewRows(verdicts: Verdict[]): CardInput[];
  /** Print the outcome counts and the resolved state path; takes the final
   *  verdicts (post-`applyRefusals`), index-aligned with the input cards. */
  printSummary(verdicts: Verdict[]): void;
  /** Call for every card whose gateway write succeeded. */
  onWritten(card: CardInput): void;
  /** Persist hashes of the avatars written so far; a failure only warns.
   *  State is written from the snapshot read at run start, so concurrent
   *  importer runs can lose each other's entries; single-operator tooling,
   *  accepted. */
  persist(): void;
}

/** Load the manifest and plan every selected card. Prints its own failure — a
 *  null return means the caller aborts with zero gateway calls. */
export function prepareAvatarRun(
  manifestPath: string,
  env: Environment,
  cards: CardInput[],
  statePath: string
): AvatarRun | null {
  let manifest: Map<string, string>;
  try {
    manifest = loadAvatarManifest(manifestPath);
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    return null;
  }
  const manifestDir = dirname(resolve(manifestPath));
  const state = readAvatarState(statePath);
  const recorded = state[env] ?? emptyMap<string>();

  const plans = new Map<string, AvatarPlan>();
  for (const card of cards) {
    const relPath = manifest.get(card.slug);
    if (relPath !== undefined) {
      plans.set(card.slug, planOne(manifestDir, relPath, recorded[card.slug]));
    }
  }
  const applied = new Map<string, string>();
  /** Slugs whose unchanged image was re-sent because their row is new. */
  const resent = new Set<string>();

  const withAvatars = cards.map(card => {
    const plan = plans.get(card.slug);
    return plan?.kind === 'apply'
      ? { ...card, payload: { ...card.payload, avatarData: plan.base64 } }
      : card;
  });

  return {
    cards: withAvatars,
    resendForNewRows: verdicts =>
      withAvatars.map((card, i) => {
        const plan = plans.get(card.slug);
        const relPath = manifest.get(card.slug);
        if (plan?.kind !== 'unchanged' || verdicts[i]?.kind !== 'new' || relPath === undefined) {
          return card;
        }
        let bytes: Buffer;
        try {
          // planOne already vetted this path and size when it hashed the file.
          bytes = readFileSync(resolve(manifestDir, relPath));
        } catch {
          return card;
        }
        resent.add(card.slug);
        return { ...card, payload: { ...card.payload, avatarData: bytes.toString('base64') } };
      }),
    applyRefusals: verdicts =>
      verdicts.map((verdict, i) => {
        const plan = plans.get(cards[i].slug);
        return plan?.kind === 'refused' ? { kind: 'refused', reason: plan.reason } : verdict;
      }),
    printSummary: verdicts => {
      const count = (kind: AvatarPlan['kind']): number =>
        [...plans.values()].filter(p => p.kind === kind).length;
      const willWrite = cards.filter((card, i) => {
        const verdictKind = verdicts[i]?.kind;
        return (
          plans.get(card.slug)?.kind === 'apply' &&
          (verdictKind === 'new' || verdictKind === 'changed')
        );
      }).length;
      // A re-sent card's image goes out with its create, so it counts as
      // "apply", not "unchanged".
      const resentCount = resent.size;
      console.log(
        chalk.dim(
          `Avatars: ${String(plans.size)} manifest entries among selected cards ` +
            `(${String(willWrite + resentCount)} apply, ` +
            `${String(count('unchanged') - resentCount)} unchanged, ` +
            `${String(count('refused'))} refused)`
        )
      );
      console.log(chalk.dim(`Avatar state: ${resolve(statePath)}`));
    },
    onWritten: card => {
      const plan = plans.get(card.slug);
      if (plan?.kind === 'apply' || (plan?.kind === 'unchanged' && resent.has(card.slug))) {
        applied.set(card.slug, plan.hash);
      }
    },
    persist: () => {
      if (applied.size === 0) {
        return;
      }
      state[env] = Object.assign(emptyMap<string>(), recorded, Object.fromEntries(applied));
      try {
        writeAvatarState(statePath, state);
      } catch {
        console.error(
          chalk.red(
            `Could not write ${statePath}; the next run will re-apply these ${String(applied.size)} avatars once.`
          )
        );
      }
    },
  };
}
