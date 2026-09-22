/**
 * A conversation-history row's id is a DETERMINISTIC UUID over (channelId,
 * personalityId, personaId, createdAt). When a test inserts rows sharing the
 * first three keys and lets createdAt default to `new Date()`, two inserts in
 * the same millisecond collide on the id → `Unique constraint failed on (id)`
 * (an intermittent CI flake). Seed a strictly-increasing explicit timestamp
 * per row so each id is deterministic AND unique; the 1s spacing also pins
 * the insertion order the assertions rely on.
 */
export function seededTimestamp(i: number): Date {
  return new Date(new Date('2026-06-01T00:00:00Z').getTime() + i * 1000);
}

/**
 * A seed index beyond any sequence the suites build, for "future" window
 * checks (a `>=` cutoff that must exclude every seeded row).
 */
export const FAR_FUTURE_SEED_INDEX = 100 as const;
