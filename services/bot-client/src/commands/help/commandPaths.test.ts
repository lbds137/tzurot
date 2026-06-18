/**
 * Tests for /help command-path utilities (flatten + resolve).
 */

import { describe, it, expect, vi } from 'vitest';
import type { Command } from '../../types.js';
import {
  flattenCommandLeaves,
  getCommandOptions,
  resolveHelpTarget,
  type CommandOptionNode,
} from './commandPaths.js';

/** Build a Command whose `data` is a plain object (no toJSON) — the test-fixture shape. */
function plainCommand(name: string, description: string, options?: CommandOptionNode[]): Command {
  return {
    data: { name, description, ...(options !== undefined && { options }) },
    execute: vi.fn(),
  } as unknown as Command;
}

const CHARACTER = plainCommand('character', 'Manage AI characters', [
  { type: 1, name: 'chat', description: 'Chat one-on-one' },
  {
    type: 1,
    name: 'create',
    description: 'Create a character',
    options: [
      { type: 3, name: 'name', description: 'Character name' },
      { type: 3, name: 'slug', description: 'URL slug' },
    ],
  },
]);

const ADMIN = plainCommand('admin', 'Owner tools', [
  {
    type: 2,
    name: 'presence',
    description: 'Bot presence',
    options: [
      { type: 1, name: 'set', description: 'Set presence' },
      { type: 1, name: 'clear', description: 'Clear presence' },
    ],
  },
  { type: 1, name: 'status', description: 'Show status' },
]);

const HELP = plainCommand('help', 'Show all available commands');

describe('flattenCommandLeaves', () => {
  it('emits one leaf per subcommand as "name sub"', () => {
    expect(flattenCommandLeaves(CHARACTER)).toEqual([
      { path: 'character chat', description: 'Chat one-on-one' },
      { path: 'character create', description: 'Create a character' },
    ]);
  });

  it('expands subcommand groups as "name group sub" and keeps flat subcommands', () => {
    expect(flattenCommandLeaves(ADMIN)).toEqual([
      { path: 'admin presence set', description: 'Set presence' },
      { path: 'admin presence clear', description: 'Clear presence' },
      { path: 'admin status', description: 'Show status' },
    ]);
  });

  it('yields a single leaf (the command name) for a flat command with no subcommands', () => {
    expect(flattenCommandLeaves(HELP)).toEqual([
      { path: 'help', description: 'Show all available commands' },
    ]);
  });

  it('prefers toJSON() output over raw .options (live-builder type fix)', () => {
    // Simulates the live SlashCommandBuilder: raw .options carry a name but NO
    // numeric type (so reading them directly classifies nothing as a
    // subcommand), while toJSON() populates type. The flatten must use toJSON.
    const liveLike = {
      data: {
        name: 'voice',
        description: 'Voice settings',
        options: [{ name: 'tts' }], // no `type` → would be invisible if read raw
        toJSON: () => ({
          name: 'voice',
          description: 'Voice settings',
          options: [{ type: 1, name: 'tts', description: 'TTS settings' }],
        }),
      },
      execute: vi.fn(),
    } as unknown as Command;

    expect(flattenCommandLeaves(liveLike)).toEqual([
      { path: 'voice tts', description: 'TTS settings' },
    ]);
  });
});

describe('getCommandOptions', () => {
  it('falls back to raw .options for plain fixtures without toJSON', () => {
    expect(getCommandOptions(CHARACTER).map(o => o.name)).toEqual(['chat', 'create']);
  });

  it('returns [] when a command has no options', () => {
    expect(getCommandOptions(HELP)).toEqual([]);
  });
});

describe('resolveHelpTarget', () => {
  const commands = new Map<string, Command>([
    ['character', CHARACTER],
    ['admin', ADMIN],
    ['help', HELP],
  ]);

  it('resolves a bare command name to an overview', () => {
    const target = resolveHelpTarget(commands, 'character');
    expect(target).toEqual({ kind: 'overview', command: CHARACTER });
  });

  it('resolves "parent sub" to that single subcommand', () => {
    const target = resolveHelpTarget(commands, 'character create');
    expect(target.kind).toBe('subcommand');
    if (target.kind === 'subcommand') {
      expect(target.label).toBe('character create');
      expect(target.option.name).toBe('create');
      expect(target.option.options?.map(o => o.name)).toEqual(['name', 'slug']);
    }
  });

  it('resolves "parent group sub" through a subcommand group', () => {
    const target = resolveHelpTarget(commands, 'admin presence set');
    expect(target.kind).toBe('subcommand');
    if (target.kind === 'subcommand') {
      expect(target.label).toBe('admin presence set');
      expect(target.option.description).toBe('Set presence');
    }
  });

  it('is case-insensitive and tolerates extra whitespace', () => {
    expect(resolveHelpTarget(commands, '  Character   CREATE ').kind).toBe('subcommand');
  });

  it('returns unknown for an unregistered parent', () => {
    expect(resolveHelpTarget(commands, 'nope')).toEqual({ kind: 'unknown' });
  });

  it('returns unknown for a nonexistent subcommand of a real parent', () => {
    expect(resolveHelpTarget(commands, 'character fly')).toEqual({ kind: 'unknown' });
  });

  it('returns unknown for an empty value', () => {
    expect(resolveHelpTarget(commands, '   ')).toEqual({ kind: 'unknown' });
  });
});
