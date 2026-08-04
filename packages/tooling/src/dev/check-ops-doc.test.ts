/**
 * Tests for the ops-CLI reference-doc drift guard.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findOpsDocDrift,
  findUnparsedRegistrations,
  isDocumented,
  listRegisteredOpsCommands,
} from './check-ops-doc.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

let root: string;

/** Write a fake registrar module + reference doc into the temp root. */
function seed(registrarSource: string, docBody: string): void {
  const commandsDir = join(root, 'packages/tooling/src/commands');
  mkdirSync(commandsDir, { recursive: true });
  writeFileSync(join(commandsDir, 'fake.ts'), registrarSource);
  // A .test.ts sibling must be ignored by the scan.
  writeFileSync(join(commandsDir, 'fake.test.ts'), `cli.command('never:registered', 'x')`);
  mkdirSync(join(root, 'docs/reference/tooling'), { recursive: true });
  writeFileSync(join(root, 'docs/reference/tooling/OPS_CLI_REFERENCE.md'), docBody);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ops-doc-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('listRegisteredOpsCommands', () => {
  it('collects full namespace:name strings across single- and multi-line calls', () => {
    seed(
      [
        `cli.command('db:migrate', 'Run pending migrations').action(noop);`,
        `cli`,
        `  .command(`,
        `    'guard:ops-doc',`,
        `    'Fail when the reference doc drifts'`,
        `  )`,
        `  .action(noop);`,
        `cli.command('run [...command]', 'Run with env').action(noop);`,
      ].join('\n'),
      ''
    );
    expect(listRegisteredOpsCommands(root)).toEqual(['db:migrate', 'guard:ops-doc', 'run']);
  });

  it('finds a known real command in the actual repo registrars', () => {
    expect(listRegisteredOpsCommands(REPO_ROOT)).toContain('db:migrate');
  });
});

describe('isDocumented', () => {
  it('accepts an `ops <name>` mention and an exact backtick span', () => {
    expect(isDocumented('| `pnpm ops db:migrate --env dev` | Run |', 'db:migrate')).toBe(true);
    expect(isDocumented('the `cpd:check` gate runs in CI', 'cpd:check')).toBe(true);
  });

  it('does not let a longer sibling command document a shorter one', () => {
    expect(isDocumented('`pnpm ops test:audit-contracts`', 'test:audit')).toBe(false);
  });

  it('does not let prose document a bare-named command', () => {
    expect(isDocumented('a waiting backlog never blocks `on`', 'backlog')).toBe(false);
    expect(isDocumented('api-gateway 503s below `/health`', 'health')).toBe(false);
  });

  it('does not let prose ending in "ops" false-document the following word', () => {
    expect(isDocumented('if backup ops guard:example fails', 'guard:example')).toBe(false);
  });
});

describe('findOpsDocDrift', () => {
  const REGISTRAR = [
    `cli.command('db:migrate', 'Run pending migrations').action(noop);`,
    `cli.command('secrets:rotate-byok', 'Rotate').action(noop);`,
  ].join('\n');

  it('reports no drift when every registered command appears in the doc', () => {
    seed(REGISTRAR, '| `pnpm ops db:migrate` |\n| `pnpm ops secrets:rotate-byok` |\n');
    expect(findOpsDocDrift(root)).toEqual({
      undocumented: [],
      unparsed: [],
      staleAllowlist: [],
      staleDocRows: [],
    });
  });

  it('flags a doc table row whose command is no longer registered', () => {
    seed(
      REGISTRAR,
      '| `pnpm ops db:migrate` |\n| `pnpm ops secrets:rotate-byok` |\n| `pnpm ops removed:cmd --flag` |\n'
    );
    expect(findOpsDocDrift(root).staleDocRows).toEqual(['removed:cmd']);
  });

  it('does not reverse-check prose or code-fence mentions (rows only, by design)', () => {
    seed(
      REGISTRAR,
      '| `pnpm ops db:migrate` |\n| `pnpm ops secrets:rotate-byok` |\n' +
        'The old `pnpm ops retired:cmd` flow is gone.\n```bash\npnpm ops retired:cmd\n```\n'
    );
    expect(findOpsDocDrift(root).staleDocRows).toEqual([]);
  });

  it('flags a registered command with no mention, naming the command', () => {
    seed(REGISTRAR, '| `pnpm ops db:migrate` |\n');
    const drift = findOpsDocDrift(root);
    expect(drift.undocumented).toEqual(['secrets:rotate-byok']);
    expect(drift.unparsed).toEqual([]);
  });

  it('passes an undocumented command that is on the allowlist', () => {
    seed(REGISTRAR, '| `pnpm ops db:migrate` |\n');
    const allowlist = { 'secrets:rotate-byok': 'test-only entry' };
    expect(findOpsDocDrift(root, allowlist).undocumented).toEqual([]);
  });

  it('flags an allowlist entry whose command is documented after all', () => {
    seed(REGISTRAR, '| `pnpm ops db:migrate` |\n| `pnpm ops secrets:rotate-byok` |\n');
    const allowlist = { 'db:migrate': 'test-only entry' };
    expect(findOpsDocDrift(root, allowlist).staleAllowlist).toEqual(['db:migrate']);
  });

  it('is green against the real repo (the doc documents every registered command)', () => {
    expect(findOpsDocDrift(REPO_ROOT)).toEqual({
      undocumented: [],
      unparsed: [],
      staleAllowlist: [],
      staleDocRows: [],
    });
  });
});

describe('findUnparsedRegistrations', () => {
  it('flags a registration shape the name pattern cannot read', () => {
    seed('cli.command(`db:migrate`, "Run").action(noop);', '');
    expect(findUnparsedRegistrations(root)).toEqual(['packages/tooling/src/commands/fake.ts:1']);
  });

  it('accepts the multi-line call shape used across the real registrars', () => {
    expect(findUnparsedRegistrations(REPO_ROOT)).toEqual([]);
  });
});
