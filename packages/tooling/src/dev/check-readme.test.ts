/**
 * Tests for the README drift guard's filesystem-facts gatherer.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { findReadmeDrift, listContextMenuNames } from './check-readme.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('findReadmeDrift', () => {
  it('is green against the real repo (the README agrees with the repo it describes)', () => {
    expect(findReadmeDrift(REPO_ROOT)).toEqual({
      projectStructure: [],
      prerequisites: [],
      fencedScripts: [],
      slashCommands: [],
      links: [],
    });
  });
});

describe('listContextMenuNames', () => {
  let tempRoot: string | undefined;

  afterEach(() => {
    if (tempRoot !== undefined) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it('collects every `.setName(...)` in a single command module file, sorted', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'check-readme-'));
    const commandsDir = join(tempRoot, 'services/bot-client/src/commands');
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(
      join(commandsDir, 'inspect.ts'),
      [
        "const menuB = new ContextMenuCommandBuilder().setName('B');",
        "const menuA = new ContextMenuCommandBuilder().setName('A');",
      ].join('\n'),
      'utf-8'
    );

    expect(listContextMenuNames(tempRoot)).toEqual(['A', 'B']);
  });

  it('ignores a slash-command option builder `.setName(...)` that is not a context-menu builder', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'check-readme-'));
    const commandsDir = join(tempRoot, 'services/bot-client/src/commands');
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(
      join(commandsDir, 'mixed.ts'),
      [
        "const menu = new ContextMenuCommandBuilder().setName('Menu A');",
        "builder.addStringOption(o => o.setName('opt'));",
      ].join('\n'),
      'utf-8'
    );

    expect(listContextMenuNames(tempRoot)).toEqual(['Menu A']);
  });

  it("matches the real repo's two message context-menu commands", () => {
    expect(listContextMenuNames(REPO_ROOT)).toEqual(['Inspect Message', 'View Reasoning']);
  });

  it('reports names reachable through a chained builder, not a later deferred `.setName(...)` call', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'check-readme-'));
    const commandsDir = join(tempRoot, 'services/bot-client/src/commands');
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(
      join(commandsDir, 'deferred.ts'),
      [
        'const a = new ContextMenuCommandBuilder();',
        "const b = new ContextMenuCommandBuilder().setName('B');",
        "a.setName('A');",
      ].join('\n'),
      'utf-8'
    );

    // `b`'s name is set in the same chained expression as its `new
    // ContextMenuCommandBuilder()` call, so the scan finds it. `a`'s name is
    // set by a separate, non-chained statement afterward — a shape the scan
    // does not claim to see.
    expect(listContextMenuNames(tempRoot)).toEqual(['B']);
  });
});
