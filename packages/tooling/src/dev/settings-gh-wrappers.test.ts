/**
 * Pins the SYG_GH_WRAPPERS shape in the repo settings: the seyag walker reads
 * this whitespace-separated token list (its header documents the format) to
 * cover `pnpm ops gh:*` calls. Losing or mangling the value silently re-opens
 * the gap the wiring exists to close, so the shape goes red here.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoPath = (rel: string): string =>
  fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));

const SETTINGS_FILE = repoPath('.claude/settings.json');

const readSettingsEnv = (key: string): string => {
  const raw = (JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) as { env?: Record<string, unknown> })
    .env?.[key];
  if (typeof raw !== 'string') {
    throw new Error(`.claude/settings.json: missing string env.${key}`);
  }
  return raw;
};

describe('SYG_GH_WRAPPERS settings shape', () => {
  it('keeps the pnpm-ops wrapper prefix wired, exactly two tokens', () => {
    const tokens = readSettingsEnv('SYG_GH_WRAPPERS').trim().split(/\s+/);
    expect(tokens).toEqual(['pnpm', 'ops']);
  });

  it('keeps documented gh write verbs off the uncovered -C form', () => {
    const surfaces = [
      repoPath('.claude/rules/05-tooling.md'),
      repoPath('.claude/skills/tzurot-git-workflow/SKILL.md'),
    ].map(file => readFileSync(file, 'utf8'));
    const flagged = surfaces
      .map(content => content.match(/pnpm (?:-C \S+|--dir \S+) ops gh:(?!ci-gate)\S+/g) ?? [])
      .flat();
    expect(flagged).toEqual([]);
  });
});
