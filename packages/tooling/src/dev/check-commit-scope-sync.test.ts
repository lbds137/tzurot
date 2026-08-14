import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SCOPE_DOC_SURFACES,
  extractDocScopes,
  computeExpectedDocScopes,
  findScopeDrift,
  loadAllScopes,
  checkCommitScopeSync,
} from './check-commit-scope-sync.js';

const RULE_LINE =
  '**Scopes:** every `packages/` + `services/` directory name (generated), plus `tests` and ' +
  'the static root set — `backlog`, `ci`, `deps`, `docs`, `hooks`, `husky`, `legal`, `prisma`, ' +
  '`repo`, `rules`, `skills`. Source of truth is `allScopes` in `commitlint.config.cjs`; read it ' +
  'rather than trusting a list here.';

const SKILL_LINE =
  '**Scopes:** generated from every `packages/`+`services/` directory, plus `tests` and a static ' +
  'root set (`backlog`, `ci`, `deps`, `docs`, `hooks`, `husky`, `legal`, `prisma`, `repo`, `rules`, ' +
  '`skills`) — source of truth is `allScopes` in `commitlint.config.cjs`.';

const EXPECTED_STATIC_EQUIVALENT = [
  'backlog',
  'ci',
  'deps',
  'docs',
  'hooks',
  'husky',
  'legal',
  'prisma',
  'repo',
  'rules',
  'skills',
  'tests',
];

describe('extractDocScopes', () => {
  it('extracts the rendered scope set, excluding the mechanism tokens', () => {
    const result = extractDocScopes('f.md', `prose\n\n${RULE_LINE}\nmore prose\n`);
    expect(result.line).toBe(3);
    expect(result.scopes).toEqual(EXPECTED_STATIC_EQUIVALENT);
  });

  it('extracts the same set from the differently-punctuated skill copy', () => {
    const result = extractDocScopes('f.md', SKILL_LINE);
    expect(result.scopes).toEqual(EXPECTED_STATIC_EQUIVALENT);
  });

  it('throws when a surface carries no Scopes line', () => {
    expect(() => extractDocScopes('f.md', 'prose only\n')).toThrow(/no \*\*Scopes:\*\* line/);
  });

  it('throws when a surface carries several', () => {
    expect(() => extractDocScopes('f.md', `${RULE_LINE}\n${RULE_LINE}\n`)).toThrow(/found 2/);
  });
});

describe('computeExpectedDocScopes', () => {
  it('keeps a generated tests entry but drops package/service directory names', () => {
    const allScopes = ['backlog', 'ci', 'bot-client', 'voice-engine', 'tests'].sort();
    const result = computeExpectedDocScopes(allScopes, ['bot-client'], ['voice-engine']);
    expect(result).toEqual(['backlog', 'ci', 'tests']);
  });

  it('reflects a newly added static scope', () => {
    // The landmine this pins: allScopes is partly generated, so a naive
    // literal-array comparison would miss a static addition once any package
    // or service directory also changed — this asserts the split still works
    // when the static set grows.
    const allScopes = ['backlog', 'bot-client', 'newscope'].sort();
    const result = computeExpectedDocScopes(allScopes, ['bot-client'], []);
    expect(result).toEqual(['backlog', 'newscope']);
  });
});

describe('findScopeDrift', () => {
  const surface = (file: string, scopes: string[]): ReturnType<typeof extractDocScopes> => ({
    file,
    line: 1,
    scopes,
  });

  it('reports nothing when every surface matches the expected set', () => {
    const expected = ['a', 'b'];
    const surfaces = [surface('f1.md', ['a', 'b']), surface('f2.md', ['a', 'b'])];
    expect(findScopeDrift(expected, surfaces)).toEqual([]);
  });

  it('flags a surface missing a scope the source added', () => {
    const expected = ['a', 'b', 'c'];
    const surfaces = [surface('f1.md', ['a', 'b'])];
    const result = findScopeDrift(expected, surfaces);
    expect(result).toHaveLength(1);
    expect(result[0].missing).toEqual(['c']);
    expect(result[0].extra).toEqual([]);
  });

  it('flags a surface carrying a scope the source removed', () => {
    const expected = ['a', 'b'];
    const surfaces = [surface('f1.md', ['a', 'b', 'stale'])];
    const result = findScopeDrift(expected, surfaces);
    expect(result).toHaveLength(1);
    expect(result[0].missing).toEqual([]);
    expect(result[0].extra).toEqual(['stale']);
  });

  it('checks each surface independently against the source, not against each other', () => {
    // Two surfaces that agree with each other but not with the source is
    // exactly the failure this guard exists to catch — a drift finder that
    // only diffed surfaces against one another would report nothing here.
    const expected = ['a', 'b'];
    const surfaces = [surface('f1.md', ['a']), surface('f2.md', ['a'])];
    const result = findScopeDrift(expected, surfaces);
    expect(result).toHaveLength(2);
  });
});

