/**
 * Tests for the commands:audit consistency checks.
 *
 * Each check is exercised through `runChecks` over a small in-memory manifest,
 * then filtered by rule so a test asserts on exactly the finding it cares about.
 */

import { describe, it, expect } from 'vitest';
import { runChecks } from './commandsAuditChecks.js';
import type { CommandManifest, ManifestCommand } from './commandsAuditCore.js';

const HELP_CATEGORIES = ['Memory', 'Character', 'Other'];

/** Build a command with sensible handler defaults; override as needed. */
function command(overrides: Partial<ManifestCommand> & { name: string }): ManifestCommand {
  const { name } = overrides;
  return {
    category: 'Memory',
    description: `Default description for ${name}`,
    handlers: {
      execute: true,
      autocomplete: false,
      selectMenu: false,
      button: false,
      modal: false,
    },
    componentPrefixes: [],
    data: { name, description: `Default description for ${name}` },
    ...overrides,
  };
}

function manifest(commands: ManifestCommand[]): CommandManifest {
  return { helpCategories: HELP_CATEGORIES, commands };
}

describe('commandsAuditChecks: category-coverage', () => {
  it('flags a category not in helpCategories (minus Other)', () => {
    const findings = runChecks(
      manifest([
        command({
          name: 'oops',
          category: 'Bogus',
          description: 'A command with a bad category',
          data: { name: 'oops', description: 'A command with a bad category' },
        }),
      ])
    ).filter(f => f.rule === 'category-coverage');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
  });

  it('flags "Other" as an invalid category (silent bucketing)', () => {
    const findings = runChecks(
      manifest([
        command({
          name: 'misc',
          category: 'Other',
          description: 'A command bucketed to Other',
          data: { name: 'misc', description: 'A command bucketed to Other' },
        }),
      ])
    ).filter(f => f.rule === 'category-coverage');
    expect(findings).toHaveLength(1);
  });

  it('flags a command with no category', () => {
    const findings = runChecks(
      manifest([
        command({
          name: 'nocat',
          category: undefined,
          description: 'A command with no category at all',
          data: { name: 'nocat', description: 'A command with no category at all' },
        }),
      ])
    ).filter(f => f.rule === 'category-coverage');
    expect(findings).toHaveLength(1);
  });

  it('passes a valid category', () => {
    const findings = runChecks(
      manifest([
        command({
          name: 'memory',
          category: 'Memory',
          description: 'Manage your long-term memories',
          data: { name: 'memory', description: 'Manage your long-term memories' },
        }),
      ])
    ).filter(f => f.rule === 'category-coverage');
    expect(findings).toHaveLength(0);
  });
});

describe('commandsAuditChecks: description-presence', () => {
  it('flags an empty subcommand description (error) and a stub one (warn)', () => {
    const findings = runChecks(
      manifest([
        command({
          name: 'character',
          category: 'Character',
          description: 'Manage AI personalities and chats',
          data: {
            name: 'character',
            description: 'Manage AI personalities and chats',
            options: [
              { type: 1, name: 'browse', description: '' }, // empty -> error
              { type: 1, name: 'view', description: 'todo' }, // stub -> warn
            ],
          },
        }),
      ])
    ).filter(f => f.rule === 'description-presence');
    expect(findings.some(f => f.severity === 'error')).toBe(true);
    expect(findings.some(f => f.severity === 'warn')).toBe(true);
  });

  it('does not flag a real description that merely starts with a stub word', () => {
    // "Test your API key validity" begins with "Test" but is a legitimate,
    // long-enough description — the anchored stub regex must not flag it.
    const findings = runChecks(
      manifest([
        command({
          name: 'settings',
          category: 'Character',
          description: 'Manage your settings',
          data: {
            name: 'settings',
            description: 'Manage your settings',
            options: [{ type: 1, name: 'test', description: 'Test your API key validity' }],
          },
        }),
      ])
    ).filter(f => f.rule === 'description-presence');
    expect(findings).toHaveLength(0);
  });

  it('still flags a long-enough meta-note placeholder (TODO: ...)', () => {
    // Long enough to pass the minimum-length gate, so only the leading-word
    // stub regex can catch it — the regex's real value over the length check.
    const findings = runChecks(
      manifest([
        command({
          name: 'settings',
          category: 'Character',
          description: 'Manage your settings',
          data: {
            name: 'settings',
            description: 'Manage your settings',
            options: [{ type: 1, name: 'wip', description: 'TODO: wire this up later' }],
          },
        }),
      ])
    ).filter(f => f.rule === 'description-presence');
    expect(findings.some(f => f.severity === 'warn')).toBe(true);
  });

  it('walks nested group → subcommand → leaf descriptions', () => {
    const findings = runChecks(
      manifest([
        command({
          name: 'config',
          category: 'Memory',
          description: 'Configure things in a nested way',
          data: {
            name: 'config',
            description: 'Configure things in a nested way',
            options: [
              {
                type: 2, // group
                name: 'llm',
                description: 'LLM configuration group',
                options: [
                  {
                    type: 1, // subcommand
                    name: 'set',
                    description: 'Set an LLM configuration value',
                    options: [
                      { type: 3, name: 'value', description: '' }, // empty leaf -> error
                    ],
                  },
                ],
              },
            ],
          },
        }),
      ])
    ).filter(f => f.rule === 'description-presence');
    expect(findings.some(f => f.severity === 'error' && f.detail.includes('<value>'))).toBe(true);
  });
});

