import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCommandOptions, runCommandTypesCodegen } from './command-types.js';

// codegen/ → src/ → tooling/ → packages/ → repo root (same walk as defaultRootDir).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * Build a throwaway repo root containing one bot-client command file, so the
 * write / drift branches can be exercised without touching the real tree.
 */
function makeTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'cmd-types-'));
  const cmdDir = join(root, 'services/bot-client/src/commands/demo');
  mkdirSync(cmdDir, { recursive: true });
  writeFileSync(
    join(cmdDir, 'index.ts'),
    "new SlashCommandBuilder()\n  .setName('demo')\n" +
      "  .addStringOption(o => o.setName('foo').setRequired(true));\n"
  );
  return root;
}

describe('command-types codegen — live repo', () => {
  it('generates non-empty schema output from the live command files', () => {
    const output = generateCommandOptions(repoRoot);
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain('export const');
    // At least one generated `<name>Options` schema.
    expect(output).toMatch(/export const \w+Options/);
  });

  it('is deterministic — two runs produce identical output', () => {
    expect(generateCommandOptions(repoRoot)).toBe(generateCommandOptions(repoRoot));
  });

  it('check mode reports the committed commandOptions.ts is up-to-date', () => {
    // Drift guard: the codegen output must match the committed generated file,
    // mirroring the CI `--check`. Fails loudly if a command changed without a
    // regenerate + commit.
    const result = runCommandTypesCodegen({ check: true });
    expect(result.drifted).toEqual([]);
    expect(result.upToDate).toBe(true);
  });
});

describe('command-types codegen — write + drift (isolated temp root)', () => {
  it('write mode creates the output file with the generated schema', () => {
    const root = makeTempRepo();
    try {
      const result = runCommandTypesCodegen({ rootDir: root });
      expect(result.upToDate).toBe(true);
      const outPath = Object.keys(result.files)[0];
      // The generated dir did not exist in the temp root — the recursive
      // mkdirSync + writeFileSync branch must have created it.
      const written = readFileSync(outPath, 'utf-8');
      expect(written).toContain('export const demoOptions');
      expect(written).toContain("foo: { type: 'string', required: true }");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('check mode flags a hand-edited output file as drifted', () => {
    const root = makeTempRepo();
    try {
      const outPath = Object.keys(runCommandTypesCodegen({ rootDir: root }).files)[0];
      writeFileSync(outPath, '// stale hand-edit\n', 'utf-8');
      const result = runCommandTypesCodegen({ rootDir: root, check: true });
      expect(result.upToDate).toBe(false);
      expect(result.drifted).toEqual([outPath]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