describe('loadAllScopes', () => {
  it('reads the live generated array from commitlint.config.cjs', () => {
    const rootDir = join(import.meta.dirname, '../../../..');
    const allScopes = loadAllScopes(rootDir);
    expect(allScopes).toContain('tooling');
    expect(allScopes).toContain('backlog');
    expect(allScopes).toEqual([...allScopes].sort());
  });
});

describe('the real surfaces', () => {
  it('both markdown copies match allScopes in commitlint.config.cjs (this is the guard, run as a test)', () => {
    const rootDir = join(import.meta.dirname, '../../../..');
    const allScopes = loadAllScopes(rootDir);
    const surfaces = SCOPE_DOC_SURFACES.map(file =>
      extractDocScopes(file, readFileSync(join(rootDir, file), 'utf-8'))
    );
    expect(surfaces.length).toBe(SCOPE_DOC_SURFACES.length);
    // Recreate the same package/service directory split the CLI path uses.
    const listDirs = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    const expected = computeExpectedDocScopes(
      allScopes,
      listDirs(join(rootDir, 'packages')),
      listDirs(join(rootDir, 'services'))
    );
    expect(findScopeDrift(expected, surfaces)).toEqual([]);
  });
});

describe('checkCommitScopeSync (entry point)', () => {
  const STATIC_ROOT = [
    'backlog',
    'ci',
    'deps',
    'docs',
    'hooks',
    'husky',
    'legal',
    'prisma',
    'repo',
    'rules',
    'skills',
  ];

  let tmp: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let savedExitCode: typeof process.exitCode;

  /**
   * Builds a fixture repo root: a real `commitlint.config.cjs` (loaded via
   * `require`, so it has to be a real file on disk) plus the two markdown
   * surfaces, with one fake package dir and one fake service dir standing in
   * for the generated portion of `allScopes`.
   */
  function writeFixture(overrides?: { ruleScopes?: string[]; skillScopes?: string[] }): void {
    mkdirSync(join(tmp, 'packages/pkg-a'), { recursive: true });
    mkdirSync(join(tmp, 'services/svc-a'), { recursive: true });
    mkdirSync(join(tmp, '.claude/rules'), { recursive: true });
    mkdirSync(join(tmp, '.claude/skills/tzurot-git-workflow'), { recursive: true });

    const allScopes = ['pkg-a', 'svc-a', 'tests', ...STATIC_ROOT].sort();
    writeFileSync(
      join(tmp, 'commitlint.config.cjs'),
      `module.exports = { rules: { 'scope-enum': [2, 'always', ${JSON.stringify(allScopes)}] } };\n`
    );

    const ruleScopes = overrides?.ruleScopes ?? ['tests', ...STATIC_ROOT];
    const skillScopes = overrides?.skillScopes ?? ['tests', ...STATIC_ROOT];
    writeFileSync(
      join(tmp, '.claude/rules/05-tooling.md'),
      '**Scopes:** every `packages/` + `services/` directory name (generated), plus the ' +
        `static root set — ${ruleScopes.map(s => `\`${s}\``).join(', ')}. Source of truth is ` +
        '`allScopes` in `commitlint.config.cjs`.\n'
    );
    writeFileSync(
      join(tmp, '.claude/skills/tzurot-git-workflow/SKILL.md'),
      '**Scopes:** generated from every `packages/`+`services/` directory (static root set: ' +
        `${skillScopes.map(s => `\`${s}\``).join(', ')}) — source of truth is ` +
        '`allScopes` in `commitlint.config.cjs`.\n'
    );
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'guard-commit-scope-sync-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmp);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = savedExitCode;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('leaves exitCode untouched and logs success when both surfaces match allScopes', () => {
    writeFixture();
    checkCommitScopeSync();
    expect(process.exitCode).not.toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Commit-scope prose matches allScopes')
    );
  });

  it('sets exitCode=1 and names the offending file and the missing scope on drift', () => {
    writeFixture({ ruleScopes: ['tests', ...STATIC_ROOT.filter(s => s !== 'skills')] });
    checkCommitScopeSync();
    expect(process.exitCode).toBe(1);
    const output = errorSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
    expect(output).toContain('05-tooling.md');
    expect(output).toContain('skills');
  });

  it('sets exitCode=1 and names a stale scope the source no longer carries', () => {
    // The other drift direction: a surface keeps a scope that was removed from
    // allScopes. Covered at the findScopeDrift level, but the entry point owns
    // the reporting, and "extra" and "missing" take different branches there.
    writeFixture({ skillScopes: ['tests', ...STATIC_ROOT, 'retiredscope'] });
    checkCommitScopeSync();
    expect(process.exitCode).toBe(1);
    const output = errorSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n');
    expect(output).toContain('SKILL.md');
    expect(output).toContain('retiredscope');
  });
});
