/**
 * Shared constants for the `release:*` command family.
 */

/**
 * Upper bound for every git/gh shell-out issued by the release commands
 * (`release:range`, `release:draft-notes`, `release:premigrate`, ...).
 *
 * The network-touching calls in this family — `git fetch`, `gh` API queries
 * — can STALL rather than fail cleanly: a blocked connection produces no
 * error, just silence, which would hang a release command with no way to
 * distinguish "still working" from "hung." Bounding EVERY shell-out with the
 * same constant, not only the network-touching ones, means a shell-out added
 * later inherits the ceiling automatically instead of needing its own
 * opt-in, and a 30s ceiling on a purely local git call costs nothing.
 */
export const RELEASE_GIT_TIMEOUT_MS = 30_000;
