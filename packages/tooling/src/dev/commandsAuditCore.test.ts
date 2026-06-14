/**
 * Tests for the commands:audit shared core (types + structure helpers).
 *
 * These exercise the manifest-walking helpers directly so the checks/renderers
 * can rely on them without re-testing tree traversal in every consumer.
 */

import { describe, it, expect } from 'vitest';
import {
  type ManifestCommand,
  allLeafOptions,
  allSubcommands,
  groupByCategory,
  isLeafOption,
  isSubcommand,
  isSubcommandGroup,
  optionTypeName,
  topLevelOptions,
} from './commandsAuditCore.js';

const HANDLERS = {
  execute: true,
  autocomplete: false,
  selectMenu: false,
  button: false,
  modal: false,
};

function command(name: string, options: ManifestCommand['data']['options']): ManifestCommand {
  return {
    name,
    category: 'Memory',
    description: `Description for ${name}`,
    handlers: HANDLERS,
    componentPrefixes: [],
    data: { name, description: `Description for ${name}`, options },
  };
}

describe('commandsAuditCore: optionTypeName', () => {
  it('maps known Discord option types to readable names', () => {
    expect(optionTypeName(1)).toBe('subcommand');
    expect(optionTypeName(2)).toBe('group');
    expect(optionTypeName(3)).toBe('string');
    expect(optionTypeName(11)).toBe('attachment');
  });

  it('falls back to a stable typeN label for unknown types', () => {
    expect(optionTypeName(99)).toBe('type99');
  });
});

describe('commandsAuditCore: option predicates', () => {
  it('classifies subcommands, groups, and leaves', () => {
    expect(isSubcommand({ type: 1, name: 's' })).toBe(true);
    expect(isSubcommandGroup({ type: 2, name: 'g' })).toBe(true);
    expect(isLeafOption({ type: 3, name: 'l' })).toBe(true);
    expect(isLeafOption({ type: 1, name: 's' })).toBe(false);
  });
});

describe('commandsAuditCore: topLevelOptions', () => {
  it('returns an empty array when a command has no options', () => {
    expect(topLevelOptions(command('bare', undefined))).toEqual([]);
  });
});

describe('commandsAuditCore: allSubcommands', () => {
  it('collects subcommands nested in groups as well as top-level', () => {
    const cmd = command('config', [
      { type: 1, name: 'browse', description: 'top-level sub' },
      {
        type: 2,
        name: 'llm',
        description: 'group',
        options: [{ type: 1, name: 'set', description: 'nested sub' }],
      },
    ]);
    const names = allSubcommands(cmd).map(s => s.name);
    expect(names).toEqual(['browse', 'set']);
  });
});

describe('commandsAuditCore: allLeafOptions', () => {
  it('collects leaves with their owning subcommand path', () => {
    const cmd = command('config', [
      {
        type: 1,
        name: 'set',
        description: 'set sub',
        options: [{ type: 3, name: 'value', description: 'the value' }],
      },
    ]);
    const leaves = allLeafOptions(cmd);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].path).toBe('config set');
    expect(leaves[0].option.name).toBe('value');
  });

  it('captures top-level leaves at the command path', () => {
    const cmd = command('ping', [{ type: 5, name: 'silent', description: 'be quiet' }]);
    const leaves = allLeafOptions(cmd);
    expect(leaves[0].path).toBe('ping');
  });
});

describe('commandsAuditCore: groupByCategory', () => {
  it('groups by category and sorts categories + commands', () => {
    const cmds = [
      command('zebra', undefined),
      { ...command('apple', undefined), category: 'Aardvark' },
    ];
    const grouped = groupByCategory(cmds);
    expect(grouped[0][0]).toBe('Aardvark');
    expect(grouped[1][0]).toBe('Memory');
  });

  it('buckets a category-less command under "Other"', () => {
    const cmd = { ...command('orphan', undefined), category: undefined };
    const grouped = groupByCategory([cmd]);
    expect(grouped[0][0]).toBe('Other');
  });
});
