/**
 * Browse Select Menu Factory
 *
 * Shared factory for constructing Discord select menus across browse-style
 * commands (character, preset, persona, inspect, deny, shapes, admin servers,
 * memory). Replaces ~8 near-identical inline implementations with one
 * standardized builder.
 *
 * Design notes (see PR review for full rationale):
 *
 * - **`customId` is pre-built**: each command has its own customId helper
 *   with a different signature, so the factory accepts a finished string
 *   rather than coupling to any specific browseHelpers shape.
 * - **Numbering is automatic**: callers return unprefixed labels via
 *   `formatItem`, the factory prepends `${oneBasedNumber}. ` to every
 *   item. Consistent numbering across all browse commands by construction.
 * - **Truncation always strips newlines**: Discord renders newlines in
 *   select labels poorly. Memory's previous helper did this manually; the
 *   factory now does it for everyone.
 * - **Empty `items` returns null**: legitimate empty state — caller skips
 *   pushing the row to its components array. No exception, no "interaction
 *   failed" footgun.
 * - **>25 items or duplicate values throw**: caller bugs (broken
 *   pagination or duplicate IDs) get surfaced loudly at the boundary
 *   instead of being silently dropped.
 */

import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';

import { truncateForSelect, truncateForDescription } from './truncation.js';

/**
 * Discord's hard limit on the number of options in a single select menu.
 * Sending more than this causes the API to reject the component with a 400.
 */
const DISCORD_SELECT_OPTIONS_LIMIT = 25;

/**
 * Per-item option fields returned by the caller's `formatItem` callback.
 * Labels and descriptions are returned UNPREFIXED — the factory adds the
 * `${num}. ` numbering and truncates automatically.
 *
 * **Contract**: callers must NOT include the `${num}. ` numbering prefix
 * in `label`. The factory always prepends it, so doubling it produces
 * labels like `"1. 1. foo"`. The `oneBasedNumber` passed to `formatItem`
 * is available if a caller wants to reference the display number inside
 * the description (or elsewhere in the returned fields), but the label
 * specifically must not embed it.
 */
export interface BrowseSelectOption {
  /** Visible label, without the numbering prefix (factory adds "${num}. "). */
  label: string;
  /** Value sent back to the bot when this option is selected. Must be unique within the menu. */
  value: string;
  /** Optional second-line description. */
  description?: string;
}

/**
 * Options for {@link buildBrowseSelectMenu}.
 */
export interface BuildBrowseSelectMenuOptions<T> {
  /** Items on the current page. Empty list returns null; >25 throws. */
  items: T[];
  /**
   * Pre-built custom ID for the select menu. Each command builds its own
   * via its respective `browseHelpers.buildSelect(...)` (or equivalent),
   * so the factory stays uncoupled from any specific customId shape.
   */
  customId: string;
  /** Placeholder text shown when no option is selected. */
  placeholder: string;
  /**
   * 0-indexed offset for numbering. Typically `page * itemsPerPage` so
   * page 2 of a 10-per-page list shows items numbered 21–30.
   */
  startIndex: number;
  /**
   * Map a single item to its option fields. Receives the item and the
   * 1-based display number (factory pre-computes `startIndex + index + 1`)
   * so callers don't have to repeat the numbering math.
   */
  formatItem: (item: T, oneBasedNumber: number) => BrowseSelectOption;
}

/**
 * Build a Discord select menu from a list of items.
 *
 * @returns An action row containing the select menu, or `null` if `items`
 *   is empty (legitimate empty state — the caller should skip pushing the
 *   row to its components array).
 *
 * @throws If `items.length > 25` (Discord's hard limit — indicates an
 *   upstream pagination bug).
 * @throws If two items in `items` produce the same `value` (Discord
 *   requires option values to be unique within a menu — indicates a data
 *   bug in the caller's item list).
 *
 * @example
 * ```typescript
 * const row = buildBrowseSelectMenu({
 *   items: pageOfCharacters,
 *   customId: browseHelpers.buildSelect(page, filter, sort, query),
 *   placeholder: 'Select a character to view/edit...',
 *   startIndex: page * ITEMS_PER_PAGE,
 *   formatItem: (char, num) => ({
 *     label: `${char.isPublic ? '🌐' : '🔒'} ${char.displayName ?? char.name}`,
 *     value: char.slug,
 *     description: `/${char.slug}`,
 *   }),
 * });
 * if (row !== null) components.push(row);
 * ```
 */
export function buildBrowseSelectMenu<T>(
  opts: BuildBrowseSelectMenuOptions<T>
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const { items, customId, placeholder, startIndex, formatItem } = opts;

  // Legitimate empty state — caller should render nothing.
  if (items.length === 0) {
    return null;
  }

  // Caller bug — pagination should never produce more items than Discord allows.
  if (items.length > DISCORD_SELECT_OPTIONS_LIMIT) {
    throw new Error(
      `buildBrowseSelectMenu: items.length=${items.length} exceeds Discord's limit of ${DISCORD_SELECT_OPTIONS_LIMIT} options per select menu. Fix the upstream pagination so each page contains at most ${DISCORD_SELECT_OPTIONS_LIMIT} items.`
    );
  }

  const seenValues = new Set<string>();
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(1);

  items.forEach((item, index) => {
    const oneBasedNumber = startIndex + index + 1;
    const {
      label: rawLabel,
      value,
      description: rawDescription,
    } = formatItem(item, oneBasedNumber);

    // Caller bug — duplicate values crash the Discord component validation.
    if (seenValues.has(value)) {
      throw new Error(
        `buildBrowseSelectMenu: duplicate option value "${value}" at index ${index}. Each item in a select menu must have a unique value (typically the item's id/slug).`
      );
    }
    seenValues.add(value);

    // Prepend numbering, then truncate the FULL label so the budget
    // accounts for the prefix length. Always strip newlines — Discord
    // renders them poorly in select menus.
    const numberedLabel = `${oneBasedNumber.toString()}. ${rawLabel}`;
    const label = truncateForSelect(numberedLabel, { stripNewlines: true });

    const option = new StringSelectMenuOptionBuilder().setLabel(label).setValue(value);
    if (rawDescription !== undefined) {
      // Descriptions are anchored to their own limit (MAX_SELECT_DESCRIPTION_LENGTH).
      // Both constants are 100 today, but using truncateForDescription keeps the
      // factory semantically correct if the limits ever diverge.
      option.setDescription(truncateForDescription(rawDescription, { stripNewlines: true }));
    }
    selectMenu.addOptions(option);
  });

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
}
