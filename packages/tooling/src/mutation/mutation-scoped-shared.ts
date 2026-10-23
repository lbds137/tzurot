/**
 * Constants shared by the diff-scoped mutation gate's command registration and
 * its runner. `commands/test.ts` imports this module statically so registering
 * `test:mutation-scoped` stays cheap — the runner itself (mutation-scoped.ts)
 * only loads behind the command's dynamic import.
 */

/** Base ref the diff is computed against when `--base` is not given. */
export const DEFAULT_BASE = 'origin/develop';
