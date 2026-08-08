/**
 * Guard: every hook script has a probe harness, and every probe harness passes.
 *
 * The `.claude/hooks/*.probe.sh` files are exit-code harnesses over the hook
 * scripts — they are the ONLY verification those scripts have (a bash hook has
 * no unit-test tier). Until this guard existed they were documented as "run
 * manually after editing the hook", which makes the safety net attention-
 * dependent: a hook edit that regresses a guard merges green, and the probe
 * that would have caught it sits on disk unrun.
 *
 * Two halves, both hard-failing:
 *
 *  1. **Registry parity** — every hook script must appear in `HOOK_PROBES`
 *     with either a probe or a written reason, and every probe on disk must be
 *     referenced by an entry. Bidirectional, like guard:audit-tool-docs: a new
 *     hook added without a probe is a visible decision, and a probe whose hook
 *     was deleted stops being silently green.
 *  2. **Execution** — every registered probe runs. Total runtime is ~11s
 *     across the current six, which is noise beside the lint job's knip/cpd/
 *     depcruise steps, so this runs unconditionally rather than keying off a
 *     hooks-dir diff. An unconditional gate cannot drift out of sync with its
 *     own trigger condition.
 *
 * Binary sync-check plus a test run — NOT audit-class (no measurement, no
 * threshold, no baseline), so no WHY.md and no --summary, same as
 * guard:duplicate-exports and guard:monitor-command.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  GIT_HOOK_NAMES,
  HOOKS_DIR,
  HOOK_COMPANION_SUFFIXES,
  HOOK_PROBES,
  HOOK_SCRIPT_EXTENSIONS,
  HUSKY_DIR,
  PROBE_TIMEOUT_MS,
  type HookProbeEntry,
} from './check-hook-probes-registry.js';

/**
 * Hook scripts on disk, excluding harnesses, colocated tests, and the lib
 * directory.
 *
 * Two ways in, because one alone leaves a gap:
 *
 * - a recognised script EXTENSION, which is how every hook here is named today;
 * - or no extension at all plus the executable bit, which is how a hook would
 *   look if someone followed husky's exact-name convention instead. Without
 *   this arm such a file is invisible to the registry check — re-opening, under
 *   a different naming style, the exact gap this guard exists to close.
 *
 * The exec bit is not used as the SOLE rule because husky's own scripts are
 * mode 644; that constraint belongs to `.husky/`, which has its own exact-name
 * matcher, so it does not have to limit this directory.
 */
export function listHookScripts(dirEntries: string[], executableNames?: Set<string>): string[] {
  const executable = executableNames ?? new Set<string>();
  return dirEntries
    .filter(name => {
      if (HOOK_COMPANION_SUFFIXES.some(suffix => name.endsWith(suffix))) return false;
      if (HOOK_SCRIPT_EXTENSIONS.some(ext => name.endsWith(ext))) return true;
      return !name.includes('.') && executable.has(name);
    })
    .map(name => `${HOOKS_DIR}/${name}`)
    .sort();
}

/** Probe harnesses on disk. */
export function listProbeScripts(dirEntries: string[]): string[] {
  return dirEntries
    .filter(name => name.endsWith('.probe.sh'))
    .map(name => `${HOOKS_DIR}/${name}`)
    .sort();
}

/** Husky lifecycle scripts on disk, by exact git hook name. */
export function listHuskyHooks(fileNames: string[]): string[] {
  return fileNames
    .filter(name => GIT_HOOK_NAMES.includes(name))
    .map(name => `${HUSKY_DIR}/${name}`)
    .sort();
}

export interface RegistryProblems {
  /** Hook scripts on disk with no `HOOK_PROBES` row. */
  unregisteredHooks: string[];
  /** Registry rows whose hook file no longer exists. */
  missingHooks: string[];
  /** Registry rows naming a probe file that does not exist. */
  missingProbes: string[];
  /** Probe files on disk that no registry row references. */
  orphanProbes: string[];
  /** Hook paths appearing in more than one row. */
  duplicateHooks: string[];
  /** Probe paths referenced by more than one hook row. */
  duplicateProbes: string[];
  /** Rows with `probe: null` and no reason written. */
  unjustified: string[];
}

/**
 * Compare the registry against what is actually on disk. Pure so the failure
 * modes can be tested without a fixture hooks directory.
 *
 * `hooksOnDisk` carries both families — `.claude/hooks/*.sh` and the regular
 * files in `.husky/` — so a new hook in either place with no registry row is
 * reported the same way.
 */
