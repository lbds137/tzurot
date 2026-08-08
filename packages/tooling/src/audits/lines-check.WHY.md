# Why `lines:check` exists

## What

A size ratchet over the always-loaded context surfaces: the
`.claude/rules/*.md` set (summed across all files) and `CURRENT.md` (alone).
`pnpm ops lines:check` measures both surfaces on **two dimensions — lines and
bytes** — and fails when either surface exceeds either budget
(`baseline + graceMargin`), with the baseline in
`.github/baselines/lines-baseline.json`. `pnpm ops lines:update-baseline` is
the sanctioned refresh path, and `--surface <name>` scopes it to one surface.
The gate runs in `pnpm quality`, the CI lint job, AND the pre-push docs-only
fast path — the last one matters most, because doc-only pushes skip every heavy
check and are exactly how these surfaces bloat.

`--breakdown` adds a read-only per-file ranking of both surfaces, worst-first
by bytes: the gate says whether a surface is over budget, the ranking says
which of its files to open. It is **not** wired into any of those automated
paths and never gates anything — it is run by hand, by whoever is doing the
economy pass in `/tzurot-doc-audit`.

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

## Why two dimensions

Lines is not what these surfaces cost; tokens are, and the two diverge badly —
density varies several-fold across the corpus, and `CURRENT.md` runs several
times denser again. So the line ratchet rated `CURRENT.md` "comfortable" at 96
of 97 lines while it carried a fifth of the entire rules surface's bytes in
under a twentieth of its lines — anyone following the ratchet to pick a trim
target was sent at the wrong file, which is worse than having no ranking at
all. A dense rewrite that halves a file's line count while growing its payload
is invisible to lines and caught by bytes.

The live figures are deliberately not quoted here. They move with every edit to
the corpus, so a copy in prose is stale the day after it is written — which is
the same defect this document would be describing. `lines:check --breakdown`
prints them from measurement.

Bytes rather than tokens because bytes are exact, deterministic, and carry no
tokenizer dependency; the report derives a token figure from them for
readability, and nothing gates on that estimate.

## Threshold rationale

Baseline-and-hold at the **measured** count, not a round-number cap. The
grace margins (150 lines / 12,000 bytes for rules, 20 lines / 4,000 bytes for
CURRENT.md) absorb legitimate small additions between refreshes — a new rule
subsection, a release's smoke checklist — without demanding a baseline bump
for every paragraph. The byte margins are set from that same intent rather
than converted from the line margins, because the two surfaces absorb
different things (~7% on rules is one section at the corpus's own density;
~11% on CURRENT.md is a checklist that reverts at the next reset). Hard growth
beyond the margin requires `lines:update-baseline`, which shows up as a
baseline-file diff a reviewer can question. Trimming a surface and refreshing
ratchets the budget DOWN, locking in the win.

`--surface <name>` exists because the all-or-nothing refresh is not neutral:
it ratchets every surface at once, so a refresh wanted for a surface that was
TRIMMED also writes a LOOSER budget for one that grew, inside a single commit
that reads as bookkeeping. That happened once — a post-trim refresh would have
tightened `rules` and loosened `CURRENT.md` together, so it was skipped
entirely and the trim went unrecorded. Scoping the write is what makes the
tightening safe to run on its own.

## Decay check

Three failure modes, three detectors. (1) **Tool rot**: the canary fixture
(`test-fixtures/audit-canaries/lines-check/`) is a fake repo root whose
surfaces deliberately exceed a tiny runtime-built baseline; the canary test
asserts `status: 'fail'` with EXACTLY four findings (two surfaces x two
dimensions), so a change that breaks glob matching, either count, or that
silently drops a dimension from evaluation turns CI red. (2) **Config drift**: the baseline
carries a `configHash` over `getLinesConfigFingerprint()` (impl version,
surface set, globs) — changing what gets measured without refreshing the
baseline hard-fails. Bump `LINES_IMPL_VERSION` when the counting or matching
logic changes. (3) **Hollow measurements**: a surface whose glob matches
zero files is a failure, never a 0-line pass — moving `.claude/rules/` or
renaming `CURRENT.md` cannot silently disarm the gate.
