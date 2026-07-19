/**
 * Shared browse list-embed builder (design-system spec §2.4/§3.1, D19).
 *
 * Every browse command previously hand-built its list embed with drifting
 * grammar (numbered vs unnumbered rows, ad-hoc empty states, freelance
 * titles). This builder owns the invariants:
 *
 * - Title grammar `{entity emoji} {Plural noun}` (§2.1) — browse titles are
 *   the entity's identity, not a "Browser" suffix.
 * - Row grammar `**{n}.** {badges} **{name}** (\`{tech-id}\`)` with an
 *   optional `└`-prefixed metadata second line, ` · `-separated (§2.4).
 *   Numbering always matches the select menu's numbering (same startIndex).
 * - Tech-id renders only when the caller provides one — reserved for ids
 *   users type elsewhere (character slugs); detail-view-only ids stay off
 *   the list (§2.4 council catch).
 * - Metadata density guardrail: the `└` line truncates with `…` so a row
 *   survives a narrow phone viewport (§2.4).
 * - Empty states are designed surfaces (D19): one orientation sentence plus
 *   a CTA, with a filter-aware variant when emptiness came from filtering.
 * - Informational surfaces are BLURPLE (§2.3); state renders via badges.
 *
 * The builder owns the embed only. Select menus, pagination buttons, and
 * customIds stay with the existing browse factories — compose the result's
 * `pageItems`/`startIndex` into `buildBrowseSelectMenu` so row numbers and
 * select numbers can never drift.
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { joinFooter } from './footer.js';

/**
 * Metadata (`└` line) density cap. Long metadata wraps into multi-line rows
 * on phones, burying the row numbering the select menu depends on.
 */
const MAX_METADATA_LENGTH = 72;

/** One rendered row. The caller escapes user-controlled text (names). */
export interface BrowseRowSpec {
  /**
   * Optional section header rendered above this row — grouped lists
   * (character browse's own/others sections) interleave headers with rows.
   * The builder inserts a blank line before a header that follows content.
   */
  groupHeader?: string;
  /** Badge glyph run rendered before the name (state, per §2.2). */
  badges?: string;
  /** Display name (markdown-escaped by the caller); the builder bolds it. */
  name: string;
  /**
   * Pre-styled name markup override for the rare style exception (e.g.
   * guest-mode strikethrough). When present, `name` is not rendered.
   */
  nameMarkup?: string;
  /** Technical id — only for ids users type elsewhere. */
  techId?: string;
  /** Metadata segments for the `└` line, joined with ' · '. */
  metadata?: string[];
}

export interface BrowseListEmbedOptions<T> {
  /** Entity emoji (§2.1 registry) — the entity's stable identity. */
  entityEmoji: string;
  /** Plural noun for the title (e.g. 'Characters' → `🎭 Characters`). */
  titleNoun: string;
  /**
   * The full filtered item list (all pages) — or, in `serverPage` mode,
   * just the already-fetched current page.
   */
  items: T[];
  /** Requested 0-based page; clamped into range. */
  page: number;
  itemsPerPage: number;
  /** Row renderer; absoluteIndex is 0-based across the whole list. */
  formatRow: (item: T, absoluteIndex: number) => BrowseRowSpec;
  /** Context lines above the list (search/filter line, mode warnings). */
  preamble?: string[];
  /** D19 designed empty states. */
  empty: {
    /** Zero items, no filter/query: orientation + CTA (`/command` inline). */
    noItems: string;
    /** Zero items WITH a filter/query active; falls back to noItems. */
    noMatch?: string;
  };
  /** Whether a filter or query is narrowing the list (selects noMatch). */
  filterActive?: boolean;
  /**
   * Footer segments, joined via joinFooter (falsy segments dropped).
   * Suppressed on an empty list (with the badge legend) — count segments
   * under an empty-state CTA read as contradiction, not information. Set
   * `footerOnEmpty` to opt out of the suppression.
   */
  footerSegments?: (string | false | null | undefined)[];
  /** Word-first badge legend (§2.2) — always the footer's last segment. */
  badgeLegend?: string;
  /** Render the footer even when the list is empty. */
  footerOnEmpty?: boolean;
  /** Embed color; BLURPLE default (§2.3 — info surfaces are BLURPLE). */
  color?: number;
  /**
   * Server-side pagination: `items` is ONE already-fetched page, not the
   * full list. The builder skips slicing — numbering, clamping, and the
   * returned coordinates derive from these values instead. `page` (the
   * top-level option) is still the requested page and is clamped against
   * `totalItems`.
   */
  serverPage?: { totalItems: number };
}