export function findRegistryProblems(
  entries: HookProbeEntry[],
  hooksOnDisk: string[],
  probesOnDisk: string[],
  existingPaths: Set<string>
): RegistryProblems {
  const hookList = entries.map(e => e.hook);
  const registeredHooks = new Set(hookList);
  const probeList = entries.map(e => e.probe).filter((p): p is string => p !== null);
  const registeredProbes = new Set(probeList);
  const repeated = (list: string[]): string[] => [
    ...new Set(list.filter((v, i) => list.indexOf(v) !== i)),
  ];

  return {
    unregisteredHooks: hooksOnDisk.filter(h => !registeredHooks.has(h)),
    // The `length === 0` checks on BOTH path fields catch `''` written where a
    // real path (or, for probe, `null`) was meant. An empty path is not merely
    // wrong, it is INVISIBLE: `join(rootDir, '')` normalizes to rootDir, which
    // exists, so an existsSync test alone validates the row instead of failing
    // it. For `hook` that silently drops the row from file validation; for
    // `probe` it goes further and hands `bash <rootDir>` to runProbe, reporting
    // a confusing probe failure rather than a bad registry row. Both directions
    // are pinned by the empty-string cases in the tests — keep them symmetric.
    missingHooks: entries.map(e => e.hook).filter(h => h.length === 0 || !existingPaths.has(h)),
    missingProbes: [...registeredProbes].filter(p => p.length === 0 || !existingPaths.has(p)),
    orphanProbes: probesOnDisk.filter(p => !registeredProbes.has(p)),
    // Both duplicate checks live HERE, in the runtime guard, not only in the
    // registry's colocated data test — the guard has to be self-validating on
    // its own, since a test can be skipped or excluded from a run while the
    // gate still reports green.
    //
    // Two rows pointing at ONE probe is the failure this whole guard exists to
    // prevent, moved up a level: every signal reads healthy — the path exists,
    // something references it, the gate is green — while the second hook has no
    // verification at all. The plausible authoring slip is copy-pasting a row
    // and updating `hook:` but not `probe:`, which `orphanProbes` cannot see,
    // because it only asks whether a probe is referenced by SOME row. Duplicate
    // hooks are the mirror: the later row silently wins nothing, and one of the
    // two probes never runs against the hook its author thought it did.
    duplicateHooks: repeated(hookList),
    duplicateProbes: repeated(probeList),
    unjustified: entries
      .filter(e => e.probe === null && (e.unprobedReason ?? '').trim().length === 0)
      .map(e => e.hook),
  };
}

export function hasRegistryProblems(problems: RegistryProblems): boolean {
  // Enumerated rather than `Object.values` — an interface without an index
  // signature falls through to the `values(o: {}): any[]` overload, which
  // erases the element type and trips no-unsafe-member-access.
  return [
    problems.unregisteredHooks,
    problems.missingHooks,
    problems.missingProbes,
    problems.orphanProbes,
    problems.duplicateHooks,
    problems.duplicateProbes,
    problems.unjustified,
  ].some(list => list.length > 0);
}

function reportRegistryProblems(problems: RegistryProblems): void {
  const sections: [string[], string][] = [
    [
      problems.unregisteredHooks,
      'Hook scripts with no HOOK_PROBES row (add one, with a probe or a reason)',
    ],
    [problems.missingHooks, 'HOOK_PROBES rows whose hook file is gone (delete the row)'],
    [problems.missingProbes, 'HOOK_PROBES rows naming a probe file that does not exist'],
    [problems.orphanProbes, 'Probe files no row references (wire them up or delete them)'],
    [problems.duplicateHooks, 'Hook paths appearing in MORE THAN ONE row (merge or fix them)'],
    [
      problems.duplicateProbes,
      'Probe files referenced by MORE THAN ONE hook row (each hook needs its own harness)',
    ],
    [problems.unjustified, 'Rows with probe: null and no unprobedReason'],
  ];
  for (const [items, heading] of sections) {
    if (items.length === 0) continue;
    console.error(`\n❌ ${heading}:`);
    for (const item of items) console.error(`   ${item}`);
  }
  console.error('\nRegistry: packages/tooling/src/dev/check-hook-probes-registry.ts');
}

