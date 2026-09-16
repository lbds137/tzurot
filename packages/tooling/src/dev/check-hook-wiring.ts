/**
 * Guard: every registered hook is actually invoked by something.
 *
 * `guard:hook-probes` (check-hook-probes.ts) proves every hook has a passing
 * probe, but a probe only pins what the hook DOES when run — it says nothing
 * about whether anything ever runs it. A hook can sit in the hooks directory
 * with a green registry row and a written `unprobedReason` while being wired
 * into nothing at all: every signal reads healthy and the hook never fires.
 * This guard closes that gap by requiring a wiring reference for every
 * non-probe hook — `.claude/settings.json`, a `.husky/` script, or another
 * hook that sources it as a helper.
 *
 * `.claude/settings.local.json` deliberately does not count: it is gitignored,
 * so a wiring reference that lives only there is invisible to every other
 * contributor and to CI.
 *
 * A `.husky/*` row is skipped — git invokes those by exact filename, so there
 * is nothing to wire.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HOOK_PROBES, HUSKY_DIR, type HookProbeEntry } from './check-hook-probes-registry.js';

export interface HookWiringProblem {
  hook: string;
}

/**
 * Pure: a hook is wired when its basename appears somewhere in the corpus of
 * text assembled for it (settings.json + husky scripts + every OTHER hook's
 * source). Split from the IO wrapper so the corpus-building and the decision
 * can be tested independently.
 */
export function findUnwiredHooks(hookPaths: string[], wiringCorpus: string): HookWiringProblem[] {
  return hookPaths
    .filter(hookPath => !wiringCorpus.includes(basename(hookPath)))
    .map(hook => ({ hook }));
}

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

export interface CheckHookWiringOptions {
  /** Repo root the paths resolve against. Injectable so tests can use a fixture tree. */
  rootDir?: string;
  /** Registry to check. Injectable so tests can drive the failure branches. */
  entries?: HookProbeEntry[];
}

function readTextOrEmpty(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : '';
  } catch {
    return '';
  }
}

/**
 * Returns the unwired hooks. Reads the filesystem; `rootDir` is injectable so
 * tests can point it at a throwaway fixture tree instead of the real repo.
 */
export function findHookWiringProblems(options: CheckHookWiringOptions = {}): HookWiringProblem[] {
  const rootDir = options.rootDir ?? process.cwd();
  const entries = options.entries ?? HOOK_PROBES;

  const hookEntries = entries.filter(e => !e.hook.startsWith(`${HUSKY_DIR}/`));

  const settingsText = readTextOrEmpty(join(rootDir, '.claude', 'settings.json'));

  const huskyDir = join(rootDir, HUSKY_DIR);
  const huskyNames = existsSync(huskyDir)
    ? readdirSync(huskyDir, { withFileTypes: true })
        .filter(d => d.isFile())
        .map(d => d.name)
    : [];
  const huskyText = huskyNames.map(name => readTextOrEmpty(join(huskyDir, name))).join('\n');

  // Every hook's own source, keyed by its registry path, so the per-hook
  // corpus below can include every SIBLING hook's text while excluding its
  // own — a hook must not count as wiring itself.
  const hookSources = new Map(
    hookEntries.map(e => [e.hook, readTextOrEmpty(join(rootDir, e.hook))] as const)
  );

  return hookEntries
    .filter(e => {
      const otherHooksText = [...hookSources.entries()]
        .filter(([path]) => path !== e.hook)
        .map(([, text]) => text)
        .join('\n');
      const corpus = `${settingsText}\n${huskyText}\n${otherHooksText}`;
      return findUnwiredHooks([e.hook], corpus).length > 0;
    })
    .map(e => ({ hook: e.hook }));
}

/** Prints the unwired hooks, ending each line with the disposition it needs. */
export function reportHookWiringProblems(problems: HookWiringProblem[]): void {
  console.error('\n❌ Hooks registered but referenced by nothing that would run them:');
  for (const { hook } of problems) {
    console.error(
      `   ${hook} — referenced by no settings.json entry, .husky/ script, or sibling hook: wire it or delete it`
    );
  }
}
