/**
 * In-place filter toggle — the design system's filter affordance for
 * ≤3-value filters (spec §3.1 "filter/sort where applicable").
 *
 * Mechanism generalized from the alias-browse pilot: the toggle is ONE
 * Primary button whose customId is the browse's own pagination coordinates
 * with only the filter advanced to the next cycle value — no dedicated
 * handler, the pagination handler re-renders at the parsed coordinates.
 * The page always resets to 0 because a narrower filter renumbers the
 * list. The button's label/emoji show the TARGET filter (what clicking
 * switches to), mirroring the sort toggle's convention.
 *
 * Multi-dimensional filters (more values, or several axes) overflow a
 * cycle button — those surfaces keep their slash-option filter or use a
 * select; this builder deliberately supports only the flat cycle.
 */

import { ButtonBuilder, ButtonStyle } from 'discord.js';
import type { BrowseSortType } from './constants.js';

export interface FilterToggleDisplay {
  /** Button label, e.g. 'Filter: Mine'. */
  label: string;
  /**
   * The filter's bare name for footers/prose (e.g. 'Mine') — a structured
   * field so footer text derives without string surgery on the label.
   */
  shortLabel: string;
  /** Button emoji, set separately per the 04-discord button rule. */
  emoji: string;
}

export interface FilterToggleConfig<TFilter extends string> {
  /** Cycle order; clicking advances current → next (wrapping). */
  filters: readonly TFilter[];
  /** Display per filter, used for the TARGET filter the button switches to. */
  display: Record<TFilter, FilterToggleDisplay>;
  current: TFilter;
  /**
   * The browse's own coordinate builder (the customId factory's `build`).
   * Sortless factories ignore the sort argument.
   */
  buildCustomId: (
    page: number,
    filter: TFilter,
    sort: BrowseSortType,
    query: string | null
  ) => string;
  /** Carried through for sortful browses; sortless ones may omit. */
  sort?: BrowseSortType;
  query: string | null;
}

/** Advance a filter one step through the cycle, wrapping at the end. */
export function nextFilter<TFilter extends string>(
  filters: readonly TFilter[],
  current: TFilter
): TFilter {
  const index = filters.indexOf(current);
  return filters[(index + 1) % filters.length];
}

/** Build the in-place filter toggle button for a browse's button row. */
export function buildFilterToggleButton<TFilter extends string>(
  config: FilterToggleConfig<TFilter>
): ButtonBuilder {
  const target = nextFilter(config.filters, config.current);
  const display = config.display[target];
  return new ButtonBuilder()
    .setCustomId(config.buildCustomId(0, target, config.sort ?? 'name', config.query))
    .setLabel(display.label)
    .setEmoji(display.emoji)
    .setStyle(ButtonStyle.Primary);
}
