/**
 * Tests for the shared browse list-embed builder (§2.4/§3.1, D19).
 */

import { describe, it, expect } from 'vitest';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { buildBrowseListEmbed, type BrowseRowSpec } from './listEmbedBuilder.js';

interface Item {
  name: string;
  slug?: string;
  group?: string;
}

function rowFor(item: Item): BrowseRowSpec {
  return {
    groupHeader: item.group,
    badges: '🌐',
    name: item.name,
    techId: item.slug,
    metadata: undefined,
  };
}

const baseOptions = {
  entityEmoji: '🎭',
  titleNoun: 'Characters',
  itemsPerPage: 2,
  page: 0,
  formatRow: rowFor,
  empty: { noItems: 'You have none yet — start with `/character create`.' },
};

describe('buildBrowseListEmbed', () => {
  it('renders the §2.1 title grammar and BLURPLE default color', () => {
    const { embed } = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: [{ name: 'Lilith', slug: 'lilith' }],
    });

    expect(embed.data.title).toBe('🎭 Characters');
    expect(embed.data.color).toBe(DISCORD_COLORS.BLURPLE);
  });

  it('renders §2.4 rows: bold number, badges, bold name, backticked tech-id', () => {
    const { embed } = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: [{ name: 'Lilith', slug: 'lilith' }],
    });

    expect(embed.data.description).toContain('**1.** 🌐 **Lilith** (`lilith`)');
  });

  it('strips backticks from tech-ids so they cannot break out of the code span', () => {
    const { embed } = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: [{ name: 'Sneaky', slug: 'sl`ug' }],
    });

    expect(embed.data.description).toContain('(`slug`)');
    expect(embed.data.description).not.toContain('sl`ug');
  });

  it('omits the tech-id segment when none is provided', () => {
    const { embed } = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: [{ name: 'Fast Preset' }],
    });

    expect(embed.data.description).toContain('**1.** 🌐 **Fast Preset**');
    expect(embed.data.description).not.toContain('(`');
  });

  it('numbers rows by ABSOLUTE index so they match the select menu numbering', () => {
    const items: Item[] = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
    const { embed, startIndex, pageItems, safePage, totalPages } = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items,
      page: 1,
    });

    expect(safePage).toBe(1);
    expect(totalPages).toBe(2);
    expect(startIndex).toBe(2);
    expect(pageItems).toEqual([{ name: 'C' }]);
    expect(embed.data.description).toContain('**3.** 🌐 **C**');
  });

  it('clamps an out-of-range page into bounds', () => {
    const { safePage, pageItems } = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: [{ name: 'A' }],
      page: 99,
    });

    expect(safePage).toBe(0);
    expect(pageItems).toEqual([{ name: 'A' }]);
  });

  it('renders the └ metadata line and truncates it at the density cap', () => {
    const long = 'x'.repeat(100);
    const { embed } = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: [{ name: 'A' }],
      formatRow: () => ({ name: 'A', metadata: ['model-x', long] }),
    });

    const metaLine = (embed.data.description ?? '').split('\n').find(l => l.startsWith('   └ '));
    expect(metaLine).toBeDefined();
    expect(metaLine).toContain('model-x · ');
    expect(metaLine).toContain('…');
    expect((metaLine ?? '').length).toBeLessThanOrEqual('   └ '.length + 72);
  });

  it('interleaves group headers with a separating blank line', () => {
    const items: Item[] = [
      { name: 'Mine', group: '**📝 Your Characters (1)**' },
      { name: 'Theirs', group: "**🌐 Other Users' Characters (1)**" },
    ];
    const { embed } = buildBrowseListEmbed<Item>({ ...baseOptions, items });

    const description = embed.data.description ?? '';
    expect(description).toContain('**📝 Your Characters (1)**\n**1.** 🌐 **Mine**');
    // Second header gets a blank-line separator before it.
    expect(description).toContain("\n\n**🌐 Other Users' Characters (1)**\n**2.** 🌐 **Theirs**");
  });

  it('renders the D19 empty state with the CTA when the list is empty', () => {
    const { embed } = buildBrowseListEmbed<Item>({ ...baseOptions, items: [] });

    expect(embed.data.description).toContain('start with `/character create`');
  });

  it('prefers the filter-aware empty state when a filter is active', () => {
    const { embed } = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: [],
      filterActive: true,
      empty: {
        noItems: 'none yet',
        noMatch: 'No private characters match — clear the filter to see all.',
      },
    });

    expect(embed.data.description).toContain('clear the filter to see all');
  });

  it('suppresses the footer on an empty list unless the caller opts in', () => {
    const options = {
      ...baseOptions,
      items: [] as Item[],
      footerSegments: ['0 characters'],
      badgeLegend: 'Public 🌐',
    };

    const suppressed = buildBrowseListEmbed<Item>(options);
    expect(suppressed.embed.data.footer).toBeUndefined();

    const optedIn = buildBrowseListEmbed<Item>({ ...options, footerOnEmpty: true });
    expect(optedIn.embed.data.footer?.text).toBe('0 characters • Public 🌐');
  });

  it('truncates metadata by code point, never splitting an astral emoji', () => {
    const { embed } = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: [{ name: 'A' }],
      formatRow: () => ({
        name: 'A',
        // 70 ASCII chars then astral emoji straddling the 72-cap boundary.
        metadata: [`${'x'.repeat(70)}🦋🦋🦋`],
      }),
    });

    const metaLine = (embed.data.description ?? '').split('\n').find(l => l.startsWith('   └ '));
    expect(metaLine).toBeDefined();
    expect(metaLine).not.toContain('�');
    // Cap counts code points: 70 x's + one whole butterfly + ellipsis.
    expect(metaLine).toContain('x🦋…');
  });

  it('renders a server-fetched page without re-slicing, numbering from the requested page', () => {
    const pageTwoItems: Item[] = [{ name: 'Eleventh' }, { name: 'Twelfth' }];
    const { embed, pageItems, startIndex, totalPages, safePage } = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: pageTwoItems,
      itemsPerPage: 10,
      page: 1,
      serverPage: { totalItems: 12 },
    });

    expect(pageItems).toEqual(pageTwoItems);
    expect(startIndex).toBe(10);
    expect(totalPages).toBe(2);
    expect(safePage).toBe(1);
    expect(embed.data.description).toContain('**11.** 🌐 **Eleventh**');
    expect(embed.data.description).toContain('**12.** 🌐 **Twelfth**');
  });

  it('server mode: degrades a stale empty page (non-zero total) to the empty state, not a blank body', () => {
    // A pagination click whose offset now lands past a shrunk total: the
    // server returns zero rows while totalItems is still positive.
    const { embed } = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: [],
      itemsPerPage: 10,
      page: 3,
      serverPage: { totalItems: 12 },
      footerSegments: ['12 characters'],
    });

    expect(embed.data.description).toContain('start with `/character create`');
    // Footer suppression applies too — no "Page 4" claim over an empty body.
    expect(embed.data.footer).toBeUndefined();
  });

  it('server mode: clamps the requested page against totalItems and empties on zero total', () => {
    const clamped = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: [{ name: 'Only' }],
      itemsPerPage: 10,
      page: 99,
      serverPage: { totalItems: 1 },
    });
    expect(clamped.safePage).toBe(0);
    expect(clamped.startIndex).toBe(0);

    const empty = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: [],
      itemsPerPage: 10,
      page: 0,
      serverPage: { totalItems: 0 },
    });
    expect(empty.embed.data.description).toContain('start with `/character create`');
  });

  it('joins footer segments and appends the badge legend last', () => {
    const { embed } = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: [{ name: 'A' }],
      footerSegments: ['3 characters', false, 'Sorted by date'],
      badgeLegend: 'Public 🌐 · Private 🔒',
    });

    expect(embed.data.footer?.text).toBe('3 characters • Sorted by date • Public 🌐 · Private 🔒');
  });

  it('renders preamble lines above the list', () => {
    const { embed } = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: [{ name: 'A' }],
      preamble: ['🔍 Searching: "li"'],
    });

    expect(embed.data.description?.startsWith('🔍 Searching: "li"')).toBe(true);
  });

  it('separates the preamble from the FIRST group header with a blank line (intentional)', () => {
    // Deliberate visual upgrade over the old per-command rendering, which
    // only separated the others-section header: context (preamble) and
    // content (the list) now always get one blank line between them,
    // uniformly across every browse surface.
    const { embed } = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: [{ name: 'Mine', group: '**📝 Your Characters (1)**' }],
      preamble: ['🔍 Searching: "mine"'],
    });

    expect(embed.data.description).toContain(
      '🔍 Searching: "mine"\n\n**📝 Your Characters (1)**\n**1.**'
    );
  });

  it('never stacks a second blank when the preamble already ends with one (regression)', () => {
    // The own-empty + others-present combo: the empty-state CTA block in the
    // preamble carries its own trailing spacer, and the first row's group
    // header separator used to add another — a double blank line.
    const { embed } = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: [{ name: 'Other', group: '**🌐 Public Characters (1)**' }],
      preamble: ["You haven't created any characters yet — `/character create`.", ''],
    });

    expect(embed.data.description).toContain(
      '`/character create`.\n\n**🌐 Public Characters (1)**'
    );
    expect(embed.data.description).not.toContain('\n\n\n');
  });

  it('honors a nameMarkup override without double-bolding', () => {
    const { embed } = buildBrowseListEmbed<Item>({
      ...baseOptions,
      items: [{ name: 'Paid' }],
      formatRow: () => ({ name: 'Paid', nameMarkup: '~~Paid~~' }),
    });

    expect(embed.data.description).toContain('**1.** ~~Paid~~');
    expect(embed.data.description).not.toContain('**Paid**');
  });
});
