/**
 * Browse Button Builder
 *
 * Shared button building utilities for browse commands.
 * Creates consistent pagination and sort toggle buttons.
 *
 * Supports both the standard `BrowseSortType` (`'name' | 'date'`) and
 * custom sort unions via the `TSort` generic parameter (e.g.,
 * admin/servers uses `'members' | 'name'`). When widening `TSort` beyond
 * the default, callers must provide a matching `sortToggle` — the
 * second overload enforces this at compile time.
 */

import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import type { BrowseSortType } from './constants.js';

/**
 * Per-sort display info: the label and emoji to show on the toggle
 * button when this sort is the NEXT sort to switch to.
 */
export interface BrowseSortDisplay {
  label: string;
  emoji: string;
}

/**
 * Sort toggle configuration for `buildBrowseButtons`.
 *
 * The toggle button on a browse pagination row cycles through sort
 * values. This interface parameterizes that behavior:
 *
 * - `next(current)` returns the sort value to switch to when the user
 *   clicks the button.
 * - `labelFor(sort)` returns the button label and emoji for the
 *   given sort (the UI shows the label/emoji for the NEXT sort, i.e.,
 *   the action the button will perform).
 *
 * For `TSort = BrowseSortType`, callers can omit `sortToggle` entirely
 * and the factory will use its built-in default (`'Sort A-Z'` / `'Sort
 * by Date'` with 🔤/📅 emojis). For minor customizations of that
 * default (e.g., changing one label), use {@link createBrowseSortToggle}.
 *
 * For custom `TSort` unions, callers MUST provide their own complete
 * sortToggle — the overload on `buildBrowseButtons` enforces this at
 * compile time.
 */
export interface BrowseSortToggle<TSort extends string> {
  next: (current: TSort) => TSort;
  labelFor: (sort: TSort) => BrowseSortDisplay;
}

/**
 * Configuration for building browse buttons
 */
interface BrowseButtonConfig<TFilter extends string, TSort extends string = BrowseSortType> {
  /** Current page (0-indexed) */
  currentPage: number;
  /** Total number of pages */
  totalPages: number;
  /** Current filter value */
  filter: TFilter;
  /** Current sort type */
  currentSort: TSort;
  /** Search query if any */
  query: string | null;
  /** Function to build custom ID for pagination */
  buildCustomId: (page: number, filter: TFilter, sort: TSort, query: string | null) => string;
  /** Function to build info button custom ID */
  buildInfoId: () => string;
  /** Whether to show sort toggle button (default: true) */
  showSortToggle?: boolean;
  /**
   * Sort toggle behavior. Optional for the default `BrowseSortType`
   * (uses the built-in name/date toggle); REQUIRED for any other
   * `TSort`. See {@link BrowseSortToggle} for the shape.
   */
  sortToggle?: BrowseSortToggle<TSort>;
}

/**
 * Pagination button labels (not caller-configurable).
 *
 * These were caller-configurable before PR #775 but nobody in the
 * codebase customized them. Inlined here as constants to shrink the
 * API surface. If a future caller needs a different label, re-expose
 * via a config field.
 */
const PREVIOUS_LABEL = 'Previous';
const NEXT_LABEL = 'Next';

/** Pagination button emojis (not caller-configurable, same rationale). */
const PREVIOUS_EMOJI = '◀️';
const NEXT_EMOJI = '▶️';

/**
 * Default sort toggle for `BrowseSortType` (`'name' | 'date'`).
 *
 * Used internally when `sortToggle` is omitted AND the config's
 * `TSort` resolves to `BrowseSortType`. For custom TSort unions,
 * callers MUST supply their own — the `buildBrowseButtons` overload
 * rejects a config without `sortToggle` when TSort is widened.
 */
const DEFAULT_BROWSE_SORT_TOGGLE: BrowseSortToggle<BrowseSortType> = {
  next: current => (current === 'date' ? 'name' : 'date'),
  labelFor: sort =>
    sort === 'name' ? { label: 'Sort A-Z', emoji: '🔤' } : { label: 'Sort by Date', emoji: '📅' },
};

/**
 * Create a `BrowseSortToggle<BrowseSortType>` with per-sort label/emoji
 * overrides layered onto the default.
 *
 * Useful for browse commands that need minor customization of the
 * standard name/date toggle — e.g., `deny/browse.ts` wants to show
 * "Sort by ID" instead of "Sort A-Z" because its entries are
 * ID-keyed rather than name-keyed.
 *
 * @example
 * ```typescript
 * buildBrowseButtons({
 *   // ...
 *   sortToggle: createBrowseSortToggle({
 *     sortByName: { label: 'Sort by ID', emoji: '🔤' },
 *   }),
 * });
 * ```
 *
 * For callers needing a completely custom sort space (e.g.,
 * `'members' | 'name'`), build a `BrowseSortToggle<TSort>` directly
 * rather than using this helper.
 */
