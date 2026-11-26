/**
 * Resource-profile resolver: derives every concurrency/heap knob from ONE
 * profile with an auto-on rule.
 *
 * Pure module — no I/O and no `node:os` reads here; callers inject the env
 * object, the CPU count and the total memory. That keeps the resolver
 * importable from the root `vitest.config.ts` (which must not depend on a
 * prior build of this package) and unit-testable without stubbing `os`.
 * The contract — input precedence, the auto rule, the knob table, the
 * exported env names — lives in docs/reference/tooling/resource-profiles.md.
 */
import { UsageError } from '../utils/errors.js';

export type ResourceProfile = 'low' | 'cloud' | 'full';

export interface ProfileKnobs {
  /** `turbo --concurrency`; absent = turbo default (all cores). */
  turboConcurrency?: number;
  /** vitest `maxWorkers` for the merged root config. */
  vitestMaxWorkers: number;
  /** `--max-old-space-size` MB cap; absent = no heap flag is injected. */
  nodeHeapMb?: number;
}

export interface ResolvedProfile {
  profile: ResourceProfile;
  /** Why this profile won: the explicit key, or the measured auto value. */
  trigger: string;
  knobs: ProfileKnobs;
}

export interface ProfileInput {
  /** Process environment (or any merged env view) — the highest layer. */
  env: Record<string, string | undefined>;
  /** Values read key-scoped from .env files by `readEnvFileValues` (exec.ts / resource command). */
  envFileValues?: { RESOURCE_PROFILE?: string; LOW_RESOURCE_MODE?: string };
  cpus: number;
  memTotalBytes: number;
}

/** Knob table — the single source the doc and the tests read. */
export const PROFILE_KNOBS: Record<ResourceProfile, ProfileKnobs> = {
  low: { turboConcurrency: 1, vitestMaxWorkers: 1, nodeHeapMb: 3072 },
  cloud: { turboConcurrency: 2, vitestMaxWorkers: 2 },
  full: { vitestMaxWorkers: 3 },
};

/** Auto rule: at most this many cores resolves `cloud`. */
export const AUTO_CLOUD_MAX_CPUS = 4;
/** Auto rule: at most this many bytes of total memory resolves `low`. */
export const AUTO_LOW_MAX_MEMORY_BYTES = 16 * 1024 ** 3;

const PROFILE_VALUES: readonly ResourceProfile[] = ['low', 'cloud', 'full'];
const MODE_ON_VALUES: readonly string[] = ['1', 'true', 'yes', 'on'];
const MODE_OFF_VALUES: readonly string[] = ['0', 'false', 'no', 'off'];
const CI_OFF_VALUES: readonly string[] = ['false', '0'];

function fail(message: string): never {
  throw new UsageError(message);
}

/** `RESOURCE_PROFILE` override: a valid name wins, `auto`/empty continues, else operator error. */
function parseProfileOverride(value: string | undefined): ResourceProfile | undefined {
  if (value === undefined || value === '') return undefined;
  const normalized = value.toLowerCase();
  if (normalized === 'auto') return undefined;
  const named = PROFILE_VALUES.find(candidate => candidate === normalized);
  if (named !== undefined) return named;
  return fail(
    `RESOURCE_PROFILE must be one of: ${PROFILE_VALUES.join(', ')} (auto or empty auto-detects), got '${value}'`
  );
}

/** `LOW_RESOURCE_MODE`: on values force low, off values force full (explicit auto opt-out). */
function parseModeValue(value: string | undefined): ResourceProfile | undefined {
  if (value === undefined || value === '') return undefined;
  const normalized = value.toLowerCase();
  if (MODE_ON_VALUES.includes(normalized)) return 'low';
  if (MODE_OFF_VALUES.includes(normalized)) return 'full';
  return fail(
    `LOW_RESOURCE_MODE must be on (${MODE_ON_VALUES.join(', ')}) or off (${MODE_OFF_VALUES.join(', ')}); empty auto-detects; got '${value}'`
  );
}

function isCiTruthy(value: string | undefined): boolean {
  return value !== undefined && value !== '' && !CI_OFF_VALUES.includes(value.toLowerCase());
}

function parsePositiveIntKnob(name: string, value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fail(`${name} must be a positive integer, got '${value}'`);
  }
  return parsed;
}

function formatGiB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

function hasHeapCap(nodeOptions: string | undefined): boolean {
  return (
    nodeOptions !== undefined && /(^|\s)--max[-_]old[-_]space[-_]size(=|\s|$)/.test(nodeOptions)
  );
}

function autoResolve(
  cpus: number,
  memTotalBytes: number,
  ci: string | undefined
): { profile: ResourceProfile; trigger: string } {
  if (isCiTruthy(ci)) return { profile: 'full', trigger: 'CI' };
  // Memory first: a few-core machine with little RAM is memory-bound, so it
  // resolves low rather than cloud.
  if (memTotalBytes <= AUTO_LOW_MAX_MEMORY_BYTES) {
    return { profile: 'low', trigger: `auto: ${formatGiB(memTotalBytes)} GiB total memory` };
  }
  if (cpus <= AUTO_CLOUD_MAX_CPUS) return { profile: 'cloud', trigger: `auto: ${cpus} cpus` };
  return {
    profile: 'full',
    trigger: `auto: ${cpus} cpus, ${formatGiB(memTotalBytes)} GiB total memory`,
  };
}

