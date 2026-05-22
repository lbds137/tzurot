# Why `dev:dead-files` (`knip:dead`) exists

## What it does

Detects production source files that are only referenced by their own colocated tests — the kind of dead code that `pnpm knip` misses because test-file imports count as "usage." Two-pass approach:

1. Run `knip --production --include files` for candidate-unused files
2. Filter out known false positives (test utils, command submodules dynamically loaded, root config files)
3. Grep-verify remaining candidates have no non-test importers

Reports each survivor as a file safe to delete. The aliased shortcut is `pnpm knip:dead`.

## Why it was built

`pnpm knip` was missing entire categories of dead code: a `.ts` file imported only by its sibling `.test.ts` looks "used" to knip, but in production it's nothing — the file exists only because its tests still pass. The pattern is common during refactors: code gets extracted, the old implementation file stays around with its old tests still passing, nobody notices until a maintainer reads the dir listing and asks "wait, why is this here?"

The two-pass design was needed because:

1. `knip --production` correctly excludes test files from the usage graph but is too eager — flags command submodules, root config files, and dynamic-import targets that knip can't statically resolve.
2. The grep-verify pass confirms knip's claim by checking the actual production import graph, which catches both knip false positives and knip false negatives.

The `EXCLUDE_PATTERNS` list at the top of `find-dead-files.ts` is the accumulated allowlist of patterns where knip is unreliable. New patterns get added when a new false-positive class is identified.

## Threshold rationale

Zero dead files. Any survivor is reportable. The tool doesn't fail CI by default — it's a `pnpm knip:dead` invocation by the contributor; `pnpm quality` runs it but the failure mode is informational rather than blocking. The intent: if knip:dead has anything to say, the contributor should look at it and either delete the dead code or extend `EXCLUDE_PATTERNS` if the report is wrong.

## Decay check

When this tool's reminder fires:

- Did `knip` evolve to handle test-only-importer files natively? Delete the tool.
- Are exclude patterns growing unboundedly, with the tool reporting fewer real findings than allowlist entries? The signal-to-noise has flipped; either tighten the patterns or step back from this approach.
- Did the codebase shrink so much that dead-file detection isn't worth the complexity? Delete the tool.

A dead-file tool that never reports anything is still doing useful work — it's the negative feedback that proves the codebase is clean. Don't delete it just because the output is "nothing this round."
