# Why `lines:check` exists

## What

A line-count ratchet over the always-loaded context surfaces: the
`.claude/rules/*.md` set (summed across all files) and `CURRENT.md` (alone).
`pnpm ops lines:check` measures both surfaces and fails when either exceeds
its baseline budget (`baseline.lines + graceMargin`), with the baseline in
`.github/baselines/lines-baseline.json`. `pnpm ops lines:update-baseline` is
the sanctioned refresh path. It runs in `pnpm quality`, the CI lint job, AND
the pre-push docs-only fast path — the last one matters most, because
doc-only pushes skip every heavy check and are exactly how these surfaces
bloat.

## Why

The always-loaded surfaces are paid on every single session start: every
line of `.claude/rules/` and `CURRENT.md` is context consumed before any
work happens, for every contributor, forever. They grow through the cheapest
commit path in the repo (doc commits, which legitimately skip builds and
tests), so nothing structural pushed back on growth. The 2026-07 context
refit cut the rules archaeology down to ~1,900 lines and capped CURRENT.md
at ~40 — this ratchet exists so that recovered headroom doesn't silently
erode. With it, regrowth becomes an explicit decision (a baseline bump
visible in review) instead of drift nobody chose.

## Threshold rationale

Baseline-and-hold at the **measured** count, not a round-number cap. The
grace margins (150 lines for rules, 60 for CURRENT.md) absorb legitimate
small additions between refreshes — a new rule subsection, a longer session
handoff — without demanding a baseline bump for every paragraph. Hard growth
beyond the margin requires `lines:update-baseline`, which shows up as a
baseline-file diff a reviewer can question. Trimming a surface and
refreshing ratchets the budget DOWN, locking in the win.

## Decay check

Three failure modes, three detectors. (1) **Tool rot**: the canary fixture
(`test-fixtures/audit-canaries/lines-check/`) is a fake repo root whose
surfaces deliberately exceed a tiny runtime-built baseline; the canary test
asserts `status: 'fail'` with findings > 0, so a change that breaks glob
matching or line counting turns CI red. (2) **Config drift**: the baseline
carries a `configHash` over `getLinesConfigFingerprint()` (impl version,
surface set, globs) — changing what gets measured without refreshing the
baseline hard-fails. Bump `LINES_IMPL_VERSION` when the counting or matching
logic changes. (3) **Hollow measurements**: a surface whose glob matches
zero files is a failure, never a 0-line pass — moving `.claude/rules/` or
renaming `CURRENT.md` cannot silently disarm the gate.
