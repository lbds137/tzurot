/**
 * Mutation-surface gate (CI).
 *
 * Decides whether the mutation-tests job needs to run Stryker at all for a
 * given diff. A tracked package's mutation score is a function of its own
 * code + tests, its workspace dependencies, and shared build/test config —
 * when none of those changed, the score cannot have moved and the multi-
 * minute Stryker pass is pure cost (most PRs touch services, which are not
 * mutation-tracked at all).
 *
 * Affected-package detection delegates to `turbo ls --filter '...[base]'` —
 * the same dependency-closure engine the focus:* commands use — so a change
 * in e.g. common-types marks every dependent tracked package as affected
 * without this module maintaining its own workspace graph. Root-level files
 * turbo's package graph can't see (lockfile, root configs, the baseline,
 * this machinery itself) are matched explicitly.
 *
 * FAIL-OPEN: any internal error yields run=true. The gate must never be the
 * reason mutation testing silently stops running.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { MUTATED_PACKAGES } from './mutation-check.js';

/** Repo-root-relative files whose change always runs the mutation suite. */
const GLOBAL_TRIGGER_EXACT = new Set([
  'pnpm-lock.yaml',
  'package.json',
  'turbo.json',
  'vitest.config.ts',
  'vitest.workspace.ts',
  // pnpm's node_modules layout is load-bearing for Stryker's plugin
  // resolution (see the stryker.config.mjs plugin-glob note), and .npmrc
  // changes move neither turbo's affected set nor any package tree.
  '.npmrc',
  '.github/workflows/ci.yml',
  '.github/baselines/mutation-baseline.json',
  // CLI registration for the mutation:* commands: tooling is not a
  // workspace dep of any tracked package, so neither turbo's closure nor
  // the machinery prefix below would catch a wiring-only change there —
  // and the gated job is the only thing exercising that wiring.
  'packages/tooling/src/commands/test.ts',
]);

/**
 * Path prefixes that always run the suite: the mutation machinery itself,
 * and root tsconfigs (`tsconfig` only matches root-level files — package
 * tsconfigs live under `packages/<name>/` and are covered by turbo).
 */
const GLOBAL_TRIGGER_PREFIXES = ['packages/tooling/src/test/mutation-', 'tsconfig'];

const TRACKED_SCOPED = new Set(MUTATED_PACKAGES.map(name => `@tzurot/${name}`));

export interface MutationGateDecision {
  run: boolean;
  reasons: string[];
}

/** Pure decision core — inputs come from git and turbo, injected for tests. */
export function evaluateMutationGate(
  changedFiles: string[],
  affectedPackages: string[]
): MutationGateDecision {
  const reasons: string[] = [];

  for (const file of changedFiles) {
    if (GLOBAL_TRIGGER_EXACT.has(file) || GLOBAL_TRIGGER_PREFIXES.some(p => file.startsWith(p))) {
      reasons.push(`global trigger changed: ${file}`);
    }
  }

  const affectedTracked = affectedPackages.filter(name => TRACKED_SCOPED.has(name));
  if (affectedTracked.length > 0) {
    reasons.push(`tracked package(s) affected: ${affectedTracked.join(', ')}`);
  }

  return { run: reasons.length > 0, reasons };
}

function gitChangedFiles(base: string): string[] {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf-8',
  });
  return out
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

function turboAffectedPackages(base: string): string[] {
  const out = execFileSync(
    'pnpm',
    ['exec', 'turbo', 'ls', '--filter', `...[${base}]`, '--output=json'],
    {
      encoding: 'utf-8',
    }
  );
  // turbo's version banner goes to stderr, but be defensive about any
  // wrapper noise ahead of the JSON document.
  const jsonStart = out.indexOf('{');
  if (jsonStart === -1) {
    throw new Error('turbo ls produced no JSON output');
  }
  const parsed = JSON.parse(out.slice(jsonStart)) as {
    packages?: { items?: { name: string }[] };
  };
  return (parsed.packages?.items ?? []).map(item => item.name);
}

/** Append the decision for GitHub Actions step-output consumption. */
function writeGithubOutput(decision: MutationGateDecision): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath === undefined || outputPath.length === 0) {
    return;
  }
  try {
    appendFileSync(outputPath, `run=${String(decision.run)}\n`);
  } catch (error) {
    // Total fail-open: the workflow condition `run != 'false'` treats an
    // ABSENT output as "run", so swallowing a write failure keeps Stryker
    // running — throwing here would fail the step and (via GitHub's
    // implicit success() gating) skip the whole suite: fail-closed.
    console.warn(
      `⚠ mutation:gate could not write GITHUB_OUTPUT (${(error as Error).message}) — absent output reads as run`
    );
  }
}

export function runMutationGate(options: { base?: string } = {}): void {
  const base = options.base ?? 'origin/develop';
  let decision: MutationGateDecision;

  try {
    const changed = gitChangedFiles(base);
    const affected = turboAffectedPackages(base);
    decision = evaluateMutationGate(changed, affected);

    if (decision.run) {
      console.log(`Mutation surface changed vs ${base} — Stryker will run:`);
      for (const reason of decision.reasons) {
        console.log(`  • ${reason}`);
      }
    } else {
      console.log(
        `✓ No mutation surface changed vs ${base} ` +
          `(${String(changed.length)} changed files, 0 tracked packages affected) — Stryker skipped`
      );
    }
  } catch (error) {
    console.warn(
      `⚠ mutation:gate could not evaluate the diff (${(error as Error).message}) — failing open`
    );
    decision = { run: true, reasons: ['gate error — fail-open'] };
  }

  writeGithubOutput(decision);
}