export interface BrowseListEmbedResult<T> {
  embed: EmbedBuilder;
  /** The page's item slice — feed to buildBrowseSelectMenu. */
  pageItems: T[];
  /** Absolute index of the first page item — the select's startIndex. */
  startIndex: number;
  totalPages: number;
  /** The clamped page actually rendered. */
  safePage: number;
}

/**
 * Truncate the joined metadata line to the density cap. Counts and cuts by
 * code point, not UTF-16 unit — free-text segments (e.g. denylist reasons)
 * can carry astral-plane emoji, and a unit-slice through one leaves a
 * replacement character at the cut.
 */
function renderMetadataLine(segments: string[]): string {
  const joined = segments.join(' · ');
  const codePoints = [...joined];
  const capped =
    codePoints.length > MAX_METADATA_LENGTH
      ? `${codePoints.slice(0, MAX_METADATA_LENGTH - 1).join('')}…`
      : joined;
  return `   └ ${capped}`;
}

/** Render one §2.4 row (plus its optional group header) into lines. */
function renderRow(spec: BrowseRowSpec, rowNumber: number, lines: string[]): void {
  if (spec.groupHeader !== undefined) {
    // Separator before a header that follows content — but never stack a
    // second blank when the preceding line (e.g. a preamble CTA's own
    // trailing spacer) already is one.
    if (lines.length > 0 && lines[lines.length - 1] !== '') {
      lines.push('');
    }
    lines.push(spec.groupHeader);
  }
  const badges = spec.badges !== undefined && spec.badges.length > 0 ? `${spec.badges} ` : '';
  const nameMarkup = spec.nameMarkup ?? `**${spec.name}**`;
  // Backticks can't be escaped inside a code span — strip them so a hostile
  // tech-id can't break out of its span and restyle the rest of the row.
  const techId = spec.techId !== undefined ? ` (\`${spec.techId.replaceAll('`', '')}\`)` : '';
  lines.push(`**${rowNumber}.** ${badges}${nameMarkup}${techId}`);
  if (spec.metadata !== undefined && spec.metadata.length > 0) {
    lines.push(renderMetadataLine(spec.metadata));
  }
}

/**
 * Build the browse list embed. Pagination math is owned here so the caller
 * can't slice one range and number another.
 */
export function buildBrowseListEmbed<T>(
  options: BrowseListEmbedOptions<T>
): BrowseListEmbedResult<T> {
  const { items, itemsPerPage, formatRow, serverPage } = options;

  // Server mode: `items` is the fetched page; the total drives the math.
  const totalItems = serverPage?.totalItems ?? items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const safePage = Math.min(Math.max(0, options.page), totalPages - 1);
  const startIndex = safePage * itemsPerPage;
  const pageItems =
    serverPage !== undefined ? items : items.slice(startIndex, startIndex + itemsPerPage);

  const lines: string[] = [];
  for (const line of options.preamble ?? []) {
    lines.push(line);
  }

  // Server mode can hand us an empty page with a non-zero total: a stale
  // pagination click whose offset now lands past a shrunk total (rows
  // deleted since the buttons rendered). Rendering the row branch with
  // zero rows would produce a blank body — degrade to the empty state
  // instead, matching the pre-builder per-command behavior.
  const listIsEmpty = totalItems === 0 || pageItems.length === 0;
  if (listIsEmpty) {
    const emptyLine =
      options.filterActive === true
        ? (options.empty.noMatch ?? options.empty.noItems)
        : options.empty.noItems;
    lines.push(emptyLine);
  } else {
    pageItems.forEach((item, i) => {
      renderRow(formatRow(item, startIndex + i), startIndex + i + 1, lines);
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`${options.entityEmoji} ${options.titleNoun}`)
    .setColor(options.color ?? DISCORD_COLORS.BLURPLE)
    .setDescription(lines.join('\n'))
    .setTimestamp();

  // Count segments under an empty-state CTA contradict it — suppress
  // unless the caller opts in.
  if (!listIsEmpty || options.footerOnEmpty === true) {
    const footer = joinFooter(...(options.footerSegments ?? []), options.badgeLegend);
    if (footer.length > 0) {
      embed.setFooter({ text: footer });
    }
  }

  return { embed, pageItems, startIndex, totalPages, safePage };
}
