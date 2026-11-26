/**
 * The root vitest.config.ts's entry into the resource-profile resolver.
 *
 * Every package vitest config merges the root config, so this module resolves
 * `maxWorkers` for wrapped and unwrapped vitest runs alike. The .env layer is
 * read HERE — a bare vitest or `pnpm --filter <pkg> test` never passes through
 * the exec wrapper — anchored on the directory the caller passes (the config
 * passes its own directory, the repo root, never `process.cwd()`: turbo runs
 * package tasks with the package directory as cwd). The read is key-scoped
 * (envFile.ts) and falls back per key to the main checkout's .env for linked
 * worktrees. The .env-layer cases are pinned by vitestProfile.test.ts; a
 * wiring test importing the root config is not type-checkable from this
 * package (its spec tsconfig's rootDir), so none exists — the config's
 * one-line call is exercised by every package vitest run.
 */
import { readEnvFileValues } from './envFile.js';
import { resolveResourceProfile, type ResolvedProfile } from './profile.js';

export interface VitestProfileInput {
  env: Record<string, string | undefined>;
  /** Directory whose key-scoped .env read supplies the .env layer. */
  rootDir: string;
  cpus: number;
  memTotalBytes: number;
}

/** The resolver with the .env layer attached: always read, first match wins downstream. */
export function resolveVitestResourceProfile(input: VitestProfileInput): ResolvedProfile {
  const { rootDir, ...profileInput } = input;
  return resolveResourceProfile({ ...profileInput, envFileValues: readEnvFileValues(rootDir) });
}
