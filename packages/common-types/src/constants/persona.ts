/**
 * Persona-related constants shared across common-types and test-utils.
 *
 * Lives in the constants layer (not the services layer) so `test-utils` can
 * import it as a runtime dependency without creating a circular edge. The
 * cycle people typically worry about here is at the test level
 * (`common-types` tests → `test-utils`), not at the production level —
 * common-types's own runtime code never imports test-utils.
 */

/** Default description applied to auto-created personas. */
export const DEFAULT_PERSONA_DESCRIPTION = 'Default persona';

/**
 * Reserved discordId for the "Orphaned Characters" sentinel user — the
 * non-interactive system row that holds characters re-homed by a retention
 * purge (Retention Phase 2, D11) so a departed owner's cross-user characters
 * aren't deleted out from under active users. Non-numeric so it can never
 * collide with a real Discord snowflake (mirrors UNKNOWN_USER_DISCORD_ID's
 * reserved-sentinel pattern); ≤20 chars for the `users.discord_id` VarChar(20).
 * The sentinel's user id is `generateUserUuid(this)` — deterministic so dev and
 * prod converge on the same row under db-sync.
 */
export const ORPHAN_SENTINEL_DISCORD_ID = 'orphaned-characters';

/**
 * Username + persona name for the orphan sentinel row. Human-readable (never a
 * bare snowflake, so it satisfies the `personas_name_not_snowflake` CHECK).
 */
export const ORPHAN_SENTINEL_USERNAME = 'Orphaned Characters';

/** Description for the orphan sentinel's paired persona row. */
export const ORPHAN_SENTINEL_DESCRIPTION =
  'System-reserved holder for characters orphaned by a retention purge';
