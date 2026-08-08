import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { GIT_HOOK_NAMES, HOOK_PROBES } from './check-hook-probes-registry.js';

const REPO_ROOT = join(import.meta.dirname, '../../../..');

describe('HOOK_PROBES registry (against the real tree)', () => {
  // The non-empty assertions are not redundant with existsSync: join(root, '')
  // normalizes to root, which exists, so an empty path would sail through the
  // existence check and quietly drop the row from validation entirely.
  it('names files that exist', () => {
    for (const { hook, probe } of HOOK_PROBES) {
      expect(hook.length, 'a row has an empty hook path').toBeGreaterThan(0);
      expect(existsSync(join(REPO_ROOT, hook)), `${hook} is missing`).toBe(true);
      if (probe !== null) {
        expect(probe.length, `${hook} has an empty probe path`).toBeGreaterThan(0);
        expect(existsSync(join(REPO_ROOT, probe)), `${probe} is missing`).toBe(true);
      }
    }
  });

  it('has no duplicate hook rows', () => {
    const hooks = HOOK_PROBES.map(e => e.hook);
    expect(new Set(hooks).size).toBe(hooks.length);
  });

  // The symmetric half. A copy-pasted row that updates `hook:` but not `probe:`
  // leaves the new hook unverified while every other signal stays green.
  it('has no probe referenced by two hooks', () => {
    const probes = HOOK_PROBES.map(e => e.probe).filter((p): p is string => p !== null);
    expect(new Set(probes).size, 'a probe is shared between hook rows').toBe(probes.length);
  });

  it('gives every unprobed hook a reason', () => {
    for (const { hook, probe, unprobedReason } of HOOK_PROBES) {
      if (probe === null) {
        expect((unprobedReason ?? '').trim().length, `${hook} needs a reason`).toBeGreaterThan(0);
      }
    }
  });
});

describe('GIT_HOOK_NAMES', () => {
  // The allowlist is what makes .husky/ discovery exact, so a hook this repo
  // actually uses being absent from it would silently un-cover that hook.
  it('covers every husky lifecycle script this repo has', () => {
    for (const { hook } of HOOK_PROBES) {
      if (!hook.startsWith('.husky/')) continue;
      expect(GIT_HOOK_NAMES, `${hook} is not a recognised git hook name`).toContain(
        hook.slice('.husky/'.length)
      );
    }
  });

  it('has no duplicates', () => {
    expect(new Set(GIT_HOOK_NAMES).size).toBe(GIT_HOOK_NAMES.length);
  });
});
