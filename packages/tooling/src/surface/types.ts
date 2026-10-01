/**
 * Shared types for the discord.js surface inventory.
 *
 * The inventory classifies every discord.js / @discordjs / discord-api-types
 * symbol site in bot-client's source into one fixed category, so a new
 * discord.js primitive that no category expects surfaces as an inventory
 * change instead of passing unnoticed.
 */

/**
 * Fixed category order. Every category renders in every output, including
 * empty ones — an empty category is a statement ("no such usage exists"),
 * so the tuple must never be reordered or pruned casually. `discord-enums`
 * is the default route for enum members whose container no table names;
 * `unclassified` is the visibility bucket for unmapped constructions and
 * object-literal keys, while methods and property accesses land in
 * `client-methods` — a brand-new method still trips the drift gate, as a
 * client-methods diff, which is the inventory working as designed.
 */
export const SURFACE_CATEGORIES = [
  'client-methods',
  'command-options',
  'components',
  'discord-enums',
  'flags',
  'gateway-events',
  'interaction-acks',
  'message-builders',
  'message-options',
  'rest-outside-helpers',
  'unclassified',
  'webhook-options',
] as const;

export type SurfaceCategory = (typeof SURFACE_CATEGORIES)[number];

/** One aggregated classification: every site sharing category + file + symbol collapses into one entry with a count. */
export interface SurfaceEntry {
  category: SurfaceCategory;
  /** Repo-relative POSIX path of the file containing the sites. */
  file: string;
  /** Symbol name at the site (method, class, enum member, or object-literal key). */
  symbol: string;
  /** Number of expression sites aggregated into this entry. */
  count: number;
}

/** In-memory inventory. `elapsedMs` is display-only and never reaches snapshot bytes. */
export interface SurfaceInventory {
  entries: SurfaceEntry[];
  totalSites: number;
  elapsedMs: number;
}