describe('commandsAuditChecks: subcommand-naming', () => {
  it('warns on legacy "list" and unknown subcommand names', () => {
    const findings = runChecks(
      manifest([
        command({
          name: 'character',
          category: 'Character',
          description: 'Manage AI personalities and chats',
          data: {
            name: 'character',
            description: 'Manage AI personalities and chats',
            options: [
              { type: 1, name: 'list', description: 'List all the things' },
              { type: 1, name: 'frobnicate', description: 'Do an unusual thing' },
              { type: 1, name: 'browse', description: 'Browse all the things' },
            ],
          },
        }),
      ])
    ).filter(f => f.rule === 'subcommand-naming');
    expect(findings).toHaveLength(2);
    expect(findings.some(f => f.detail.includes('list'))).toBe(true);
    expect(findings.some(f => f.detail.includes('frobnicate'))).toBe(true);
  });
});

describe('commandsAuditChecks: option-name-drift', () => {
  it('flags the same option name carrying different types across commands', () => {
    const findings = runChecks(
      manifest([
        command({
          name: 'a',
          description: 'Command A does memory things',
          data: {
            name: 'a',
            description: 'Command A does memory things',
            options: [{ type: 3, name: 'count', description: 'A count value here' }],
          },
        }),
        command({
          name: 'b',
          description: 'Command B does memory things',
          data: {
            name: 'b',
            description: 'Command B does memory things',
            options: [{ type: 4, name: 'count', description: 'A count value here' }],
          },
        }),
      ])
    ).filter(f => f.rule === 'option-name-drift');
    expect(findings.some(f => f.detail.includes('"count"'))).toBe(true);
  });

  it('flags near-synonym option names used across the surface', () => {
    const findings = runChecks(
      manifest([
        command({
          name: 'a',
          description: 'Command A does memory things',
          data: {
            name: 'a',
            description: 'Command A does memory things',
            options: [{ type: 3, name: 'preset', description: 'A preset value here' }],
          },
        }),
        command({
          name: 'b',
          description: 'Command B does memory things',
          data: {
            name: 'b',
            description: 'Command B does memory things',
            options: [{ type: 3, name: 'config', description: 'A config value here' }],
          },
        }),
      ])
    ).filter(f => f.rule === 'option-name-drift');
    expect(findings.some(f => f.detail.includes('preset / config'))).toBe(true);
  });
});

describe('commandsAuditChecks: component-handler-completeness', () => {
  it('flags a command with componentPrefixes but no button/select handler', () => {
    const findings = runChecks(
      manifest([
        command({
          name: 'memory',
          description: 'Manage your long-term memories',
          componentPrefixes: ['memory-browse'],
          data: { name: 'memory', description: 'Manage your long-term memories' },
        }),
      ])
    ).filter(f => f.rule === 'component-handler-completeness');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
  });

  it('passes a command that declares prefixes AND exports handlers', () => {
    const findings = runChecks(
      manifest([
        command({
          name: 'memory',
          description: 'Manage your long-term memories',
          handlers: {
            execute: true,
            autocomplete: false,
            selectMenu: true,
            button: true,
            modal: false,
          },
          componentPrefixes: ['memory-browse'],
          data: { name: 'memory', description: 'Manage your long-term memories' },
        }),
      ])
    ).filter(f => f.rule === 'component-handler-completeness');
    expect(findings).toHaveLength(0);
  });
});
