/**
 * Release-notes section names that carry notification-level semantics.
 *
 * Two modules depend on these exact strings staying identical:
 * - the GENERATOR: `packages/tooling/src/release/notes-format.ts` emits them
 *   as `### <section>` headers when drafting release notes
 * - the CLASSIFIER: `services/api-gateway/src/services/releaseNotes.ts` reads
 *   them back out of a published GitHub Release body to derive the broadcast
 *   level (Breaking Changes → major, Features → minor, anything else → patch)
 *
 * A rename that touched only one side would silently downgrade every future
 * release announcement to patch — sharing the literals makes that impossible.
 * Other section names (Bug Fixes, Improvements, Chores, ...) carry no level
 * semantics and stay local to the generator.
 */
export const RELEASE_LEVEL_SECTIONS = {
  /** Presence of this section classifies the release as a major notification. */
  major: 'Breaking Changes',
  /** Presence of this section (without Breaking Changes) classifies as minor. */
  minor: 'Features',
} as const;
