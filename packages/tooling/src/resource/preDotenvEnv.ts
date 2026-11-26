/**
 * Pre-dotenv snapshot of the env keys the profile resolver reads from env
 * (the two profile keys plus the three knob overrides).
 *
 * `loadEnv.ts` merges the checkout `.env` into process.env, after which a
 * `.env` value is indistinguishable from a shell-exported one. The documented
 * precedence (resource-profiles.md § Input precedence) ranks the process env
 * above `.env`, so the ops runners resolve against `profileEnvView`, which
 * swaps these keys back to what the process env held before dotenv. The knob
 * overrides are included so a `.env` TURBO_CONCURRENCY / VITEST_MAX_WORKERS /
 * NODE_OPTIONS cannot silently beat the profile the shell chose.
 *
 * Side-effect free on purpose: resource/exec.ts must not import loadEnv.ts
 * (that would load the whole `.env` into every wrapped child), and it does not
 * need this module's recorder either; only `loadEnv.ts` records.
 */

// Exactly the env keys profile.ts reads: resolveResourceProfile/pickLayer
// (RESOURCE_PROFILE, LOW_RESOURCE_MODE) and resolveKnobs (TURBO_CONCURRENCY,
// VITEST_MAX_WORKERS, NODE_OPTIONS). It also reads CI for the auto rule; CI is
// left out because the ops runners are not given a dotenv-set CI to undo.
const PROFILE_ENV_KEYS = [
  'RESOURCE_PROFILE',
  'LOW_RESOURCE_MODE',
  'TURBO_CONCURRENCY',
  'VITEST_MAX_WORKERS',
  'NODE_OPTIONS',
] as const;

type ProfileEnvSnapshot = Partial<Record<(typeof PROFILE_ENV_KEYS)[number], string>>;

let snapshot: ProfileEnvSnapshot | undefined = undefined;

/** Record the snapshot keys as `env` holds them now (call before dotenv runs). */
export function recordPreDotenvProfileEnv(env: NodeJS.ProcessEnv): void {
  const recorded: ProfileEnvSnapshot = {};
  for (const key of PROFILE_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) recorded[key] = value;
  }
  snapshot = recorded;
}

/** Test-only: forget the recorded snapshot. */
export function resetPreDotenvProfileEnv(): void {
  snapshot = undefined;
}

/**
 * A copy of `env` whose profile keys carry their pre-dotenv values (a key the
 * snapshot lacked is deleted), or `env` itself when nothing was recorded.
 */
export function profileEnvView(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (snapshot === undefined) return env;
  const view: NodeJS.ProcessEnv = { ...env };
  for (const key of PROFILE_ENV_KEYS) {
    const recorded = snapshot[key];
    if (recorded === undefined) {
      delete view[key];
    } else {
      view[key] = recorded;
    }
  }
  return view;
}
