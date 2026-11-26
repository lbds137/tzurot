/**
 * The shared resolve-and-layer step for every spawn site that fronts the
 * resource profile: exec.ts's runWrapped and the ops focus runners that spawn
 * turbo in-process (focus-runner.ts, test-summary.ts).
 *
 * `envFileValues` is the key-scoped read from envFile.ts; exec.ts and both ops
 * runners pass it. cli.ts's loadEnv.js (dotenv) reads only the checkout-local
 * .env, so the main-checkout fallback a linked worktree needs comes only from
 * `readEnvFileValues`.
 */
import { readEnvFileValues } from './envFile.js';
import { liveMachineFacts } from './machineFacts.js';
import { profileEnvView } from './preDotenvEnv.js';
import {
  buildProfileEnv,
  formatProfileLine,
  resolveResourceProfile,
  type ProfileInput,
  type ResolvedProfile,
} from './profile.js';

export interface ProfileSpawnEnv {
  resolved: ResolvedProfile;
  /** `input.env` with the profile additions layered on top; the input is never mutated. */
  env: Record<string, string | undefined>;
}

/** One resolve-and-layer for a spawn: profile resolution plus the env additions over the inherited env. */
export function resolveProfileSpawnEnv(input: ProfileInput): ProfileSpawnEnv {
  const resolved = resolveResourceProfile(input);
  return { resolved, env: { ...input.env, ...buildProfileEnv(resolved, input.env) } };
}

/**
 * Resolve the profile for an in-process ops runner and return its spawn env.
 *
 * Resolution reads `profileEnvView(env)` (the profile-owned keys as the shell
 * held them before loadEnv.ts merged `.env`) plus the key-scoped `.env` read,
 * so a shell value outranks `.env` as documented. The spawn env is that same
 * view with the profile additions on top, so a `.env` TURBO_CONCURRENCY or
 * NODE_OPTIONS cannot leak into the child when the profile emits no value for
 * the key. An invalid value throws `UsageError`, which cli.ts reports.
 * Prints the profile line to stderr. Pinned by spawnEnv.test.ts.
 */
export function resolveLiveProfileSpawnEnv(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): ProfileSpawnEnv {
  const view = profileEnvView(env);
  const input: ProfileInput = {
    env: view,
    envFileValues: readEnvFileValues(cwd),
    ...liveMachineFacts(),
  };
  const resolved = resolveResourceProfile(input);
  const additions = buildProfileEnv(resolved, view);
  console.error(formatProfileLine(resolved));
  return { resolved, env: { ...view, ...additions } };
}