export function createBrowseSortToggle(overrides?: {
  sortByName?: BrowseSortDisplay;
  sortByDate?: BrowseSortDisplay;
}): BrowseSortToggle<BrowseSortType> {
  const byName = overrides?.sortByName ?? { label: 'Sort A-Z', emoji: '🔤' };
  const byDate = overrides?.sortByDate ?? { label: 'Sort by Date', emoji: '📅' };
  return {
    next: current => (current === 'date' ? 'name' : 'date'),
    labelFor: sort => (sort === 'name' ? byName : byDate),
  };
}

/**
 * Build pagination and sort buttons for browse lists.
 *
 * Creates a standard button row with:
 * - Previous button (disabled on first page)
 * - Page indicator (disabled)
 * - Next button (disabled on last page)
 * - Sort toggle button (optional)
 *
 * @param config - Button configuration
 * @returns Action row with buttons
 */
// Overload 1: standard `BrowseSortType`. `sortToggle` is optional —
// the factory uses its built-in default when omitted. This is the
// common case; the 6+ existing callers that don't widen TSort match
// this signature and need no changes.
export function buildBrowseButtons<TFilter extends string>(
  config: BrowseButtonConfig<TFilter, BrowseSortType>
): ActionRowBuilder<ButtonBuilder>;

// Overload 2: custom `TSort` union. `sortToggle` is REQUIRED — the
// factory has no default for non-`BrowseSortType` cases. This is the
// same footgun-prevention pattern as the `validSorts` requirement on
// `createBrowseCustomIdHelpers`: a caller who widens TSort without
// providing matching runtime logic would silently get wrong behavior,
// so we make it a compile error instead. admin/servers'
// `'members' | 'name'` sort space hits this overload.
export function buildBrowseButtons<TFilter extends string, TSort extends string>(
  config: Omit<BrowseButtonConfig<TFilter, TSort>, 'sortToggle'> & {
    sortToggle: BrowseSortToggle<TSort>;
  }
): ActionRowBuilder<ButtonBuilder>;

// Implementation signature (not visible to callers).
export function buildBrowseButtons<TFilter extends string, TSort extends string = BrowseSortType>(
  config: BrowseButtonConfig<TFilter, TSort>
): ActionRowBuilder<ButtonBuilder> {
  const {
    currentPage,
    totalPages,
    filter,
    currentSort,
    query,
    buildCustomId,
    buildInfoId,
    showSortToggle = true,
    sortToggle,
  } = config;

  const row = new ActionRowBuilder<ButtonBuilder>();

  // Previous button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId(currentPage - 1, filter, currentSort, query))
      .setLabel(PREVIOUS_LABEL)
      .setEmoji(PREVIOUS_EMOJI)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0)
  );

  // Page indicator (disabled button)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildInfoId())
      .setLabel(`Page ${currentPage + 1} of ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  // Next button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId(currentPage + 1, filter, currentSort, query))
      .setLabel(NEXT_LABEL)
      .setEmoji(NEXT_EMOJI)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages - 1)
  );

  // Sort toggle button (optional)
  if (showSortToggle) {
    // Resolve the sort toggle. When `sortToggle` is omitted, we fall
    // back to the default for BrowseSortType. The cast is only sound
    // when TSort = BrowseSortType, which the overload enforces: any
    // custom TSort caller is required to pass sortToggle and therefore
    // never reaches this fallback branch at runtime. This mirrors the
    // `as unknown as readonly TSort[]` bridge in customIdFactory.ts.
    const toggle: BrowseSortToggle<TSort> =
      sortToggle ?? (DEFAULT_BROWSE_SORT_TOGGLE as unknown as BrowseSortToggle<TSort>);

    const newSort = toggle.next(currentSort);
    const { label, emoji } = toggle.labelFor(newSort);
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildCustomId(currentPage, filter, newSort, query))
        .setLabel(label)
        .setEmoji(emoji)
        .setStyle(ButtonStyle.Primary)
    );
  }

  return row;
}

/**
 * Build simple pagination buttons without sort toggle.
 *
 * Convenience function for browse commands that don't need sorting.
 *
 * @param config - Button configuration
 * @returns Action row with pagination buttons
 */
export function buildSimplePaginationButtons<TFilter extends string>(
  config: Omit<BrowseButtonConfig<TFilter>, 'showSortToggle' | 'sortToggle'>
): ActionRowBuilder<ButtonBuilder> {
  return buildBrowseButtons({ ...config, showSortToggle: false });
}
