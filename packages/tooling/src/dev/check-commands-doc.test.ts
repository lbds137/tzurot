/**
 * Tests for the commands-doc drift guard.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findCommandsDocDrift,
  listCommandModules,
  listDocumentedCommands,
} from './check-commands-doc.js';

let root: string;

function seed(commandDirs: string[], docLines: string[]): void {
  const commandsDir = join(root, 'services/bot-client/src/commands');
  mkdirSync(commandsDir, { recursive: true });
  for (const dir of commandDirs) {
    mkdirSync(join(commandsDir, dir));
  }
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs/commands.md'), docLines.join('\n'));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'commands-doc-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('findCommandsDocDrift', () => {
  it('reports in-sync when every module has a row and every row a module', () => {
    seed(
      ['character', 'memory'],
      ['| `/character` | `create` | Manage |', '| `/memory` | `browse` | Memories |']
    );
    expect(findCommandsDocDrift(root)).toEqual({ undocumented: [], stale: [] });
  });

  it('flags a command module with no doc row (the /feedback class)', () => {
    seed(['character', 'feedback'], ['| `/character` | `create` | Manage |']);
    expect(findCommandsDocDrift(root)).toEqual({ undocumented: ['feedback'], stale: [] });
  });

  it('flags a documented command whose module is gone (stale row)', () => {
    seed(['character'], ['| `/character` | x |', '| `/oldcmd` | y |']);
    expect(findCommandsDocDrift(root)).toEqual({ undocumented: [], stale: ['oldcmd'] });
  });

  it('counts continuation rows (empty first cell) and prose mentions as no documentation', () => {
    seed(
      ['character'],
      [
        // Continuation row for a multi-line command entry — belongs to /character.
        '| `/character` | `create` | Manage |',
        '|              | `import` | Portability |',
        // Prose mention outside a table row must not count as documentation.
        'The `/ghost` command is described nowhere else.',
      ]
    );
    expect(findCommandsDocDrift(root)).toEqual({ undocumented: [], stale: [] });
  });

  it('lists helpers: modules from dirs only, documented from row-leading cells only', () => {
    seed(
      ['channel', 'admin'],
      ['| `/admin` | `ping` | Owner |', '| `/channel` | `activate` | Channels |']
    );
    expect(listCommandModules(root)).toEqual(['admin', 'channel']);
    expect(listDocumentedCommands(root)).toEqual(['admin', 'channel']);
  });
});
