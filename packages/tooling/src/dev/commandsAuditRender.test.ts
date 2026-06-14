/**
 * Tests for the commands:audit inventory renderers (tree + markdown).
 */

import { describe, it, expect } from 'vitest';
import { renderTree, renderMarkdown, handlerBadges } from './commandsAuditRender.js';
import type { CommandManifest, ManifestCommand } from './commandsAuditCore.js';

const HANDLERS_ALL = {
  execute: true,
  autocomplete: true,
  selectMenu: true,
  button: true,
  modal: false,
};

const SAMPLE: ManifestCommand = {
  name: 'memory',
  category: 'Memory',
  description: 'Manage your long-term memories',
  handlers: HANDLERS_ALL,
  componentPrefixes: ['memory-browse'],
  data: {
    name: 'memory',
    description: 'Manage your long-term memories',
    options: [
      {
        type: 1,
        name: 'browse',
        description: 'Browse memories',
        options: [
          {
            type: 3,
            name: 'query',
            description: 'Search text',
            required: false,
            autocomplete: true,
          },
        ],
      },
    ],
  },
};

const manifest: CommandManifest = {
  helpCategories: ['Memory', 'Other'],
  commands: [SAMPLE],
};

describe('commandsAuditRender: handlerBadges', () => {
  it('lists the active handler flags', () => {
    expect(handlerBadges(SAMPLE)).toContain('autocomplete');
    expect(handlerBadges(SAMPLE)).toContain('select');
    expect(handlerBadges(SAMPLE)).toContain('button');
  });

  it('returns an empty string when no component handlers are present', () => {
    const bare: ManifestCommand = {
      ...SAMPLE,
      handlers: {
        execute: true,
        autocomplete: false,
        selectMenu: false,
        button: false,
        modal: false,
      },
    };
    expect(handlerBadges(bare)).toBe('');
  });
});

describe('commandsAuditRender: renderTree', () => {
  it('renders a tree with category, command, subcommand, option', () => {
    const out = renderTree(manifest);
    expect(out).toContain('Memory');
    expect(out).toContain('/memory');
    expect(out).toContain('browse');
    expect(out).toContain('query:string');
    expect(out).toContain('autocomplete');
  });
});

describe('commandsAuditRender: renderMarkdown', () => {
  it('renders markdown with headings and tables', () => {
    const out = renderMarkdown(manifest);
    expect(out).toContain('# Slash Command Surface');
    expect(out).toContain('## Memory');
    expect(out).toContain('### /memory');
    expect(out).toContain('| Subcommand | Description |');
  });
});