function resolveKnobs(
  profile: ResourceProfile,
  env: Record<string, string | undefined>
): ProfileKnobs {
  const knobs = { ...PROFILE_KNOBS[profile] };
  const turbo = parsePositiveIntKnob('TURBO_CONCURRENCY', env.TURBO_CONCURRENCY);
  const workers = parsePositiveIntKnob('VITEST_MAX_WORKERS', env.VITEST_MAX_WORKERS);
  if (turbo !== undefined) knobs.turboConcurrency = turbo;
  if (workers !== undefined) knobs.vitestMaxWorkers = workers;
  // An existing heap cap in NODE_OPTIONS wins over the table value.
  if (knobs.nodeHeapMb !== undefined && hasHeapCap(env.NODE_OPTIONS)) {
    delete knobs.nodeHeapMb;
  }
  return knobs;
}

/**
 * First matching layer wins: `RESOURCE_PROFILE`, then `LOW_RESOURCE_MODE`
 * (process env ahead of .env for both), then the .env layer's two keys, then
 * the auto rule. Once a layer matches, lower layers are not consulted — and
 * their values are not validated either.
 */
export function resolveResourceProfile(input: ProfileInput): ResolvedProfile {
  const { env, envFileValues } = input;
  const resolved =
    pickLayer(env.RESOURCE_PROFILE, env.LOW_RESOURCE_MODE, envFileValues) ??
    autoResolve(input.cpus, input.memTotalBytes, env.CI);
  return {
    profile: resolved.profile,
    trigger: resolved.trigger,
    knobs: resolveKnobs(resolved.profile, env),
  };
}

/** The four explicit layers in order; undefined hands off to the auto rule. */
function pickLayer(
  envProfileValue: string | undefined,
  envModeValue: string | undefined,
  envFileValues: ProfileInput['envFileValues']
): { profile: ResourceProfile; trigger: string } | undefined {
  const envProfile = parseProfileOverride(envProfileValue);
  if (envProfile !== undefined) {
    return { profile: envProfile, trigger: `RESOURCE_PROFILE=${envProfileValue ?? ''}` };
  }
  const envMode = parseModeValue(envModeValue);
  if (envMode !== undefined) {
    return { profile: envMode, trigger: `LOW_RESOURCE_MODE=${envModeValue ?? ''}` };
  }
  if (envFileValues === undefined) return undefined;
  const fileProfile = parseProfileOverride(envFileValues.RESOURCE_PROFILE);
  if (fileProfile !== undefined) {
    return {
      profile: fileProfile,
      trigger: `.env: RESOURCE_PROFILE=${envFileValues.RESOURCE_PROFILE ?? ''}`,
    };
  }
  const fileMode = parseModeValue(envFileValues.LOW_RESOURCE_MODE);
  if (fileMode !== undefined) {
    return {
      profile: fileMode,
      trigger: `.env: LOW_RESOURCE_MODE=${envFileValues.LOW_RESOURCE_MODE ?? ''}`,
    };
  }
  return undefined;
}

/**
 * The env additions to export on top of the inherited environment.
 * `RESOURCE_PROFILE` is re-exported resolved so child processes (a vitest
 * config under turbo, a nested wrapper) resolve identically without re-reading
 * .env; the knob vars are the explicit per-knob names, which win over the
 * table wherever they are read.
 */
export function buildProfileEnv(
  resolved: ResolvedProfile,
  env: Record<string, string | undefined>
): Record<string, string> {
  const additions: Record<string, string> = {
    RESOURCE_PROFILE: resolved.profile,
    VITEST_MAX_WORKERS: String(resolved.knobs.vitestMaxWorkers),
  };
  if (resolved.knobs.turboConcurrency !== undefined) {
    additions.TURBO_CONCURRENCY = String(resolved.knobs.turboConcurrency);
  }
  if (resolved.knobs.nodeHeapMb !== undefined) {
    const existing = env.NODE_OPTIONS;
    additions.NODE_OPTIONS =
      existing === undefined
        ? `--max-old-space-size=${resolved.knobs.nodeHeapMb}`
        : `${existing} --max-old-space-size=${resolved.knobs.nodeHeapMb}`;
  }
  return additions;
}

/** One human line: `resource profile: low (auto: 14.5 GiB total memory) - turbo 1, vitest 1, heap 3072 MB`. */
export function formatProfileLine(resolved: ResolvedProfile): string {
  const turbo =
    resolved.knobs.turboConcurrency !== undefined
      ? `turbo ${resolved.knobs.turboConcurrency}`
      : 'turbo default';
  const heap =
    resolved.knobs.nodeHeapMb !== undefined ? `, heap ${resolved.knobs.nodeHeapMb} MB` : '';
  return `resource profile: ${resolved.profile} (${resolved.trigger}) - ${turbo}, vitest ${resolved.knobs.vitestMaxWorkers}${heap}`;
}
