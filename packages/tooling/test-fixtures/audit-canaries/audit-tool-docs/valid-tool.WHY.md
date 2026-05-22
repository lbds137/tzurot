# Why this canary fixture exists

DO NOT MODIFY. This is a CANARY FIXTURE for `guard:audit-tool-docs`.

It exists to validate that the guard correctly accepts a non-stub WHY.md.
Pair-tested with `stub-tool.WHY.md` (must be flagged as stub) and a
missing entry pointing at `this-file-does-not-exist.WHY.md` (must be
flagged as missing).

## Why it's safe to keep

This fixture is referenced ONLY from the synthetic canary registry in
`canary.test.ts` — not from `AUDIT_TOOL_REGISTRY`. The guard tests
against a fake registry pointing at THIS file plus a deliberately
missing file plus a deliberately stub file, then asserts the
classifications match.

If a future contributor "cleans this up" by deleting the file, the
canary that asserts "guard accepts valid WHY.md" will start producing
a missing-file false positive and the canary itself will need
investigation — which is the wrong direction.

## Threshold rationale

The MIN_WHY_CONTENT_CHARS threshold (200 chars) is enforced by the
guard. This file is intentionally well over that to clearly fall in
the "non-stub" category. The point of the canary is to validate
classification at the boundary edges; a file at exactly 199 chars
would be brittle to threshold-tuning changes.

## Decay check

If `guard:audit-tool-docs` is ever deleted, delete this fixture and
the canary test that references it. Otherwise leave it alone.