/**
 * Run one probe. Returns null on success, or the captured output on failure.
 *
 * A timeout kill surfaces as a normal failure with whatever the probe managed
 * to print, plus a note naming the signal — `execFileSync` reports a SIGTERM
 * kill the same way as a non-zero exit, and "no probes passed" with no reason
 * given is the least useful thing this guard could say.
 *
 * Limit worth knowing: the timeout signals the `bash` process only, not
 * anything it spawned. A hang wedged inside a grandchild (a stuck
 * `git worktree add`, say) is reported on time but can outlive the report.
 * Bounded to the rest of an ephemeral CI job, so not worth process-group
 * machinery — but the report means "we stopped waiting", not "it stopped".
 */
export function runProbe(
  probePath: string,
  rootDir: string,
  timeoutMs: number = PROBE_TIMEOUT_MS
): string | null {
  try {
    execFileSync('bash', [probePath], {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });
    return null;
  } catch (error) {
    const shaped = error as { stdout?: string; stderr?: string; signal?: string };
    // Reports the SIGNAL, and names the timeout as the likely cause rather than
    // asserting it. All that is actually observable here is that bash was
    // SIGTERM'd; a cancelled CI job delivers the identical signal, and a message
    // reading "hung after 120000ms" on a job someone cancelled at 20s sends the
    // reader after a hang that never happened.
    const killed =
      shaped.signal === 'SIGTERM'
        ? `\n(SIGTERM — usually the ${timeoutMs}ms probe ceiling; an external cancel looks the same)`
        : '';
    const output = `${shaped.stdout ?? ''}${shaped.stderr ?? ''}`.trim();
    return `${output.length > 0 ? output : String(error)}${killed}`;
  }
}

export interface CheckHookProbesOptions {
  /** Repo root the paths resolve against. Injectable so tests can use a fixture tree. */
  rootDir?: string;
  /** Registry to check. Injectable so tests can drive the failure branches. */
  entries?: HookProbeEntry[];
}

export function checkHookProbes(options: CheckHookProbesOptions = {}): void {
  const rootDir = options.rootDir ?? process.cwd();
  const entries = options.entries ?? HOOK_PROBES;

  const readDir = (dir: string): string[] =>
    existsSync(join(rootDir, dir))
      ? readdirSync(join(rootDir, dir), { withFileTypes: true })
          .filter(d => d.isFile())
          .map(d => d.name)
      : [];

  const hookEntries = readDir(HOOKS_DIR);
  // Feeds listHookScripts' extensionless arm. statSync rather than a Dirent
  // field because Dirent carries no mode.
  const executableHookNames = new Set(
    hookEntries.filter(name => {
      try {
        return (statSync(join(rootDir, HOOKS_DIR, name)).mode & 0o111) !== 0;
      } catch {
        return false;
      }
    })
  );
  const hooksOnDisk = [
    ...listHookScripts(hookEntries, executableHookNames),
    ...listHuskyHooks(readDir(HUSKY_DIR)),
  ];
  const probesOnDisk = listProbeScripts(hookEntries);
  const existingPaths = new Set(
    [...entries.map(e => e.hook), ...entries.map(e => e.probe)]
      .filter((p): p is string => p !== null)
      .filter(p => existsSync(join(rootDir, p)))
  );

  // Registry problems short-circuit BEFORE any probe runs, deliberately: a
  // broken registry means the guard does not yet know what it is checking, so
  // spending ~11s to also report probe results would be answering a question
  // nobody asked. The cost is that a change breaking both needs two cycles to
  // see both — accepted, since the registry error has to be fixed before the
  // probe results mean anything anyway.
  const problems = findRegistryProblems(entries, hooksOnDisk, probesOnDisk, existingPaths);
  if (hasRegistryProblems(problems)) {
    reportRegistryProblems(problems);
    process.exitCode = 1;
    return;
  }

  const probes = entries.map(e => e.probe).filter((p): p is string => p !== null);
  const failures: { probe: string; output: string }[] = [];
  for (const probe of probes) {
    const output = runProbe(join(rootDir, probe), rootDir);
    if (output !== null) failures.push({ probe, output });
  }

  if (failures.length > 0) {
    console.error(`❌ ${failures.length} of ${probes.length} hook probe(s) FAILED.`);
    for (const { probe, output } of failures) {
      console.error(`\n--- ${probe} ---\n${output}`);
    }
    process.exitCode = 1;
    return;
  }

  const unprobed = entries.filter(e => e.probe === null).length;
  console.log(
    `✓ ${probes.length} hook probe(s) passed; ${unprobed} hook(s) registered as unprobed with a reason.`
  );
}
